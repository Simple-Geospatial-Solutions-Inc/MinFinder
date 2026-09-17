#!/usr/bin/env python3
"""Measure real tile sizes off the live tile server and print the byte model
that lib/tileCache.ts uses to size offline packs.

WHY THIS EXISTS. The offline picker has to answer "how big is this download?"
before downloading it, and MapLibre's OfflineManager offers no pre-count. The
app therefore carries a small table of expected bytes per tile per source per
zoom. A table nobody can regenerate is a table that quietly goes wrong, so this
script is the way it was produced and the way to reproduce it.

RUN IT AFTER any basemap rebuild that changes a zoom range, adds or drops a
source, or materially changes tile content. Paste the printed BYTES_PER_TILE
block into artifacts/sgs-minfinder/lib/tileCache.ts.

    python basemap/tools/measure-tiles.py

Two contrasting regions are sampled on purpose. Smithers is mountainous, so
contours and terrain dominate; Fort St John is flat northeast BC, where oil and
gas roads carry the network and there is almost no relief. A model fitted to
either one alone misprices the other by a wide margin.

Empty tiles are counted as zero rather than skipped. Several sources return 204
No Content over much of the province, and a mean taken over non-empty tiles only
would overstate a pack by a large factor.
"""

import collections
import concurrent.futures as cf
import json
import math
import statistics
import urllib.request

HOST = "https://tiles.sgss.ca"

REGIONS = {
    "smithers": (-127.6, 54.5, -126.6, 55.0),
    "fortstjohn": (-121.4, 56.0, -120.4, 56.5),
}

# style source id -> (url path, extension, minzoom, maxzoom)
# Keep in step with the `sources` block in build/06-style.sh.
SRC = {
    "openmaptiles": ("basemap", "mvt", 0, 14),
    "contours": ("contours", "mvt", 12, 14),
    "terrain": ("terrain", "png", 0, 11),
    "bcroads": ("roads", "mvt", 9, 14),
    "bccontext": ("context", "mvt", 5, 14),
}

# The style zooms the offline picker offers (MIN_ZOOM_DEFAULT / MAX_ZOOM_DEFAULT
# in app/offline.tsx). Every source in the style is 512 tile units, so the XYZ
# zooms fetched are the same numbers -- see zoomShift() in lib/tileCache.ts.
ZMIN, ZMAX = 8, 13

SAMPLES_PER_ZOOM = 24


def deg2tile(lon, lat, z):
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def fetch(url):
    """Bytes on the wire, or None for an empty tile (204/404)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "minfinder-measure"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return len(body) if body else None
    except Exception:
        return None


def main():
    raw = {}
    with cf.ThreadPoolExecutor(max_workers=16) as ex:
        for rname, (w, s, e, n) in REGIONS.items():
            for key, (path, ext, smin, smax) in SRC.items():
                for z in range(ZMIN, ZMAX + 1):
                    if z < smin or z > smax:
                        continue
                    x0, y0 = deg2tile(w, n, z)
                    x1, y1 = deg2tile(e, s, z)
                    coords = [
                        (x, y)
                        for x in range(x0, x1 + 1)
                        for y in range(y0, y1 + 1)
                    ]
                    step = max(1, len(coords) // SAMPLES_PER_ZOOM)
                    coords = coords[::step][:SAMPLES_PER_ZOOM]
                    sizes = list(
                        ex.map(
                            fetch,
                            [f"{HOST}/{path}/{z}/{x}/{y}.{ext}" for x, y in coords],
                        )
                    )
                    got = [v for v in sizes if v]
                    raw[(rname, key, z)] = (
                        len(sizes),
                        len(got),
                        statistics.mean(got) if got else 0.0,
                    )

    print(f"{'region':<12}{'source':<14}{'z':>3}{'sampled':>9}{'nonempty':>10}{'mean KB':>10}")
    for (r, k, z), (n, ne, m) in sorted(raw.items()):
        print(f"{r:<12}{k:<14}{z:>3}{n:>9}{ne:>10}{m / 1024:>10.1f}")

    # Expected bytes per tile position, averaged across regions.
    acc = collections.defaultdict(list)
    for (r, src, z), (n, ne, mean) in raw.items():
        acc[(src, z)].append(mean * ne / n)
    tbl = collections.defaultdict(dict)
    for (src, z), vals in acc.items():
        tbl[src][z] = round(sum(vals) / len(vals))

    print("\n// paste into lib/tileCache.ts")
    print("const BYTES_PER_TILE: Record<string, Record<number, number>> = {")
    for src in SRC:
        if not tbl[src]:
            continue
        body = ", ".join(f"{z}: {tbl[src][z]}" for z in sorted(tbl[src]))
        print(f"  {src}: {{ {body} }},")
    print("};")

    # Cost of one pack over ZMIN..ZMAX, expressed per deepest-zoom tile (T).
    per_t = {s: sum(b / 4 ** (ZMAX - z) for z, b in tbl[s].items()) for s in tbl}
    total = sum(per_t.values())
    print(f"\ncost per z{ZMAX} tile of ground: {total / 1024:.2f} KB")
    for s in sorted(per_t, key=lambda k: -per_t[k]):
        print(f"  {s:<14}{per_t[s] / 1024:8.2f} KB{100 * per_t[s] / total:7.1f}%")

    tiles_per_t = sum(sum(1 / 4 ** (ZMAX - z) for z in tbl[s]) for s in tbl)
    print(f"tiles per z{ZMAX} tile of ground: {tiles_per_t:.3f}")
    for mb in (250, 400, 600):
        t = mb * 1048576 / total
        print(f"  a {mb} MB budget allows {t:,.0f} z{ZMAX} tiles "
              f"= {t * tiles_per_t:,.0f} tiles total")


if __name__ == "__main__":
    main()
