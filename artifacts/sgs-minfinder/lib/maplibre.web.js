// Web stub for @maplibre/maplibre-react-native (a native-only module). Metro
// aliases the package to this file on web (see metro.config.js). The *.web.tsx
// screens render placeholders and never import the map, so nothing here is ever
// invoked on web. Plain no-op exports (NOT a Proxy) so nothing can trip a
// prototype/instanceof path.
const Noop = () => null;

const OfflineManager = {
  getPacks: async () => [],
  getPack: async () => null,
  createPack: async () => ({ id: "stub", metadata: {}, bounds: [0, 0, 0, 0] }),
  deletePack: async () => {},
  invalidatePack: async () => {},
  resetDatabase: async () => {},
};

module.exports = {
  __esModule: true,
  default: Noop,
  Map: Noop,
  Camera: Noop,
  GeoJSONSource: Noop,
  Layer: Noop,
  UserLocation: Noop,
  Marker: Noop,
  Callout: Noop,
  Images: Noop,
  RasterSource: Noop,
  VectorSource: Noop,
  ImageSource: Noop,
  ViewAnnotation: Noop,
  OfflineManager,
};
