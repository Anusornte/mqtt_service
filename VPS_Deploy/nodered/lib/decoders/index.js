const { decodeTIProtocol, extractEMEI, V_SCALE } = require("./ti_protocol");
const { decodeModbus, verifyCRC } = require("./modbus_decoder");

module.exports = { decodeTIProtocol, extractEMEI, V_SCALE, decodeModbus, verifyCRC };
