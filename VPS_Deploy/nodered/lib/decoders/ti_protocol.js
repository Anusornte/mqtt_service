const V_SCALE = 170.7;

function decodeTIProtocol(data) {
    if (data.length < 15) {
        return { type: "error", reason: "payload_too_short", length: data.length };
    }

    if (data[0] !== 0x54 || data[1] !== 0x49 || data[2] !== 0x26 || data[3] !== 0x06) {
        return {
            type: "error",
            reason: "invalid_header",
            header: Buffer.from(data.slice(0, 4)).toString("hex")
        };
    }

    const msgType = data[13];

    if (msgType !== 4 || data.length < 56) {
        return {
            type: "short_status",
            msgType,
            length: data.length,
            raw: Buffer.from(data).toString("hex")
        };
    }

    function be16(i) { return (data[i] << 8) | data[i + 1]; }
    function toV(raw) { return Math.round(raw / V_SCALE * 100) / 100; }

    return {
        type: "full_telemetry",
        solar: {
            voltage_v:  toV(be16(15)),   // ✅ confirmed
            current_a:  null,            // ❌ TBD
            power_w:    null             // = V × A
        },
        battery: {
            voltage_v:  toV(be16(17)),   // ✅ confirmed
            current_a:  null,            // ❌ TBD
            power_w:    null,
            soc_pct:    null             // ❌ TBD
        },
        load: {
            voltage_v:  toV(be16(19)),   // ✅ confirmed
            current_a:  null,            // ❌ TBD
            power_w:    null,
            state:      null             // ❌ TBD
        },
        daily: {
            discharge:  data[32],        // ✅ confirmed
            charge:     data[36]         // ✅ confirmed
        },
        temperature: {
            equipment_c: null,           // ❌ TBD
            ambient_c:   null            // ❌ TBD
        },
        crc_raw: Buffer.from(data.slice(54, 56)).toString("hex"),
        raw: Buffer.from(data).toString("hex")
    };
}

function extractEMEI(topic) {
    const parts = topic.split("/");
    return parts.length >= 3 ? parts[2] : null;
}

module.exports = { decodeTIProtocol, extractEMEI, V_SCALE };
