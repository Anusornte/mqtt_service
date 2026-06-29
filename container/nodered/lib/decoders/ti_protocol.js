/**
 * TI& Protocol Decoder — equipment2596
 * ถอดรหัส Binary Payload จาก NJ-iot401 → Solar Telemetry
 *
 * Protocol: TI& (0x54492606)
 * Source:   NJ-iot401_MQTT_Binary_Decoder.md
 */

const V_SCALE = 170.7;

/**
 * Decode TI& binary protocol payload
 * @param {Buffer|Uint8Array} data - Raw binary payload
 * @returns {Object} Decoded telemetry values
 */
function decodeTIProtocol(data) {
    // Validate header
    if (data.length < 15) {
        return { type: "error", reason: "payload_too_short", length: data.length };
    }

    const header = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (header !== "TI&\x06") {
        return { type: "error", reason: "invalid_header", header };
    }

    const msgType = data[13];

    // Short status (type=16) — no telemetry data
    if (msgType !== 4 || data.length < 56) {
        return {
            type: "short_status",
            msgType,
            raw: Buffer.from(data).toString("hex")
        };
    }

    // Full telemetry (type=4, 56+ bytes)
    return {
        type: "full_telemetry",
        solar_voltage_v:   ((data[15] << 8) | data[16]) / V_SCALE,
        battery_voltage_v: ((data[17] << 8) | data[18]) / V_SCALE,
        load_voltage_v:    ((data[19] << 8) | data[20]) / V_SCALE,
        daily_discharge:   data[32],
        daily_charge:      data[36],
        raw:               Buffer.from(data).toString("hex")
    };
}

/**
 * Extract EMEI from MQTT topic
 * @param {string} topic - MQTT topic e.g. "/solar/864865083327800/pub"
 * @returns {string|null} EMEI
 */
function extractEMEI(topic) {
    const parts = topic.split("/");
    // topic format: /solar/{EMEI}/pub or /solar/{EMEI}/sub
    return parts.length >= 3 ? parts[2] : null;
}

module.exports = { decodeTIProtocol, extractEMEI, V_SCALE };
