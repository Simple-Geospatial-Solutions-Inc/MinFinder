const base = require("./app.json");

// The map uses MapLibre (@maplibre/maplibre-react-native), not react-native-maps,
// so no Google Maps Android API key is needed. Config is fully static in app.json.
module.exports = () => ({ expo: { ...base.expo } });
