const V_SCALE = 170.7;

function decodeTIProtocol(data) {
    if (data.length < 15) {
        return { type: "error", reason: "payload_too_short", length: data.length };
    }

    const header = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (header !== "TI&\x06") {
        return { type: "error", reason: "invalid_header", header };
    }

    const msgType = data[13];

    if (msgType !== 4 || data.length < 56) {
        return {
            type: "short_status",
            msgType,
            raw: Buffer.from(data).toString("hex")
        };
    }

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

function extractEMEI(topic) {
    const parts = topic.split("/");
    return parts.length >= 3 ? parts[2] : null;
}

module.exports = { decodeTIProtocol, extractEMEI, V_SCALE };
