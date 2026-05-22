const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("db")) {
  config.resolver.assetExts.push("db");
}

// Ensure web is in the platforms list so Metro picks up `.web.tsx` files.
if (!config.resolver.platforms.includes("web")) {
  config.resolver.platforms = ["web", ...config.resolver.platforms];
}

// Stub react-native-maps on web so the mobile-only library doesn't crash
// the web preview bundle.
const path = require("path");
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "lib/react-native-maps.web.js"),
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
