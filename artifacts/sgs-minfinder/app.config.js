const base = require("./app.json");

module.exports = () => {
  const expo = { ...base.expo };
  expo.android = {
    ...(expo.android || {}),
    config: {
      ...((expo.android && expo.android.config) || {}),
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
  };
  return { expo };
};
