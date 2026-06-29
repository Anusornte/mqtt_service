/**
 * Node-RED Settings — Solar IoT
 * Container: nodered-solar (nodered/node-red:latest)
 * MQTT Broker: mosquitto-solar:1883
 */

module.exports = {
    // Node-RED UI
    uiPort: process.env.PORT || 1880,
    uiHost: "0.0.0.0",

    // Flow File
    flowFile: "flows.json",
    flowFilePretty: true,

    // Credentials
    credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || "change-this-to-random-string",

    // MQTT Broker (internal Docker network)
    mqttReconnectTime: 15000,
    mqttClientId: "nodered-solar",

    // Logging
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },

    // External modules
    externalModules: {
        autoInstall: true,
        palette: {
            allowInstall: true
        }
    },

    // Runtime
    contextStorage: {
        default: "memoryOnly"
    },

    // Decoder path (mounted from /data/decoders)
    functionGlobalContext: {
        decoders: require("./decoders")
    }
};
