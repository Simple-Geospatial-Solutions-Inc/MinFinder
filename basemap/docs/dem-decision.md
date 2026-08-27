# Choosing the elevation source: GLO-30 → MRDEM-30

**Decided 2026-08-27. Implemented in `build/02-dem.sh`.**

Visual comparison, with the wipe sliders that settled it:
<https://claude.ai/code/artifact/ea24075f-6012-4efd-b078-7f8dde6f25be>

## The problem

The basemap shipped Copernicus GLO-30, which is a **surface** model — it measures the top of the
forest canopy, not the ground. Everything derived from it inherits that: the hillshade in
`03-terrain-rgb.sh` and, more seriously, the 20 m contours in `04-contours.sh`.

NRCan's MRDEM-30 publishes the same 30 m grid as a **terrain** model: bare ground, with LiDAR
substituted wherever a LiDAR project exists and a forest-removal model applied elsewhere. Same
resolution, same output tileset size, no change to the offline pack budget.

## Method

Three sites, chosen to separate the regimes rather than to flatter the candidate. All three DEMs
warped onto one 30 m EPSG:3979 grid and hillshaded identically
(`gdaldem hillshade -z 1.5 -az 315 -alt 45`), then compared visually alongside Terrain Ruggedness
Index and slope standard deviation. Script: `tools/measure-tiles.py` is the tile-size equivalent;
the DEM comparison was run ad hoc with the same GDAL image.

**The control that matters is MRDEM DSM against MRDEM DTM** — same product, same grid, only the
bare-earth step between them. MRDEM publishes both, which makes this possible. Comparing GLO-30
straight to the DTM conflates the bare-earth step with the reprojection onto MRDEM's Lambert grid,
and reads as a texture loss that is not there. The first pass at this analysis made exactly that
mistake.

| Site | LiDAR | Canopy (DSM−DTM) | TRI: GLO-30 | MRDEM DSM | MRDEM DTM | DSM→DTM |
|---|---|---|---|---|---|---|
| Port Alberni | yes | 10.87 m mean | 11.534 | 12.111 | 7.073 | **−41.6%** |
| Babine Range | no | 6.85 m mean | 9.606 | 8.213 | 8.271 | +0.7% |
| Sulphurets / KSM | no | 0.19 m mean | 27.582 | 26.517 | 26.005 | −1.9% |

Slope σ at Port Alberni moves only 6.788 → 6.252 while TRI falls 42%. High-frequency energy
removed, landform kept — the signature of stripping canopy rather than smoothing terrain.

## Decision

Adopt MRDEM-30 DTM, layered over GLO-30.

- **Inside the LiDAR footprint** (~9% of BC, carrying ~17% of MINFILE occurrences) the DTM reveals
  terraces, meander scars, escarpment edges and glacial fluting that the surface model buries under
  canopy speckle.
- **Outside it** the change is texture-neutral. It neither helps nor hurts.
- **The largest win is contours.** With canopy 7–11 m deep in forested BC against a 20 m interval,
  every contour in treed country was previously drawn on treetops. That is a correctness defect,
  and it is bigger than the hillshade gain.
- Elevations move from EGM2008 to **CGVD2013**, the official Canadian vertical datum — an alignment
  gain with BC government elevation data. Measured offset across the three sites was −1 m to +2 m.

## What was rejected

**High-resolution (1 m) HRDEM.** Terrain-RGB is high-entropy PNG with no compression relief, so
each zoom level is a flat 4×. Raising the terrain cap from z11 to z13 makes a single offline pack
0.9–1.1 GB; z14 makes it 3–4 GB. Against a 400 MB budget (`PACK_BYTE_BUDGET` in
`lib/tileCache.ts`) that is not a tuning question. It also covers 9% of the province and 0.4% of
the Golden Triangle.

## Known artifacts and limits

- **The 49 N seam.** Bare-earth MRDEM meets canopy-top GLO-30 at the international border, so
  hillshade and contours step by roughly the canopy height along that line. Accepted: it is outside
  the app's data domain, and a hard nodata edge at the border is worse.
- **One resampling step** onto the reference grid costs ~15% of ruggedness in the forested interior
  and ~4% in the alpine. Unavoidable with the product swap; present for DSM and DTM alike.
- **Coverage figures** came from project extent footprints rather than per-project coverage
  polygons, so the 9% is a slight overestimate.
- **Three sites is a spot check.** The alpine and coastal cases are well separated; the northern
  boreal interior is represented by one box.

## Attribution consequence

MRDEM-30 is Open Government Licence – Canada 2.0 and must be acknowledged. The attribution string
lives in `build/06-style.sh` (`ATTR`) and is mirrored in the app: `app/about.tsx`,
`app/offline.tsx`, `legal/privacy-policy.html`, `legal/terms-of-use.html` and `SUBMISSION.md`.
Keep them in step.
