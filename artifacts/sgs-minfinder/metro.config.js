const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("db")) {
  config.resolver.assetExts.push("db");
}

// Ensure web is in the platforms list so Metro picks up `.web.tsx` files.
if (!config.resolver.platforms.includes("web")) {
  config.resolver.platforms = ["web", ...config.resolver.platforms];
}

// Stub the native-only map library on web so it doesn't crash the web preview
// bundle (the *.web.tsx screens render placeholders and never import it).
const path = require("path");
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "@maplibre/maplibre-react-native") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "lib/maplibre.web.js"),
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
