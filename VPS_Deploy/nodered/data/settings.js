module.exports = {
    uiPort: process.env.PORT || 1880,
    uiHost: "0.0.0.0",

    flowFile: "flows.json",
    flowFilePretty: true,

    credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET,

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

    functionGlobalContext: {
        decoders: require("./decoders")
    }
};
