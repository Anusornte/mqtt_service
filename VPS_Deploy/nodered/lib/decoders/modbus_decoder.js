// CRC16 Modbus (polynomial 0xA001)
function crc16(buf, length) {
    let crc = 0xFFFF;
    for (let i = 0; i < length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
        }
    }
    return crc;
}

function verifyCRC(buf) {
    if (buf.length < 4) return false;
    const calc = crc16(buf, buf.length - 2);
    const recv = buf[buf.length - 2] | (buf[buf.length - 1] << 8);
    return calc === recv;
}

function signed16(val) {
    return val > 0x7FFF ? val - 0x10000 : val;
}

// Decode Modbus RTU FC03 response from M1280 Solar Charge Controller
// Register base: 0x3000 (Real-Time Data)
function decodeModbus(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 5) {
        return { type: "error", reason: "too_short", length: buf ? buf.length : 0 };
    }

    const fc = buf[1];

    if (fc & 0x80) {
        return { type: "error", reason: "modbus_exception", exception_code: buf[2], fc: fc & 0x7F };
    }

    if (fc !== 0x03) {
        return { type: "error", reason: "unexpected_fc", fc };
    }

    if (!verifyCRC(buf)) {
        return { type: "error", reason: "crc_mismatch", raw: buf.toString("hex") };
    }

    const byteCount = buf[2];
    const data = buf.slice(3, 3 + byteCount);

    const regs = [];
    for (let i = 0; i + 1 < data.length; i += 2) {
        regs.push(data.readUInt16BE(i));
    }

    const r   = (i)       => regs[i] ?? 0;
    const r32 = (lo, hi)  => r(hi) * 65536 + r(lo);

    return {
        type: "telemetry",
        slave_id: buf[0],
        pv: {
            voltage: +(r(0)        * 0.01).toFixed(2),   // V  (0x3000)
            current: +(r(1)        * 0.01).toFixed(2),   // A  (0x3001)
            power:   +(r32(2, 3)   * 0.01).toFixed(2),   // W  (0x3002-3003)
        },
        battery: {
            voltage: +(r(4)        * 0.01).toFixed(2),   // V  (0x3004)
            current: +(r(5)        * 0.01).toFixed(2),   // A  (0x3005)
            power:   +(r32(6, 7)   * 0.01).toFixed(2),   // W  (0x3006-3007)
            temp:    +(signed16(r(9)) * 0.01).toFixed(1),// °C (0x3009)
            soc:     r(18),                               // %  (0x3012)
        },
        controller: {
            temp: +(signed16(r(8)) * 0.01).toFixed(1),   // °C (0x3008)
        },
        load: {
            voltage: +(r(14)       * 0.01).toFixed(2),   // V  (0x300E)
            current: +(r(15)       * 0.01).toFixed(2),   // A  (0x300F)
            power:   +(r32(16, 17) * 0.01).toFixed(2),   // W  (0x3010-3011)
            state:   r(15) > 0 ? 1 : 0,
        },
        raw: buf.toString("hex"),
    };
}

module.exports = { decodeModbus, verifyCRC };
