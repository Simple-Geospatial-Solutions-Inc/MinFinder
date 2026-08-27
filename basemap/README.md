# MinFinder self-hosted basemap pipeline

This directory builds and serves a complete, self-hosted basemap for the
MinFinder app: vector map tiles, terrain hillshading, contour lines, fonts and
sprites — everything the app's MapLibre style needs, served from our own VPS.

**Why it exists:** the app previously used Esri basemap tiles. Esri's terms of
use forbid the offline caching/bulk download the app's "save region for
offline use" feature performs. Rather than lose the feature, we serve our own
tiles from open data (OpenStreetMap, MRDEM-30/Copernicus elevation, and BC
and federal open government data), which permits it —
subject to the attribution obligations in the [Attribution](#attribution--required)
section below. That section is not optional boilerplate; it is the legal basis
for this whole migration.

## What it produces

| Artifact | Contents | Built by |
|---|---|---|
| `out/basemap.pmtiles` | OSM vector tiles (OpenMapTiles schema), z0–14 | `build/01-vector-tiles.sh` |
| `data/dem/dem.vrt` | Elevation mosaic: MRDEM-30 bare earth over Copernicus GLO-30 (intermediate, not deployed) | `build/02-dem.sh` |
| `out/terrain.pmtiles` | Terrain-RGB raster-dem (Mapbox encoding), z0–12 | `build/03-terrain-rgb.sh` |
| `out/contours.pmtiles` | Vector contour lines (20 m / 100 m index), z9–14 | `build/04-contours.sh` |
| `out/glyphs/{fontstack}/{range}.pbf` | SDF glyphs incl. "Open Sans Bold" (the stack the app requests) | `build/05-glyphs.sh` |
| `out/sprite.json/.png` (+`@2x`) | Map sprites | `build/05-glyphs.sh` |

`data/` is scratch (downloads, intermediates — safe to delete, expensive to
re-download). `out/` holds publishable artifacts only and is what
`serve/deploy.sh` ships to the VPS.

## Prerequisites

- **Podman** (Podman Desktop on Windows, `podman` from your distro on Linux).
  Every heavy tool — Planetiler (Java), GDAL, rio-rgbify, tippecanoe,
  go-pmtiles — runs in a **pinned** image, so the host needs no
  Java/GDAL/Python toolchain and builds are reproducible. Each script's header
  comment says where to check for newer image versions.

  On Windows, size the podman machine **before the first build** — the default
  is far too small for Planetiler and the machine must be recreated, not
  resized, if you get it wrong:

  ```sh
  podman machine init --memory 8192 --disk-size 120   # 8 GB RAM, 120 GB disk
  podman machine start
  ```

  A default 2 GB machine will OOM-kill Planetiler part way through step 01,
  and the failure looks like a generic JVM crash rather than an out-of-memory
  error. `podman machine inspect` shows what an existing machine has.
- **curl**, and one of **unzip / python3 / python** (step 05). Git Bash on
  Windows ships all of these.
- **Disk:** ~50–60 GB free for a full first build (DEM tiles ~6 GB, contour
  intermediates ~15–30 GB, outputs ~5–10 GB).
- **RAM:** Planetiler gets a `PLANETILER_XMX` (default 4g) JVM heap; the
  machine should have at least that plus ~2 GB headroom. 8 GB total is
  comfortable.
- Scripts are POSIX sh and run under Git Bash on Windows and on Linux.

## First run

```sh
cd basemap
cp config.env.example config.env   # edit if needed (BASEMAP_HOST at minimum, before deploying)
sh build/all.sh
```

`build/all.sh` runs steps 01–05 in order and aborts on the first failure.
Every step is idempotent: it skips itself when its output already exists, so
re-running `all.sh` after an interruption resumes where it stopped (partial
outputs are staged under temporary names and can never be mistaken for
finished ones). Expect roughly an afternoon of wall clock; the terrain-RGB
encode (step 03) is the slowest part. Per-step time/disk estimates are in the
header of `build/all.sh`.

First-run gotchas:

- Step 02 prints `404 ... (ocean cell, skipping)` for many cells — that is
  normal; Copernicus publishes no tiles for ocean-only cells.
- Step 03 builds a small local image (`localhost/minfinder-rgbify`) from
  `containers/rgbify.Containerfile` on first use; see the UNVERIFIED list
  below for the one runtime check to make there.

## Monthly refresh

Only the OSM data goes stale (Geofabrik rebuilds the BC extract daily). The
DEM, contours, glyphs and sprites are static — rebuild them only if you change
the bbox/interval in `config.env` or bump a pinned version.

```sh
cd basemap
FORCE=1 sh build/01-vector-tiles.sh   # re-download OSM, rebuild basemap.pmtiles
sh serve/deploy.sh                    # ship out/ to the VPS, restart the tile server
```

Do **not** run `FORCE=1 sh build/all.sh` for a routine refresh — that forces
every step, including re-downloading ~6 GB of DEM tiles.

## Deploying to the VPS

One-time VPS setup (as root; full commands in the file headers):

1. Install the pinned **go-pmtiles** binary and the systemd unit — follow the
   `Install` steps at the top of `serve/pmtiles.service`. Edit `--public-url`
   in the unit to the real hostname first.
2. Install the tile site block into the **shared, stock Caddy** — do not
   replace the binary (the `caddy-ratelimit` plugin was rejected: swapping the
   binary on a box that also serves sgss.ca risks the website to protect a
   tile server) and do **not** touch `/etc/caddy/Caddyfile`, which the
   `sgs-website` repo overwrites on every deploy. The file goes in `conf.d`:

   ```sh
   sudo mkdir -p /etc/caddy/conf.d
   sudo install -m 644 serve/Caddyfile.example /etc/caddy/conf.d/tiles.caddy
   sudo caddy validate --config /etc/caddy/Caddyfile   # must pass first
   sudo systemctl reload caddy                         # reload, never restart
   ```

   Replace `tiles.sgss.ca` if the hostname differs. The ACME `email` is not
   in this file — it lives in the website repo's global options block. The
   full story (including the outage this layout prevents and the tmpfiles
   rule for the log file) is in the header of `serve/Caddyfile.example`.
3. Create the deploy user: an ssh account (default name `deploy`) that may run
   `sudo systemctl restart pmtiles` and `sudo systemctl is-active pmtiles`
   without a password (a one-line sudoers entry), plus write access to
   `/srv/basemap`.

Then, from the build machine:

```sh
sh serve/deploy.sh
```

It copies `out/` to `/srv/basemap` (rsync incremental where available,
tar-over-ssh fallback under Git Bash), restarts the pmtiles service so it
reopens the replaced archives, and smoke-tests
`https://$BASEMAP_HOST/basemap.json`. Overrides: `DEPLOY_SSH`, `DEPLOY_DIR`,
`DEPLOY_SUDO` (see the header of `serve/deploy.sh`).

Note on `style.json`: Caddy serves `/srv/basemap/style.json` as the map's
entry point, but this pipeline does not build it — it ships from the app side
(Phase 2). `deploy.sh` deliberately protects it from `rsync --delete`, so a
data-only deploy never removes the live style.

**What SGS must supply:**

- The real public hostname (replaces `tiles.sgss.ca` in `config.env`
  → `BASEMAP_HOST`, in `serve/Caddyfile.example`, and in `--public-url` in
  `serve/pmtiles.service`), plus a DNS A/AAAA record pointing it at the VPS.
- The VPS itself — already provisioned: an **OVH VPS-3 2026** in BHS
  (Beauharnois), **8 vCores / 24 GB RAM / 200 GB NVMe**, Ubuntu LTS, shared
  with the sgss.ca website. Traffic on OVH VPS is unmetered (the panel has no
  quota or counter for it), so a scraper costs nothing in money — the only
  harm it can do is fill the link that sgss.ca also depends on. The whole
  deployed archive set is 9.62 GiB, so it sits entirely in page cache with
  ~14 GB to spare: this box will not run out of CPU, memory or disk I/O
  serving tiles; network is the one resource worth watching. Public
  bandwidth: OVH's comparison page (checked 2026-08-27) now lists the
  2027 range only, where the 8 vCore / 24 GB / 200 GB tier appears as VPS-4
  with "3 Gbps public bandwidth" and the tier below it at 2 Gbps. The exact
  figure for the 2026 VPS-3 is not on that page — read it off the panel's
  network tab and record it here.
- The ops email for Let's Encrypt expiry notices (in the Caddyfile).
- The deploy ssh user / sudoers entry from step 3 above.

## Attribution — REQUIRED

This deployment replaces a commercial basemap specifically to comply with
licensing, so these obligations are part of the product, not fine print. The
app's map UI (and any produced work, e.g. screenshots in reports) **must**
display or link to:

1. **OpenStreetMap** — the vector basemap is OSM data, licensed under the
   [Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
   Required credit: **"© OpenStreetMap contributors"**, linked to
   https://www.openstreetmap.org/copyright. ODbL also means: if we ever
   publicly redistribute a *modified database* (not just rendered tiles), the
   modifications must be offered under ODbL too. Serving tiles and shipping
   them in the app's offline cache is fine with the credit in place.
2. **OpenMapTiles** — `basemap.pmtiles` uses the OpenMapTiles schema
   (CC-BY 4.0). Required credit: **"© OpenMapTiles"**, linked to
   https://openmaptiles.org/.
3. **MRDEM-30 (Natural Resources Canada)** — the elevation source terrain and
   contours are built from, under the **Open Government Licence – Canada 2.0**.
   Required acknowledgement: **"Contains information licensed under the Open
   Government Licence – Canada"**. Why this source rather than Copernicus alone
   is recorded in [docs/dem-decision.md](docs/dem-decision.md), with the visual
   comparison that settled it.
4. **Copernicus DEM** — still the fallback layer south of 49 N and in any MRDEM
   void, so its notice is still required. Its licence requires that any product
   notice includes:
   *"Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
   Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European
   Union and ESA; all rights reserved."*
   The customary short on-map form is **"© Copernicus DEM"** linking to a page
   (or the app's about/attribution screen) carrying the full statement above —
   the full text must be reachable from the map.

5. **Open Government Licence – British Columbia** — the provincial road, park
   and geology layers from `build/07-bcdata.sh`. Required acknowledgement:
   **"Contains information licensed under the Open Government Licence – British
   Columbia"**. Note the near-miss datasets warned about in that script's header:
   several BC layers have almost identical names and opposite rights.

Practical placement: MapLibre renders source `attribution` strings in the map
corner; put the short credits there (via the style / TileJSON) and the full
Copernicus statement on the app's attribution screen. The single string all of
this collapses to lives in `build/06-style.sh` as `ATTR`, and is mirrored in the
app — keep the two in step.

## The tile server shares Caddy with the company website

`/etc/caddy/Caddyfile` on the VPS is **owned by the `sgs-website` repo**, not
this one. Its `deploy/deploy.sh` installs `deploy/Caddyfile.production` over
that file on every deploy where the two differ, and does `git reset --hard
origin/main` first — so neither the deployed file nor the checkout is a place
to keep anything.

The tile server's config therefore lives in `/etc/caddy/conf.d/tiles.caddy`,
pulled in by one line in `Caddyfile.production`:

```
import /etc/caddy/conf.d/*.caddy
```

**If tiles.sgss.ca goes dark right after someone ships the website, check that
line first.** Losing it removes the site block, and Caddy then answers TLS with
alert 80 and no certificate — which shows up in the app as a blank map, not as
an obvious server error. That is exactly how it failed on 2026-08-27.

```sh
curl -sI https://tiles.sgss.ca/style.json          # dead? then:
ssh <vps> 'grep -n "^import /etc/caddy/conf.d" /etc/caddy/Caddyfile'
ssh <vps> 'ls -l /etc/caddy/conf.d/'
```

## Load: what protects the origin

There is no CDN in front of `tiles.sgss.ca` and none is coming (the header of
`serve/Caddyfile.example` records why). Every request lands on the VPS, and
the VPS is more than big enough for that — the one thing it can run out of is
the network link it shares with sgss.ca. The controls below are layered from
always-on to optional; every threshold in them comes from measurement, and
every one of them **throttles or delays rather than rejects**, because a
rejected tile still costs a rural-LTE round-trip even though the app now rides
errors out.

| Layer | File | When |
|---|---|---|
| Kernel network tuning (backlogs, ephemeral ports) | `serve/sysctl-tiles.conf` | install once |
| Caddy → go-pmtiles connection pool | snippet `tiles_pmtiles_upstream` in `serve/Caddyfile.example` | part of the site block |
| Measurement: peak req/s and bytes/s, per-IP, repeat share | `serve/tile-stats.sh` | after the first real region download, and after any change to pack size |
| Per-address abuse ban via nftables | `serve/tile-guard.sh` + `.service` + `.timer` | enable any time — report-only until thresholds are set from tile-stats |
| Per-address request-rate *delay* (nginx sidecar) | `serve/nginx-tiles.conf.example` | only if measurement shows the link at risk |
| Client rides out blips and deploys (native retry + stall watchdog) | `artifacts/sgs-minfinder/app/offline.tsx` | ships with the app |

Bringing it up, in order:

1. `sh serve/tile-stats.sh` against a copied-down `tiles.log` — confirm it
   parses (the log is JSON) and the numbers are sane. Then download a real
   region from the app and run it again to capture actual burst rates.
2. `caddy validate --config /etc/caddy/Caddyfile` **must** pass before any
   reload, and use `systemctl reload caddy`, never `restart` — an invalid
   Caddyfile takes sgss.ca down with the tiles.
3. `sysctl -p /etc/sysctl.d/60-tiles.conf`, confirm the values took, then
   re-run a download and watch `ss -s` for `timewait` growth.
4. `tile-guard.sh --dry-run` against real log data **during** a legitimate pack
   download; it must ban nothing. Only then set thresholds and enable the timer.
5. From the app: start a pack download, `systemctl restart pmtiles`
   mid-download (what every `deploy.sh` run does), and confirm the download
   recovers instead of alerting "Download failed".

## UNVERIFIED — check on the first real run

Everything below is consistent with upstream documentation/source but could
not be exercised on the build machine (no container execution / no VPS in the
authoring environment). Tick these off the first time each stage runs for real:

- [ ] **Git Bash + podman machine path handling** (all build scripts): the
  `pwd -W` host paths and `MSYS_NO_PATHCONV=1` container paths follow
  documented Git-for-Windows behavior but were not run against a live podman
  machine. Symptom if wrong: "invalid mount path" errors or files
  landing in odd places.
- [ ] **`minfinder-rgbify` image actually runs** (step 03): rio-rgbify 0.4.0
  has not been *executed* against the pinned python 3.11 / numpy 1.26.4 /
  rasterio 1.3.11 trio (the import chain was verified from published sources).
  First run: `podman run --rm localhost/minfinder-rgbify:0.4.0 rio rgbify --help` should
  print usage. If it raises an import error, drop rasterio to 1.2.10 and the
  base image to python:3.9-slim (noted in `containers/rgbify.Containerfile`).
- [ ] **openwatersio/tippecanoe 2.79.0 binary** (step 04): assumed to be a
  faithful build of felt/tippecanoe 2.79.0 (tags track upstream); the binary
  itself was not attested. Check:
  `podman run --rm ghcr.io/openwatersio/tippecanoe:2.79.0 tippecanoe --version`
- [ ] **Bind-mount ownership under rootless Podman** (steps 01–04): no
  `--user` flag is passed, because rootless Podman maps the container's root
  to the invoking host user, so bind-mount output should already be owned by
  you. This was reasoned from Podman's userns behaviour, not observed. Check
  `ls -l out/` after step 01. If files come out owned by a high unmapped UID,
  the fix is `--userns=keep-id`, **not** `--user "$(id -u):$(id -g)"` — that
  flag maps into the subuid range and makes the problem worse under Podman
  even though it fixes it under Docker.
- [ ] **SELinux relabelling** (Linux build hosts only): bind mounts carry no
  `:z` suffix. On Fedora/RHEL with SELinux enforcing, containers will get
  permission denied reading `/data`; add `:z` to the `-v` flags in the failing
  step. Not applicable on Windows (podman machine has no SELinux).
- [ ] **Data-shape estimates**: "~246 DEM tiles / ~6 GB", contour GPKG size,
  terrain tile counts, and the density of the 0 m coastline contour (GLO-30
  has ocean at 0 m with no nodata) are estimates, not measurements.
- [ ] **systemd hardening set** (`serve/pmtiles.service`): every directive is
  real and appropriate for a read-only Go server, but the full combination
  needs one live `systemctl start pmtiles` + `journalctl -u pmtiles` check.
- [ ] **Deploy user sudoers**: `deploy.sh` assumes passwordless
  `sudo systemctl restart pmtiles` for the ssh user (override with
  `DEPLOY_SUDO=""` if the user may systemctl directly).
- [ ] **Caddy end-to-end**: TLS issuance and real behaviour under a
  57k-request offline-download burst are verified against docs only. There is
  no edge in front of this box and none is coming: WHC's client-area
  Cloudflare proxies the apex and `www` only (confirmed by their support and
  by querying the zone's nameservers directly — `tiles` returns the OVH
  origin), no SGS-owned Cloudflare account exists, and moving a zone that
  carries company email under `p=quarantine` was rejected. Every request
  therefore lands on the origin, and no `rate_limit` directive is present
  (stock Caddy lacks the plugin; replacing the shared binary would risk
  sgss.ca). Measure before protecting: run `sh serve/tile-stats.sh` against
  `/var/log/caddy/tiles.log` after the first real region download to get
  actual per-IP burst rates, then size `serve/tile-guard.sh` from them.
- [ ] **tar-over-ssh fallback in `deploy.sh`**: POSIX sh has no pipefail, so a
  failure of the *sending* side of the pipe is not detected. Prefer a host
  with rsync; after a tar deploy, trust the smoke test, not the exit status.
- [ ] **Executable bits on fresh checkouts**: this repo is authored on Windows
  (`core.filemode=false`), so `+x` must be recorded at commit time:
  `git update-index --chmod=+x basemap/build/*.sh basemap/serve/*.sh`.
  `build/all.sh` invokes each step via `sh` so it works either way, and
  `tile-guard.service` runs its script by absolute path from `install -m 755`.
