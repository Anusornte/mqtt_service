const { decodeTIProtocol, extractEMEI, V_SCALE } = require("./ti_protocol");
const { decodeModbus, verifyCRC } = require("./modbus_decoder");
const {
    crc16, bcdToDate, getBodyOffset,
    buildPacket,
    buildQueryLampStatus, buildControlLamp, buildRestart,
    buildSetTime, buildSolarLightSwitch, build0xB4Query,
    parseNJResponse, parseLampStatus, parseAlarm,
    parseOnline, parseSolar0xB4,
} = require("./parser");
const { exploreBytes, BYTE_MAP, ntc100K_3950, formula_ambTemp } = require("./byte_explorer");

module.exports = {
    // Byte explorer
    exploreBytes, BYTE_MAP, ntc100K_3950, formula_ambTemp,
    // TI Protocol
    decodeTIProtocol, extractEMEI, V_SCALE,
    // Modbus
    decodeModbus, verifyCRC,
    // Parser helpers (§3.3)
    crc16, bcdToDate, getBodyOffset,
    // Packet builder (§3.9)
    buildPacket,
    // Downlink builders (§3.9, §3.12)
    buildQueryLampStatus, buildControlLamp, buildRestart,
    buildSetTime, buildSolarLightSwitch, build0xB4Query,
    // NJ response parsers (§3.5, §3.6, §3.8, §3.11)
    parseNJResponse, parseLampStatus, parseAlarm,
    parseOnline, parseSolar0xB4,
};
