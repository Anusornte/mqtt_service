// ============================================================
// byte_explorer.js — TI Protocol Byte-by-Byte Explorer
// Device: LCS-TH (EMEI 864865083329673)
// Purpose: แสดงความหมายทุก byte จาก 2 แหล่งข้อมูล (dual interpretation)
//          เพื่อช่วย reverse-engineer bytes ที่ยังไม่รู้ความหมาย
// ============================================================

function u8(buf, off)  { return buf[off]; }
function u16le(buf, off) { return buf[off] | (buf[off + 1] << 8); }
function u16be(buf, off) { return (buf[off] << 8) | buf[off + 1]; }
function s8(buf, off)  { const v = buf[off]; return v > 127 ? v - 256 : v; }
function hex(v, len)   { return "0x" + v.toString(16).toUpperCase().padStart(len || 2, "0"); }
function ascii(b)      { return (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : "·"; }

// ── Calibration formulas (parser_Encoder.md) ─────────────────

function formula_pvV(raw)      { return +(raw * 0.005592 + 1.2067).toFixed(2); }   // R²=0.99  MAE=0.17V
function formula_ambTemp(raw)  { return +(raw * 0.064121 - 105.8627).toFixed(1); } // R²=0.82  MAE=2.8°C
function formula_batA(stg)     { return +(stg * 0.002433 + 0.2061).toFixed(3); }  // R²=0.997 MAE=0.12A
function formula_pvA(stg)      { return +(stg * 0.002219 + 0.1231).toFixed(3); }  // R²=0.994 MAE=0.15A
function formula_batW(stg)     { return +(stg * 0.033327 + 2.6157).toFixed(1); }  // R²=0.996 MAE=2.0W
function formula_pvW(stg)      { return +(stg * 0.035082 + 2.7526).toFixed(1); }  // R²=0.996 MAE=1.9W

function estimateBatV(stg, dailyWh, socVal) {
    const s = socVal || 54;
    if (stg === 0) return dailyWh > 150 ? 14.25 : +(12.8 + (s - 20) * 0.015).toFixed(2);
    if (stg <= 512)  return 13.45;
    if (stg <= 2048) return 13.65;
    return 13.80;
}

function chargeLabel(stg, dailyWh) {
    if (stg === 0) return dailyWh > 150 ? "idle (full)" : "idle (morning)";
    if (stg <= 512)  return "float";
    if (stg <= 2048) return "bulk";
    return "absorption";
}

// ── BCD timestamp decode ─────────────────────────────────────

function bcd(b) { return (b >> 4) * 10 + (b & 0x0F); }
function decodeBCD(buf, off) {
    const yr = 2000 + bcd(buf[off]), mo = bcd(buf[off + 1]), dy = bcd(buf[off + 2]);
    const hh = bcd(buf[off + 3]), mi = bcd(buf[off + 4]), ss = bcd(buf[off + 5]);
    const chinaMs = Date.UTC(yr, mo - 1, dy, hh, mi, ss) - 8 * 3600 * 1000;
    const thai    = new Date(chinaMs + 7 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    return pad(thai.getUTCHours()) + ":" + pad(thai.getUTCMinutes()) + ":" + pad(thai.getUTCSeconds())
         + " " + pad(thai.getUTCDate()) + "/" + pad(thai.getUTCMonth() + 1) + "/" + thai.getUTCFullYear()
         + " (UTC+7 Thai)";
}

// ============================================================
// Byte definition table — ALL 56 bytes, dual interpretation
// ============================================================

/**
 * Each entry: { offset, size, field_lcs, field_devproto, confidence, rawLabels, decode }
 *
 * field_lcs:  interpretation from parser_Encoder.md (LCS-TH calibrated, LE endian)
 * field_devproto: interpretation from DEVICE_PROTOCOL_equipment2596.md (BE endian, ÷170.7)
 * confidence: CONFIRMED | CALIBRATED | TBD | UNKNOWN
 * rawLabels:  array of {label, width, endian} for raw value display
 * decode:     function(buf, offset) → decoded human-readable value (or null)
 */

const BYTE_MAP = [
    // ── Bytes 0-3: Start Marker ──────────────────────────────
    {
        offset: 0, size: 4, span: "0-3",
        group: "Start Marker",
        field_lcs:      "TI marker [0] = 'T' (0x54)",
        field_devproto: "TI&\\x06 marker [0] = 'T' (0x54)",
        confidence: "CONFIRMED",
        rawLabels: [{ label: "ASCII", fn: (buf, o) => "'" + ascii(buf[o]) + "'" }],
        decode: (buf, o) => null
    },
    {
        offset: 1, size: 4, span: "0-3",
        group: "Start Marker",
        field_lcs:      "TI marker [1] = 'I' (0x49)",
        field_devproto: "TI&\\x06 marker [1] = 'I' (0x49)",
        confidence: "CONFIRMED",
        rawLabels: [{ label: "ASCII", fn: (buf, o) => "'" + ascii(buf[o]) + "'" }],
        decode: (buf, o) => null
    },
    {
        offset: 2, size: 4, span: "0-3",
        group: "Start Marker",
        field_lcs:      "TI marker [2] (usually 0x26 '&')",
        field_devproto: "TI&\\x06 marker [2] = '&' (0x26)",
        confidence: "CONFIRMED",
        rawLabels: [{ label: "ASCII", fn: (buf, o) => "'" + ascii(buf[o]) + "'" }],
        decode: (buf, o) => null
    },
    {
        offset: 3, size: 4, span: "0-3",
        group: "Start Marker",
        field_lcs:      "TI marker [3] (usually 0x06)",
        field_devproto: "TI&\\x06 marker [3] = 0x06",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 4-7: Timestamp ─────────────────────────────────
    {
        offset: 4, size: 1, span: "4",
        group: "Timestamp (BCD)",
        field_lcs:      "BCD Year (20YY) — YY = " + "?",
        field_devproto: "Constant 0x28? (seen in all samples)",
        confidence: "CALIBRATED",
        rawLabels: [{ label: "BCD", fn: (buf, o) => "20" + bcd(buf[o]) }],
        decode: (buf, o) => null
    },
    {
        offset: 5, size: 1, span: "5",
        group: "Timestamp (BCD)",
        field_lcs:      "BCD Month (01-12)",
        field_devproto: "Varies with load/solar — TBD",
        confidence: "CALIBRATED",
        rawLabels: [{ label: "BCD", fn: (buf, o) => String(bcd(buf[o])).padStart(2, "0") }],
        decode: (buf, o) => null
    },
    {
        offset: 6, size: 1, span: "6",
        group: "Timestamp (BCD)",
        field_lcs:      "BCD Day (01-31)",
        field_devproto: "Varies with load/solar — TBD",
        confidence: "CALIBRATED",
        rawLabels: [{ label: "BCD", fn: (buf, o) => String(bcd(buf[o])).padStart(2, "0") }],
        decode: (buf, o) => null
    },
    {
        offset: 7, size: 1, span: "7",
        group: "Timestamp (BCD)",
        field_lcs:      "BCD Hour (00-23, China UTC+8)",
        field_devproto: "Varies with load/solar — TBD",
        confidence: "CALIBRATED",
        rawLabels: [
            { label: "BCD", fn: (buf, o) => String(bcd(buf[o])).padStart(2, "0") },
            { label: "UTC+8→TH", fn: (buf, o) => String((bcd(buf[o]) - 1 + 24) % 24).padStart(2, "0") + ":??" }
        ],
        decode: (buf, o) => null
    },
    {
        offset: 8, size: 1, span: "8",
        group: "Timestamp (BCD)",
        field_lcs:      "BCD Minute (00-59)",
        field_devproto: "Constant 0x12?",
        confidence: "TBD",
        rawLabels: [{ label: "BCD", fn: (buf, o) => String(bcd(buf[o])).padStart(2, "0") }],
        decode: (buf, o) => null
    },
    {
        offset: 9, size: 1, span: "9",
        group: "Timestamp (BCD)",
        field_lcs:      "BCD Second (00-59)",
        field_devproto: "Constant 0xAA?",
        confidence: "TBD",
        rawLabels: [{ label: "BCD", fn: (buf, o) => String(bcd(buf[o])).padStart(2, "0") }],
        decode: (buf, o) => null
    },
    // ⚠️ Note: parser_Encoder says bytes 2-7=BCD, bytes 8-9 are msgType+signal
    // DEVICE_PROTOCOL says bytes 8-9=0x12 0xAA constants
    // The "true" timestamp might only be 4 bytes, or at different offset

    // ── Bytes 8-9: Message Type + Signal (LCS-TH) ───────────
    // These conflict — two possible interpretations:
    {
        offset: 8, size: 1, span: "8",
        group: "Header",
        field_lcs:      "msgType (0x12 = periodic telemetry)",
        field_devproto: "Constant 0x12 (=18)",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => {
            const v = buf[o];
            const map = { 0x12: "periodic telemetry", 0x04: "short status?" };
            return map[v] || ("unknown 0x" + v.toString(16));
        }
    },
    {
        offset: 9, size: 1, span: "9",
        group: "Header",
        field_lcs:      "Signal strength (signed: 0xAA = -86 dBm)",
        field_devproto: "Constant 0xAA (=170)?",
        confidence: "CONFIRMED",
        rawLabels: [
            { label: "unsigned", fn: (buf, o) => String(buf[o]) },
            { label: "signed dBm", fn: (buf, o) => String(buf[o] > 127 ? buf[o] - 256 : buf[o]) + " dBm" }
        ],
        decode: (buf, o) => {
            const dBm = buf[o] > 127 ? buf[o] - 256 : buf[o];
            return dBm + " dBm" + (dBm < -90 ? " (weak)" : dBm < -70 ? " (ok)" : " (good)");
        }
    },

    // ── Bytes 10-11: Unknown / Constant ──────────────────────
    {
        offset: 10, size: 2, span: "10-11",
        group: "Header",
        field_lcs:      "Unknown (always 00 00) — maybe reserved",
        field_devproto: "Constant 0x0000",
        confidence: "CONFIRMED", // both agree it's always 0
        rawLabels: [
            { label: "u16 LE", fn: (buf, o) => String(u16le(buf, o)) },
            { label: "u16 BE", fn: (buf, o) => String(u16be(buf, o)) }
        ],
        decode: (buf, o) => u16le(buf, o) === 0 ? "always 0x0000" : "⚠ NON-ZERO: " + u16le(buf, o)
    },
    {
        offset: 11, size: 2, span: "10-11",
        group: "Header",
        field_lcs:      "(byte 11 of 00 00 pair)",
        field_devproto: "(byte 11 of 0x0000 pair)",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Byte 12: Sequence ────────────────────────────────────
    {
        offset: 12, size: 1, span: "12",
        group: "Header",
        field_lcs:      "Sequence counter (increments each message)",
        field_devproto: "Constant 0x01?",
        confidence: "CALIBRATED",
        rawLabels: [],
        decode: (buf, o) => "seq=" + buf[o]
    },

    // ── Byte 13: Message Type / Constant ─────────────────────
    {
        offset: 13, size: 1, span: "13",
        group: "Header",
        field_lcs:      "Unknown (always 04) — padding?",
        field_devproto: "⚡ MESSAGE TYPE: 4=Full 56B, 16=Short 21B",
        confidence: "TBD",
        rawLabels: [],
        decode: (buf, o) => {
            const v = buf[o];
            if (v === 4)  return "4 → LCS-TH:unknown / DEVPROTO:Full 56B telemetry";
            if (v === 16) return "16 → LCS-TH:unknown / DEVPROTO:Short 21B status";
            return v + " → unexpected";
        }
    },

    // ── Bytes 14-15: PV Voltage (LE) vs Solar Voltage (BE) ──
    {
        offset: 14, size: 2, span: "14-15",
        group: "⚡ VOLTAGE PAIR",
        field_lcs:      "PV Voltage ADC (uint16 LE) → pvV = raw × 0.005592 + 1.2067",
        field_devproto: "Solar Panel Voltage (uint16 BE) → ÷170.7 = V",
        confidence: "CALIBRATED",
        rawLabels: [
            { label: "u16LE raw", fn: (buf, o) => String(u16le(buf, o)) },
            { label: "u16BE raw", fn: (buf, o) => String(u16be(buf, o)) }
        ],
        decode: (buf, o) => {
            const le = u16le(buf, o);
            const be = u16be(buf, o);
            return "LE=" + le + " → " + formula_pvV(le) + "V (R²=0.99)"
                 + "  |  BE=" + be + " → " + (be / 170.7).toFixed(2) + "V (÷170.7)";
        }
    },
    {
        offset: 15, size: 2, span: "14-15",
        group: "⚡ VOLTAGE PAIR",
        field_lcs:      "(byte 15 of PV Voltage LE pair)",
        field_devproto: "(byte 15 of Solar V BE pair)",
        confidence: "CALIBRATED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 16-17: Temperature (LE) vs Battery V (BE) ─────
    {
        offset: 16, size: 2, span: "16-17",
        group: "⚡ VOLTAGE/TEMP PAIR",
        field_lcs:      "Temperature ADC (uint16 LE) → ambTemp = raw × 0.064121 − 105.8627",
        field_devproto: "Battery Voltage (uint16 BE) → ÷170.7 = V",
        confidence: "CALIBRATED",
        rawLabels: [
            { label: "u16LE raw", fn: (buf, o) => String(u16le(buf, o)) },
            { label: "u16BE raw", fn: (buf, o) => String(u16be(buf, o)) }
        ],
        decode: (buf, o) => {
            const le = u16le(buf, o);
            const be = u16be(buf, o);
            return "LE=" + le + " → " + formula_ambTemp(le) + "°C (R²=0.82, MAE=2.8°C)"
                 + "  |  BE=" + be + " → " + (be / 170.7).toFixed(2) + "V (÷170.7)";
        }
    },
    {
        offset: 17, size: 2, span: "16-17",
        group: "⚡ VOLTAGE/TEMP PAIR",
        field_lcs:      "(byte 17 of Temp LE pair)",
        field_devproto: "(byte 17 of Battery V BE pair)",
        confidence: "CALIBRATED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 18-21: ⚡ LOAD VOLTAGE + LOAD CURRENT ───────────
    // ✅ Confirmed 2026-06-30 via ON/OFF test (cloud command → diff)
    {
        offset: 18, size: 4, span: "18-21",
        group: "⚡ LOAD BLOCK",
        field_lcs:      "Load Voltage high byte (u16LE 18-19)",
        field_devproto: "TBD",
        confidence: "CALIBRATED",
        rawLabels: [
            { label: "u16LE(18)", fn: (buf, o) => String(u16le(buf, 18)) },
            { label: "u16BE(18)", fn: (buf, o) => String(u16be(buf, 18)) }
        ],
        decode: (buf, o) => {
            const le = u16le(buf, 18);
            return "u16LE=" + le + " — varies with load (OFF~230, ON~7348)";
        }
    },
    {
        offset: 19, size: 4, span: "18-21",
        group: "⚡ LOAD BLOCK",
        field_lcs:      "Load Voltage low byte (part of u16LE pair with 18)",
        field_devproto: "TBD",
        confidence: "CALIBRATED",
        rawLabels: [],
        decode: (buf, o) => null
    },
    {
        offset: 20, size: 2, span: "20-21",
        group: "⚡ LOAD CURRENT ✅",
        field_lcs:      "Load Current (uint16 LE, mA) — 0 when OFF, 656mA when ON",
        field_devproto: "TBD",
        confidence: "CONFIRMED",
        rawLabels: [
            { label: "u16LE mA", fn: (buf, o) => {
                const ma = u16le(buf, 20);
                return ma + " mA = " + (ma / 1000).toFixed(2) + " A";
            }},
            { label: "u16BE", fn: (buf, o) => String(u16be(buf, 20)) }
        ],
        decode: (buf, o) => {
            const ma = u16le(buf, 20);
            if (ma === 0) return "0 mA — LED OFF";
            return ma + " mA (" + (ma/1000).toFixed(2) + "A) — LED ON";
        }
    },
    {
        offset: 21, size: 2, span: "20-21",
        group: "⚡ LOAD CURRENT ✅",
        field_lcs:      "Load Current high byte (part of u16LE mA pair with 20)",
        field_devproto: "TBD",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 22-23: Current Indicator ───────────────────────
    {
        offset: 22, size: 2, span: "22-23",
        group: "⚡ CURRENT INDICATOR",
        field_lcs:      "Charge Stage Indicator (uint16 LE) → batA/pvA/batW/pvW",
        field_devproto: "Unknown — no mapping",
        confidence: "CALIBRATED",
        rawLabels: [
            { label: "u16LE raw", fn: (buf, o) => String(u16le(buf, o)) },
            { label: "u16BE raw", fn: (buf, o) => String(u16be(buf, o)) },
            { label: "batA (LE)", fn: (buf, o) => formula_batA(u16le(buf, o)) + "A" },
            { label: "pvA (LE)", fn: (buf, o) => formula_pvA(u16le(buf, o)) + "A" },
            { label: "batW (LE)", fn: (buf, o) => formula_batW(u16le(buf, o)) + "W" },
            { label: "pvW (LE)", fn: (buf, o) => formula_pvW(u16le(buf, o)) + "W" }
        ],
        decode: (buf, o) => {
            const stg = u16le(buf, o);
            return "stage=" + stg + " → batA=" + formula_batA(stg) + "A"
                 + " pvA=" + formula_pvA(stg) + "A"
                 + " batW=" + formula_batW(stg) + "W"
                 + " pvW=" + formula_pvW(stg) + "W"
                 + " [" + chargeLabel(stg, u16le(buf, 36)) + "]";
        }
    },
    {
        offset: 23, size: 2, span: "22-23",
        group: "⚡ CURRENT INDICATOR",
        field_lcs:      "(byte 23 of charge stage LE pair)",
        field_devproto: "Unknown",
        confidence: "CALIBRATED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 24-31: Unknown / Battery ───────────────────────
    ...[24, 25, 26, 27, 28, 29, 30, 31].map(off => ({
        offset: off, size: 1, span: String(off),
        group: "Unknown Block B (battery?)",
        field_lcs:      "Unknown / battery-related",
        field_devproto: "Unknown — TBD",
        confidence: "UNKNOWN",
        rawLabels: off < 29 ? [
            { label: "u16LE(" + off + ")", fn: (buf, o) => String(u16le(buf, off)) },
            { label: "u16BE(" + off + ")", fn: (buf, o) => String(u16be(buf, off)) }
        ] : [],
        decode: (buf, o) => {
            if (off === 24) return "u16LE(24)=" + u16le(buf, 24) + " u16BE(24)=" + u16be(buf, 24);
            if (off === 26) return "u16LE(26)=" + u16le(buf, 26) + " u16BE(26)=" + u16be(buf, 26);
            if (off === 28) return "u16LE(28)=" + u16le(buf, 28) + " u16BE(28)=" + u16be(buf, 28);
            if (off === 30) return "u16LE(30)=" + u16le(buf, 30) + " u16BE(30)=" + u16be(buf, 30);
            return null;
        }
    })),

    // ── Bytes 32-33: Daily Discharge ─────────────────────────
    {
        offset: 32, size: 2, span: "32-33",
        group: "✅ DAILY DISCHARGE",
        field_lcs:      "Daily discharge Wh (uint16 LE, direct value)",
        field_devproto: "Daily Discharge (uint8, ×1 = Wh/Ah)",
        confidence: "CONFIRMED",
        rawLabels: [
            { label: "u16LE", fn: (buf, o) => u16le(buf, o) + " Wh" },
            { label: "uint8", fn: (buf, o) => buf[o] + " (as u8)" }
        ],
        decode: (buf, o) => {
            const le = u16le(buf, o);
            return le + " Wh (u16LE) | u8=" + buf[o] + " — both agree on direct value";
        }
    },
    {
        offset: 33, size: 2, span: "32-33",
        group: "✅ DAILY DISCHARGE",
        field_lcs:      "(byte 33 of discharge LE pair)",
        field_devproto: "Unknown — TBD",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 34-35: Unknown ─────────────────────────────────
    {
        offset: 34, size: 2, span: "34-35",
        group: "Unknown Block C",
        field_lcs:      "Unknown",
        field_devproto: "Unknown — TBD",
        confidence: "UNKNOWN",
        rawLabels: [
            { label: "u16LE(34)", fn: (buf, o) => String(u16le(buf, 34)) },
            { label: "u16BE(34)", fn: (buf, o) => String(u16be(buf, 34)) }
        ],
        decode: (buf, o) => "u16LE=" + u16le(buf, 34) + " u16BE=" + u16be(buf, 34)
    },
    {
        offset: 35, size: 2, span: "34-35",
        group: "Unknown Block C",
        field_lcs:      "Unknown",
        field_devproto: "Unknown — TBD",
        confidence: "UNKNOWN",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 36-37: Daily Charge ────────────────────────────
    {
        offset: 36, size: 2, span: "36-37",
        group: "✅ DAILY CHARGE",
        field_lcs:      "Daily charge Wh (uint16 LE, direct = Wh solar today)",
        field_devproto: "Daily Charge (uint8, ×1 = Wh/Ah)",
        confidence: "CONFIRMED",
        rawLabels: [
            { label: "u16LE", fn: (buf, o) => u16le(buf, o) + " Wh" },
            { label: "uint8", fn: (buf, o) => buf[o] + " (as u8)" }
        ],
        decode: (buf, o) => {
            const le = u16le(buf, o);
            return le + " Wh (u16LE) | u8=" + buf[o] + " — solar energy today";
        }
    },
    {
        offset: 37, size: 2, span: "36-37",
        group: "✅ DAILY CHARGE",
        field_lcs:      "(byte 37 of charge LE pair)",
        field_devproto: "Unknown — TBD",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 38-39: Lamp Mode ───────────────────────────────
    {
        offset: 38, size: 2, span: "38-39",
        group: "✅ LAMP MODE",
        field_lcs:      "Lamp mode (uint16 LE, 1/2/3/4/7)",
        field_devproto: "Unknown — TBD",
        confidence: "CONFIRMED",
        rawLabels: [
            { label: "u16LE", fn: (buf, o) => String(u16le(buf, o)) },
            { label: "uint8", fn: (buf, o) => String(buf[o]) }
        ],
        decode: (buf, o) => {
            const mode = u16le(buf, o);
            const map = { 1: "timer1", 2: "timer2", 3: "always ON", 4: "OFF (daytime)", 7: "🔥 Induction" };
            return "mode=" + mode + " → " + (map[mode] || "unknown mode");
        }
    },
    {
        offset: 39, size: 2, span: "38-39",
        group: "✅ LAMP MODE",
        field_lcs:      "(byte 39 of lamp mode LE pair — usually 00)",
        field_devproto: "Unknown — TBD",
        confidence: "CONFIRMED",
        rawLabels: [],
        decode: (buf, o) => null
    },

    // ── Bytes 40-45: Status ──────────────────────────────────
    ...[40, 41, 42, 43, 44, 45].map(off => ({
        offset: off, size: 1, span: String(off),
        group: "Status Bytes",
        field_lcs:      off === 41
            ? "SOC / Rated Ah (byte 41 = " + "?" + ") — possible battery capacity"
            : "Status byte " + off + " — TBD",
        field_devproto: "Unknown — TBD",
        confidence: off === 41 ? "TBD" : "UNKNOWN",
        rawLabels: off === 41 ? [{ label: "SOC?", fn: (buf, o) => buf[o] + " (maybe Ah or %)" }] : [],
        decode: (buf, o) => {
            if (off === 41) return buf[o] + " — interpreted as SOC=" + buf[o] + "% or rated " + buf[o] + "Ah";
            return null;
        }
    })),

    // ── Bytes 46-47: Unknown Padding ─────────────────────────
    ...[46, 47].map(off => ({
        offset: off, size: 1, span: String(off),
        group: "Padding?",
        field_lcs:      "Unknown (padding?)",
        field_devproto: "Unknown — TBD",
        confidence: "UNKNOWN",
        rawLabels: [],
        decode: (buf, o) => null
    })),

    // ── Bytes 48-55: CRC / Padding ───────────────────────────
    ...[48, 49, 50, 51, 52, 53].map(off => ({
        offset: off, size: 1, span: String(off),
        group: "CRC / Padding",
        field_lcs:      "Padding / CRC bytes",
        field_devproto: "Unknown — TBD",
        confidence: "UNKNOWN",
        rawLabels: [],
        decode: (buf, o) => null
    })),
    {
        offset: 54, size: 2, span: "54-55",
        group: "✅ CRC16",
        field_lcs:      "CRC byte 0 (part of CRC16?)",
        field_devproto: "CRC byte 0",
        confidence: "TBD",
        rawLabels: [
            { label: "u16LE(54)", fn: (buf, o) => "0x" + u16le(buf, 54).toString(16).toUpperCase().padStart(4, "0") }
        ],
        decode: (buf, o) => {
            const crc = u16le(buf, 54);
            return "crc16=" + crc + " (0x" + crc.toString(16).toUpperCase().padStart(4, "0") + ")"
                 + " — algorithm TBD (maybe CRC16/MODBUS of bytes 0-53?)";
        }
    },
    {
        offset: 55, size: 2, span: "54-55",
        group: "✅ CRC16",
        field_lcs:      "CRC byte 1",
        field_devproto: "CRC byte 1",
        confidence: "TBD",
        rawLabels: [],
        decode: (buf, o) => null
    }
];

// ============================================================
// Main export: exploreBytes(buf)
// ============================================================

function exploreBytes(buf) {
    if (!Buffer.isBuffer(buf)) {
        buf = Buffer.from(buf || []);
    }

    const length = buf.length;
    const rows = [];

    for (const def of BYTE_MAP) {
        const off = def.offset;

        // Skip if byte doesn't exist in this buffer
        if (off >= length) continue;

        const rawVals = [];
        for (const rl of def.rawLabels) {
            try {
                rawVals.push({ label: rl.label, value: rl.fn(buf, off) });
            } catch (e) {
                rawVals.push({ label: rl.label, value: "ERR" });
            }
        }

        var decoded = null;
        try {
            decoded = def.decode ? def.decode(buf, off) : null;
        } catch (e) {
            decoded = "ERR: " + e.message;
        }

        rows.push({
            offset: off,
            hex: hex(buf[off]),
            dec: buf[off],
            ascii: ascii(buf[off]),
            span: def.span,
            group: def.group,
            confidence: def.confidence,
            field_lcs: def.field_lcs,
            field_devproto: def.field_devproto,
            rawValues: rawVals,
            decoded: decoded
        });
    }

    // ── BCD Timestamp (bytes 2-7) ───────────────────────────
    var bcdTimestamp = null;
    if (length >= 8) {
        try { bcdTimestamp = decodeBCD(buf, 2); } catch (e) { bcdTimestamp = "parse error"; }
    }

    // ── Summary counts ───────────────────────────────────────
    const count = { CONFIRMED: 0, CALIBRATED: 0, TBD: 0, UNKNOWN: 0 };
    const seen = new Set();
    for (const row of rows) {
        if (!seen.has(row.offset)) {
            seen.add(row.offset);
            count[row.confidence] = (count[row.confidence] || 0) + 1;
        }
    }

    // ── Key decoded values (cross-reference) ─────────────────
    var keyValues = {};
    if (length >= 56) {
        const pv_le  = u16le(buf, 14);
        const tmp_le = u16le(buf, 16);
        const stg    = u16le(buf, 22);
        const chgWh  = u16le(buf, 36);
        const lamp   = u16le(buf, 38);
        const batV   = estimateBatV(stg, chgWh, buf[41]);

        keyValues = {
            "PV Voltage (LE, R²=0.99)": formula_pvV(pv_le) + " V",
            "PV Voltage (BE, ÷170.7)": (u16be(buf, 14) / 170.7).toFixed(2) + " V",
            "Ambient Temp (LE, R²=0.82)": formula_ambTemp(tmp_le) + " °C",
            "Battery V (BE, ÷170.7)": (u16be(buf, 16) / 170.7).toFixed(2) + " V",
            "Battery V (LiFePO4 model)": batV + " V (MAE=0.08V)",
            "Charge Stage": stg + " (" + chargeLabel(stg, chgWh) + ")",
            "Battery Current": formula_batA(stg) + " A",
            "PV Current": formula_pvA(stg) + " A",
            "Battery Power": formula_batW(stg) + " W",
            "PV Power": formula_pvW(stg) + " W",
            "Daily Charge": chgWh + " Wh",
            "Daily Discharge": u16le(buf, 32) + " Wh",
            "Load Current (u16LE mA)": (u16le(buf, 20) === 0 ? "0 (OFF)" : u16le(buf, 20) + " mA = " + (u16le(buf,20)/1000).toFixed(2) + "A (ON)"),
            "Lamp Mode": lamp + (lamp === 7 ? " 🔥 Induction" : lamp === 4 ? " OFF" : lamp === 3 ? " ON" : " timer"),
            "SOC (byte 41)": (buf[41] || "?") + " (raw)",
            "Signal": (buf[9] > 127 ? buf[9] - 256 : buf[9]) + " dBm",
            "Sequence": String(buf[12]),
            "msgType (byte 8)": "0x" + buf[8].toString(16).toUpperCase(),
            "msgType (byte 13)": "0x" + buf[13].toString(16).toUpperCase(),
            "BCD Timestamp": bcdTimestamp || "N/A",
        };
    }

    return {
        length: length,
        expectedLength: 56,
        isShort: length < 48,
        bcdTimestamp: bcdTimestamp,
        summary: {
            total: length,
            confirmed: count.CONFIRMED,
            calibrated: count.CALIBRATED,
            tbd: count.TBD,
            unknown: count.UNKNOWN,
            pctKnown: Math.round((count.CONFIRMED + count.CALIBRATED) / length * 100)
        },
        keyValues: keyValues,
        rows: rows
    };
}

module.exports = { exploreBytes, BYTE_MAP };
