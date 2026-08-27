import { BASEMAP_SOURCES, type StyleSource } from "./mapStyle";
import { lonLatToTile } from "./geo";

// mbgl works in 512px tile units internally, so a source with smaller tiles
// needs one extra XYZ level per halving of tile size to cover the same ground —
// its util::coveringZoomLevel() adds log2(512 / tileSize) and floors. The old
// Esri basemap served 256px raster tiles, which shifted every pack one zoom
// deeper than the requested style zooms and made the picker's estimate read
// ~3.5x low. Every source in the current style is 512 units (vector tiles are
// 512 by definition; the terrain source declares tileSize 512), so the shift is
// 0 today — the machinery stays because a future 256px source would silently
// reintroduce exactly that bug.
const MBGL_TILE_UNIT = 512;

function zoomShift(source: StyleSource): number {
  return Math.log2(MBGL_TILE_UNIT / (source.tileSize ?? MBGL_TILE_UNIT));
}

/**
 * The XYZ tile zoom levels MapLibre actually fetches from `source` for a pack
 * requested over `[minZoom, maxZoom]` style zooms — mirrors mbgl's
 * coveringZoomRange(), including the clamp to the source's own zoom range.
 */
function sourceZoomRange(
  source: StyleSource,
  minZoom: number,
  maxZoom: number,
): { min: number; max: number } {
  const shift = zoomShift(source);
  return {
    min: Math.max(Math.floor(minZoom + shift), source.minzoom ?? 0),
    max: Math.min(Math.floor(maxZoom + shift), source.maxzoom ?? 22),
  };
}

// Expected bytes per tile POSITION — empty tiles counted as zero, because a
// source that returns 204 for two thirds of its tiles costs far less than its
// non-empty average suggests. MEASURED against the live server on 2026-08-26 by
// basemap/tools/measure-tiles.py, sampling 24 tiles per source per zoom across
// two deliberately contrasting regions: Smithers (mountainous, contour- and
// terrain-heavy) and Fort St John (flat northeast, oil and gas roads, little
// relief). A model fitted to only one of those would misprice the other.
//
// Re-run that script after any basemap rebuild that changes zoom ranges or adds
// a source. Values are wire bytes, which is what the device stores: vector tiles
// are served gzipped straight out of the archive and pass through Caddy as-is.
//
// The shape worth knowing: terrain PNGs are ~250-420 KB against 1-30 KB for a
// vector tile, so hillshade alone is ~60% of an offline pack even though it
// stops at z11 and is only 1.6% of the tiles.
const BYTES_PER_TILE: Record<string, Record<number, number>> = {
  openmaptiles: { 8: 35098, 9: 26214, 10: 11202, 11: 5879, 12: 3580, 13: 2435 },
  contours: { 12: 17205, 13: 5067 },
  terrain: { 8: 397097, 9: 366878, 10: 328799, 11: 287238 },
  bcroads: { 9: 25561, 10: 9373, 11: 3734, 12: 1593, 13: 438 },
  bccontext: { 8: 19792, 9: 7946, 10: 4142, 11: 2146, 12: 1540, 13: 1214 },
};

// Measured only over the zooms the picker actually offers. Outside that range
// the nearest measured zoom is used rather than extrapolating: tile bytes fall
// off sub-linearly and guessing the curve past the data would be false
// precision. Clamping to the endpoint over-estimates deeper zooms, which is the
// safe direction for a size cap.
const BYTES_BOUNDS: Record<string, { lo: number; hi: number }> =
  Object.fromEntries(
    Object.entries(BYTES_PER_TILE).map(([id, table]) => {
      const zooms = Object.keys(table).map(Number);
      return [id, { lo: Math.min(...zooms), hi: Math.max(...zooms) }];
    }),
  );

function bytesPerTile(sourceId: string, z: number): number {
  const table = BYTES_PER_TILE[sourceId];
  const bounds = BYTES_BOUNDS[sourceId];
  if (!table || !bounds) return 0;
  return table[Math.min(bounds.hi, Math.max(bounds.lo, z))] ?? 0;
}

// WGS84 equatorial circumference, for ground-resolution maths.
const EQUATORIAL_CIRCUMFERENCE_M = 40075016.686;

// The source whose resolution the UI quotes. It carries the roads, water and
// labels people navigate by, so it is the honest answer to "how much detail did
// I just download".
const REFERENCE_SOURCE_ID = "openmaptiles";

/**
 * Size cap for one offline pack, in bytes.
 *
 * Expressed in bytes rather than tiles on purpose. The old TILE_LIMIT of 15,000
 * counted XYZ indices, and the current style requests from five sources instead
 * of one — so a tile cap now prices the *number of sources* as much as the area,
 * and adding a sixth source would silently shrink the selectable region by a
 * fifth without anyone touching the limit. Bytes are what the phone and the data
 * plan actually pay, and they stay meaningful whatever the style contains.
 *
 * 400 MB is deliberate parity with what the tile cap already permitted (~380 MB
 * of Esri raster). Measured, the same ground area now costs ~111 MB, so holding
 * the download size steady buys area rather than shrinking it. Checked through
 * this code at Smithers latitude: a 400 MB budget allows a 272 km square
 * (51,048 tiles), against 146 km for a 15,000-tile cap — 1.9x the span, 3.5x
 * the area, for the same download.
 *
 * OPERATIONAL CONSEQUENCE: a maximum-size pack is now a ~51,000-request,
 * ~400 MB burst, up from ~15,000 requests. VERIFIED 2026-08-27 that this lands
 * directly on the origin VPS: tiles.sgss.ca resolves to the OVH address with no
 * CDN in front (no cf-ray, Server: Caddy). The design assumed Cloudflare would
 * absorb it at the edge and it currently does not, so the tile server has no
 * burst protection of any kind — see the rate-limiting note in
 * basemap/serve/Caddyfile.example.
 */
export const PACK_BYTE_BUDGET = 400 * 1024 * 1024;

/**
 * Ground resolution in metres per pixel of the deepest tile level a pack caches
 * when it is requested up to `maxZoom`, at latitude `lat`.
 *
 * Note this is now a statement about DATA detail, not about when the picture
 * blurs: vector tiles overzoom cleanly, so past this point the map stays sharp
 * and simply stops gaining detail. The old raster basemap visibly pixelated,
 * which is why the copy around this number needed changing along with it.
 */
export function metersPerPixelAt(lat: number, maxZoom: number): number {
  const source = BASEMAP_SOURCES[REFERENCE_SOURCE_ID];
  const z = sourceZoomRange(source, maxZoom, maxZoom).max;
  const latScale = Math.cos((lat * Math.PI) / 180);
  return (EQUATORIAL_CIRCUMFERENCE_M * latScale) / (MBGL_TILE_UNIT * 2 ** z);
}

/**
 * Walks every (source, zoom) pair a pack over these bounds would fetch, calling
 * `visit` with the number of XYZ tiles at that level. Shared by the count and
 * byte estimates so the two can never disagree about what a pack contains.
 */
function forEachSourceZoom(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  minZoom: number,
  maxZoom: number,
  visit: (sourceId: string, z: number, tiles: number) => void,
): void {
  for (const [sourceId, source] of Object.entries(BASEMAP_SOURCES)) {
    const { min, max } = sourceZoomRange(source, minZoom, maxZoom);
    for (let z = min; z <= max; z++) {
      const a = lonLatToTile(minLon, maxLat, z);
      const b = lonLatToTile(maxLon, minLat, z);
      const w = Math.abs(b.x - a.x) + 1;
      const h = Math.abs(b.y - a.y) + 1;
      visit(sourceId, z, w * h);
    }
  }
}

/**
 * Pre-download tile-count estimate for the offline picker. MapLibre's
 * OfflineManager has no cheap pre-count, so we count the XYZ tile cover of the
 * bounds ourselves over the zoom range mbgl will really use — summed across
 * every source in the style, since a pack downloads all of them.
 */
export function countTilesInRegion(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  forEachSourceZoom(
    minLat,
    maxLat,
    minLon,
    maxLon,
    minZoom,
    maxZoom,
    (_sourceId, _z, tiles) => {
      total += tiles;
    },
  );
  return total;
}

/**
 * Estimated on-disk size of a pack over these bounds, in bytes. This is what
 * the size cap is judged against and what the picker shows the user, because it
 * is the number they care about: tile counts do not fill a phone, bytes do.
 */
export function estimatePackBytes(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  forEachSourceZoom(
    minLat,
    maxLat,
    minLon,
    maxLon,
    minZoom,
    maxZoom,
    (sourceId, z, tiles) => {
      total += tiles * bytesPerTile(sourceId, z);
    },
  );
  return total;
}
