// ============================================================
// parser.js — Helper functions for NJ-iot401 / LCS-TH protocols
// Extracted from parser_Encoder.md Sections 3.3–3.12
// ============================================================

// ── §3.3 Helper Functions ────────────────────────────────────

/**
 * CRC16/MODBUS (polynomial 0xA001)
 */
function crc16(buf, start, end) {
    let crc = 0xFFFF;
    for (let i = start; i < end; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) { crc = (crc >> 1) ^ 0xA001; }
            else               { crc >>= 1; }
        }
    }
    return crc;
}

/**
 * BCD Timestamp → ISO String (6 bytes: YY MM DD HH mm SS)
 */
function bcdToDate(buf, offset) {
    const b = (n) => (buf[offset + n] >> 4) * 10 + (buf[offset + n] & 0x0F);
    const yr = 2000 + b(0), mo = b(1), dy = b(2);
    const hh = b(3), mm = b(4), ss = b(5);
    return new Date(yr, mo - 1, dy, hh, mm, ss).toISOString();
}

/**
 * Calculate NJ protocol body offset from marks byte
 * byte 10 = special markings: Bit0=hasIMEI, Bit1=hasTimestamp
 */
function getBodyOffset(buf) {
    const marks = buf[10];
    const hasTerminalID = (marks & 0x01) !== 0;
    const hasTimestamp  = (marks & 0x02) !== 0;
    let offset = 11;
    if (hasTerminalID) offset += 15;  // Terminal ID 15 bytes
    if (hasTimestamp)  offset += 6;   // BCD time 6 bytes
    return offset;
}

// ── §3.9 buildPacket — NJ Lighting Controller Packet Builder ──

/**
 * Build NJ-iot401 binary packet (4E4A...5852)
 * @param {number} equipType - 0x2F=Lighting, 0x25=Time, 0x2E=Central
 * @param {number} cmd - Command word (e.g. 0x8007)
 * @param {number} msgId - Message sequence ID
 * @param {string} imei - 15-char IMEI
 * @param {Buffer} body - Command body
 * @returns {Buffer} Complete NJ frame
 */
function buildPacket(equipType, cmd, msgId, imei, body) {
    const imeiBytes = Buffer.from(imei.padEnd(15, '\0').slice(0, 15), 'ascii');
    const now = new Date();
    const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10));
    const tsBytes = Buffer.from([
        bcd(now.getFullYear()-2000), bcd(now.getMonth()+1), bcd(now.getDate()),
        bcd(now.getHours()), bcd(now.getMinutes()), bcd(now.getSeconds())
    ]);

    // marks: Bit0=hasIMEI, Bit1=hasTimestamp
    const marks = 0x03;
    const headerFixed = Buffer.from([equipType, (cmd>>8)&0xFF, cmd&0xFF,
                                      (msgId>>8)&0xFF, msgId&0xFF, 0x00, marks]);
    const header = Buffer.concat([headerFixed, imeiBytes, tsBytes]);
    const content = Buffer.concat([header, body]);

    // Length = start(2) + length(2) + content + crc(2) + end(2)
    const totalLen = 2 + 2 + content.length + 2 + 2;
    const pkt = Buffer.alloc(totalLen);
    pkt[0] = 0x4E; pkt[1] = 0x4A;
    pkt.writeUInt16BE(totalLen, 2);
    content.copy(pkt, 4);
    const crcVal = crc16(pkt, 0, 4 + content.length);
    pkt.writeUInt16LE(crcVal, 4 + content.length);
    pkt[totalLen - 2] = 0x58;
    pkt[totalLen - 1] = 0x52;
    return pkt;
}

// ── §3.9 Downlink Builders ───────────────────────────────────

/**
 * Build Query Lamp Status (0x8007)
 */
function buildQueryLampStatus(imei, msgId) {
    return buildPacket(0x2F, 0x8007, msgId, imei, Buffer.alloc(0));
}

/**
 * Build Remote Control Lamp (0x8100)
 * switchPos: 0x00=off, 0x01–0x64=dim 1–100%
 */
function buildControlLamp(imei, msgId, lampNo, switchPos) {
    const body = Buffer.from([0x01, lampNo, switchPos]);
    return buildPacket(0x2F, 0x8100, msgId, imei, body);
}

/**
 * Build Remote Restart (0x8101)
 */
function buildRestart(imei, msgId) {
    return buildPacket(0x2F, 0x8101, msgId, imei, Buffer.alloc(0));
}

/**
 * Build Set System Time (0x8106)
 */
function buildSetTime(imei, msgId) {
    const now = new Date();
    const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10));
    const body = Buffer.from([
        bcd(now.getFullYear() - 2000),
        bcd(now.getMonth() + 1),
        bcd(now.getDate()),
        bcd(now.getHours()),
        bcd(now.getMinutes()),
        bcd(now.getSeconds())
    ]);
    return buildPacket(0x2F, 0x8106, msgId, imei, body);
}

/**
 * Build Solar Light Switch (0xC2) — AC...CA format
 * action: 0xAA=on, 0xAB=off  |  dimRatio: 0–100
 */
function buildSolarLightSwitch(imei, action, dimRatio) {
    const body = Buffer.from([action, dimRatio]);
    const pkt = Buffer.alloc(body.length + 4);
    pkt[0] = 0xAC; pkt[1] = 0xC2;
    pkt[2] = body.length;
    body.copy(pkt, 3);
    pkt[pkt.length - 1] = 0xCA;
    return pkt;
}

/**
 * Build 0xB4 Solar Query
 */
function build0xB4Query(imei, msgId) {
    return buildPacket(0x2F, 0xB4, msgId, imei, Buffer.alloc(0));
}

// ── §3.5 parse_lamp_status (cmd 0x0007) ──────────────────────

function parseLampStatus(buf, bodyOffset, msg) {
    const o = bodyOffset;

    const serialNo    = buf.readUInt16BE(o);
    const controlMode = buf[o + 2];
    const alarmFlag   = buf.readUInt16BE(o + 3);
    const equipTime   = bcdToDate(buf, o + 5);
    const runTime     = buf.readUInt32BE(o + 11);
    const lightTime   = buf.readUInt32BE(o + 15);
    const leakVolt    = buf.readUInt16BE(o + 19);
    const leakCurr    = buf.readUInt16BE(o + 21);
    const waterStatus = buf[o + 23];
    const branchCount = buf[o + 24];

    const branches = [];
    let bOff = o + 25;
    for (let i = 0; i < branchCount; i++) {
        branches.push({
            branch_id:    buf[bOff],
            switch_pos:   buf[bOff + 1],
            voltage:      buf.readUInt16BE(bOff + 2) / 10,
            current:      buf.readUInt16BE(bOff + 4) / 100,
            active_power: buf.readUInt16BE(bOff + 6),
            power_factor: buf[bOff + 8] / 100,
            energy_kwh:   buf.readUInt32BE(bOff + 9) / 100,
        });
        bOff += 13;
    }

    return {
        imei: (msg && msg.imei) || null,
        device_time: equipTime,
        control_mode: controlMode,
        alarm_flag: alarmFlag,
        run_time_h: runTime,
        light_time_h: lightTime,
        leakage_voltage_v: leakVolt,
        leakage_current_ma: leakCurr,
        water_immersion: waterStatus,
        rssi: (msg && msg.rssi) || null,
        branches
    };
}

// ── §3.6 parse_alarm (cmd 0x0008) ────────────────────────────

const ALARM_NAMES = [
    "capacitor_failure", "light_source_failure", "relay_fault",
    "memory_chip_failure", "clock_chip_failure", "config_failure",
    "leakage_alarm", "burglar_alarm", "water_immersion",
    "overcurrent", "overpower", "low_power", "low_voltage", "wiring_error"
];

function parseAlarm(buf, bodyOffset, msg) {
    const alarmFlag = buf.readUInt16BE(bodyOffset);
    const activeAlarms = ALARM_NAMES.filter((_, i) => (alarmFlag >> i) & 1);

    return {
        imei: (msg && msg.imei) || null,
        device_time: (msg && msg.deviceTime) || null,
        alarm_flag: alarmFlag,
        alarms: activeAlarms
    };
}

// ── §3.8 parse_online (cmd 0x0001) ───────────────────────────

function parseOnline(buf, bodyOffset, msg) {
    const o = bodyOffset;
    const lat  = buf.readInt32BE(o)  / 1e6;
    const lng  = buf.readInt32BE(o + 4) / 1e6;
    const iccid = buf.slice(o + 8, o + 28).toString('ascii').trim().replace(/\0/g,'');

    return {
        imei: (msg && msg.imei) || null,
        device_time: (msg && msg.deviceTime) || null,
        event: "online",
        latitude: lat,
        longitude: lng,
        iccid
    };
}

// ── §3.11 NJ Response Parser ─────────────────────────────────

/**
 * Parse NJ protocol response (4E4A...5852)
 * Routes to sub-parsers based on command word
 */
function parseNJResponse(buf, msg) {
    const cmd = (buf[5] << 8) | buf[6];
    const bodyOffset = getBodyOffset(buf);

    switch (cmd) {
        case 0x0007: return { type: "lamp_status",  measurement: "lamp_status", ...parseLampStatus(buf, bodyOffset, msg) };
        case 0x0008: return { type: "alarm_event",  measurement: "alarm_event", ...parseAlarm(buf, bodyOffset, msg) };
        case 0x0001: return { type: "device_event", measurement: "device_event", ...parseOnline(buf, bodyOffset, msg) };
        case 0x00B4: return { type: "solar_data",   measurement: "solar_data",   ...parseSolar0xB4(buf, bodyOffset, msg) };
        default:
            return {
                type: "unknown_nj",
                command: "0x" + cmd.toString(16).toUpperCase().padStart(4, "0"),
                raw_hex: buf.toString("hex").toUpperCase()
            };
    }
}

// ── §3.11 0xB4 Solar Operation Data ─────────────────────────

function parseSolar0xB4(buf, bodyOffset, msg) {
    const o = bodyOffset;
    const dayNight  = buf[o];
    const battType  = buf[o + 1];
    const swVersion = buf[o + 2];
    const battV     = buf.readUInt16BE(o + 3)  / 100;
    const loadA     = buf.readUInt16BE(o + 5)  / 100;
    const loadV     = buf.readUInt16BE(o + 7)  / 10;
    const pvV       = buf.readUInt16BE(o + 9)  / 10;
    const pvA       = buf.readUInt16BE(o + 11) / 100;
    const errFlags  = buf.readUInt16BE(o + 13);
    const cumDischg = buf.readUInt32BE(o + 15) / 100;  // kWh
    const cumChg    = buf.readUInt32BE(o + 19) / 100;  // kWh
    const extTemp   = buf.readUInt16BE(o + 23) / 10;    // °C (ambient)
    const intTemp   = buf.readUInt16BE(o + 25) / 10;    // °C (equipment)

    return {
        imei: (msg && msg.imei) || null,
        day_night: dayNight === 0 ? "day" : "night",
        battery_type: battType,
        sw_version: swVersion,
        battery_voltage: battV,
        load_current: loadA,
        load_voltage: loadV,
        load_power: +(loadV * loadA).toFixed(2),
        pv_voltage: pvV,
        pv_current: pvA,
        pv_power: +(pvV * pvA).toFixed(2),
        battery_current: +(loadA - pvA).toFixed(2),
        battery_power: +(battV * (loadA - pvA)).toFixed(2),
        error_flags: errFlags,
        cumulative_discharge_kwh: cumDischg,
        cumulative_charge_kwh: cumChg,
        ambient_temp_c: extTemp,
        equipment_temp_c: intTemp,
        update_time: (msg && msg.deviceTime) || null,
    };
}

// ── Exports ──────────────────────────────────────────────────

module.exports = {
    // Helpers (§3.3)
    crc16,
    bcdToDate,
    getBodyOffset,

    // Packet builder (§3.9)
    buildPacket,

    // Downlink builders (§3.9, §3.12)
    buildQueryLampStatus,
    buildControlLamp,
    buildRestart,
    buildSetTime,
    buildSolarLightSwitch,
    build0xB4Query,

    // NJ response parsers (§3.5, §3.6, §3.8, §3.11)
    parseNJResponse,
    parseLampStatus,
    parseAlarm,
    parseOnline,
    parseSolar0xB4,
};
