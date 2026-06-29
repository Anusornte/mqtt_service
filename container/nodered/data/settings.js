module.exports = {
    uiPort: process.env.PORT || 1880,
    uiHost: "0.0.0.0",

    flowFile: "flows.json",
    flowFilePretty: true,

    credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || "change-this-to-random-string",

    mqttReconnectTime: 15000,

    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },

    externalModules: {
        autoInstall: true,
        palette: {
            allowInstall: true
        }
    },

    contextStorage: {
        default: "memoryOnly"
    },

    functionGlobalContext: {
        decoders: require("./decoders")
    }
};
