# Adding things to the tile VPS — an agent's runbook

Orientation for an agent asked to put something new on the box that serves `tiles.sgss.ca`.
Read this **before** editing anything under `basemap/serve/`.

Everything here is derived from the files in `basemap/serve/`, `basemap/build/` and
`basemap/README.md`. Nothing in it was checked against the live box from the authoring
session — treat the command lines as the shape of the work, and confirm on the box. Each
file's own header comment remains the authority for its install steps; this document exists
to tell you *which* files to touch, *in what order*, and *what fails silently*.

## The box, in one paragraph

An **OVH VPS-3 2026** in BHS: 8 vCores / 24 GB RAM / 200 GB NVMe, Ubuntu LTS, traffic
unmetered. Origin address `51.222.206.236`; public name `tiles.sgss.ca` resolves straight to
it — there is **no CDN and none is coming** (settled 2026-08-27; reasoning in the header of
`serve/Caddyfile.example`). The login user is **`ubuntu`**, not the `deploy@` that
`deploy.sh` would otherwise default to, and `deploy.sh` authenticates with
`~/.ssh/minfinder_tiles` passed explicitly via `-i`. The deployed archive set is ~9.6 GiB
against 24 GB of RAM, so it sits entirely in page cache: this box will not run out of CPU,
memory or disk I/O serving tiles. **The network link is the only resource worth worrying
about, and it is shared with the company website.**

## Rule zero: you do not own this box

| Thing | Owned by | What you may do |
|---|---|---|
| `/etc/caddy/Caddyfile` | the **`sgs-website`** repo — its deploy does `git reset --hard`, then installs `deploy/Caddyfile.production` over this file whenever the two differ | **never edit it.** Not even one line |
| `/etc/caddy/conf.d/*.caddy` | this repo | add and edit files here |
| `/srv/basemap/**` | `serve/deploy.sh`, which rsyncs with `--delete` | change it only by changing `out/` and re-running `deploy.sh` |
| `/etc/systemd/system/*`, `/etc/sysctl.d/*`, `/etc/default/*` | this repo for the `pmtiles` and `tile-guard` units; shared otherwise | add new files, named so they are obviously ours |

Two corollaries, both learned the hard way:

- Anything you `scp` or `echo` straight into `/srv/basemap` is **deleted by the next deploy**
  (`rsync --delete`). The one exception is `style.json`, protected by
  `--filter='P /style.json'` — and that protects it only from *deletion*. When
  `out/style.json` exists locally (it does; `build/06-style.sh` writes it) it is transferred
  normally and overwrites the live file.
- Anything you append to `/etc/caddy/Caddyfile` is **deleted by the next website deploy**.
  That is exactly how tiles went dark on 2026-08-27: the site block vanished, Caddy answered
  TLS with alert 80 and no certificate, and the app rendered a blank map. The certificates
  were valid the whole time; only the config was gone. `Caddyfile.production` now carries
  `import /etc/caddy/conf.d/*.caddy`, which is the only reason anything of ours survives.
  **If tiles go dark right after someone ships the website, check that line before anything
  else.**

## What is already running, and on which port

| Port | Process | Notes |
|---|---|---|
| 443 / 80 | Caddy, shared with sgss.ca | terminates TLS, serves static assets, proxies tiles |
| 8080 | the sgss.ca site's API | binds `*:8080`, **not** loopback — a `ss -ltn` filtered on `127.0.0.1` will not show it |
| 8081 | `go-pmtiles` v1.31.2, loopback only | `serve/pmtiles.service` |
| 8082 | reserved for the optional nginx sidecar | `serve/nginx-tiles.conf.example`, not installed |
| 10240–65535 | ephemeral port range | widened by `serve/sysctl-tiles.conf`; its lower bound is deliberately above every listener |

**Picking a port for something new:** take the next free port *below 10240* (8083 is the
obvious one) so an outgoing connection can never race your listener for an ephemeral port.
Check `ss -ltnp` **and** `grep -n 'reverse_proxy' /etc/caddy/Caddyfile /etc/caddy/conf.d/*.caddy`
— the 8080 wildcard bind is invisible to a loopback-filtered `ss` alone.

---

## Recipe 1 — add a new tileset

The common case: a new `.pmtiles` archive that should be servable and, usually, drawn by the
app. Work through all seven steps. Skipping 4–6 produces a tileset that "works" when you
`curl` it and is invisible or mispriced everywhere else.

**1. Build it into `out/`.** Add a `build/NN-*.sh` following the shape of the existing steps:
source `config.env`, honour `FORCE`, skip when the output already exists, stage partial output
under a temp name, run every heavy tool in a **pinned** container image. `build/07-bcdata.sh`
is the closest template for "fetch external data → tippecanoe → pmtiles". Check the licence of
any new source before anything else — that script's header records BC datasets whose nearly
identical names carry opposite rights.

**2. Nothing to do on the systemd side.** `pmtiles serve /srv/basemap` exposes *every* archive
in the directory, and the tileset name is the filename minus `.pmtiles`. Dropping
`foo.pmtiles` into `out/` gets you `/foo/{z}/{x}/{y}.{ext}` and `/foo.json` with no unit
change and no restart beyond the one `deploy.sh` already performs.

**3. Nothing to do for tile *routing* either.** The catch-all `handle { reverse_proxy … }` at
the bottom of `conf.d/tiles.caddy` proxies `/{tileset}/{z}/{x}/{y}` verbatim.

**4. But you must add the TileJSON path to the matcher.** In `serve/Caddyfile.example`:

```
@tilejson path /basemap.json /terrain.json /contours.json
```

A `.json` missing from that list still *works* — it falls through to the catch-all — but it
inherits the **30-day** tile `Cache-Control` instead of the 1-hour TileJSON one, so clients
hold a stale pointer (zoom ranges, attribution) for a month after a redeploy. `roads.json` and
`context.json` are missing from it today; see *Known gaps* below.

**5. Add the source to `build/06-style.sh`** if the app should draw it, with **inline
`minzoom`/`maxzoom` that match what the archive actually contains**. The app reads those out
of the bundled style to size offline packs without network, and mbgl clamps its tile cover to
them. Verify against the served TileJSON after the build rather than assuming:

```sh
curl -s https://tiles.sgss.ca/<tileset>.json | grep -o '"[a-z]*zoom":[0-9]*'
```

Contours are the cautionary tale: the archive reports `minzoom 9`, every z9–11 tile comes back
`204 No Content`, and the style therefore declares `12`.

**⚠ Adding a source to `style.json` enlarges every offline pack.** `createPack` downloads
every source in the style and `lib/tileCache.ts` prices every source in it against a
`PACK_BYTE_BUDGET` of 400 MB — a maximum-size pack is already ~57,000 requests / ~400 MB. If
the layer should *not* be baked into packs, mount it at runtime instead —
`artifacts/sgs-minfinder/lib/satellite.ts` is the pattern, and the reason it exists.

**⚠ A style change is not a tile-server change alone — it is a coordinated release.**
`06-style.sh` writes the style **twice**: to `out/style.json` (published, and the only thing
`createPack` can be handed, because it accepts a URL and not inline JSON) and to
`artifacts/sgs-minfinder/lib/basemap-style.json` (bundled, so a cold start with no signal
still draws a map). MapLibre keys cached resources by URL, so if the two disagree about a
source's `url` the pack caches tiles under one key while the map asks for another: the
download reports **success** and the map is still blank offline. Never hand-edit either copy
or hand-copy one to the other — regenerate, and ship the app build and the tile deploy
together.

**6. Attribution.** If the source carries an obligation, extend `ATTR` in `build/06-style.sh`
**and** the mirrored string in the app, and add a row to the Attribution section of
`basemap/README.md`. That section is the legal basis for this whole pipeline, not boilerplate.

**7. Wire the smoke tests.** Add the archive to the presence-check loop in `serve/deploy.sh`
(it currently checks `terrain`, `contours`, glyphs and sprites only), and add a layer to
`preview.html` so the post-deploy browser check actually exercises it.

Then deploy and walk the verification ladder below.

---

## Recipe 2 — add or change Caddy routing

Put it in a file under `/etc/caddy/conf.d/`, never in `/etc/caddy/Caddyfile`.

```sh
sudo mkdir -p /etc/caddy/conf.d
sudo install -m 644 serve/Caddyfile.example /etc/caddy/conf.d/tiles.caddy
sudo caddy validate --config /etc/caddy/Caddyfile   # MUST pass first
sudo systemctl reload caddy                         # reload, NEVER restart
```

Four constraints that produce a parse error or an outage if you miss them:

- **No global options block.** A Caddyfile may contain exactly one bare `{ … }` block, it
  lives in the website repo's `Caddyfile.production`, and a second one *anywhere* — including
  in an imported file — is a parse error that takes down every site on the box. An ACME
  `email` belongs in that block, not in ours.
- **Snippet names are global** across the whole assembled Caddyfile, the website's included.
  Prefix ours `tiles_`, as `tiles_pmtiles_upstream` is.
- **Define a snippet above its use.** The adapter resolves `import` in token order; a snippet
  imported before it is defined is treated as a *file path* and fails validation.
- **`reload`, never `restart`.** `restart` drops in-flight connections for every site on the
  box. And if `validate` fails, stop — do not reload and see what happens.

**The log file must exist and be caddy-owned before anyone deploys the website.** Their deploy
runs `caddy validate` as root, validation provisions log writers, and a missing
`/var/log/caddy/tiles.log` then gets created root-owned — after which the `caddy` user cannot
open it and **their** reload fails because of **our** config. A tmpfiles rule keeps it correct
across rotation and reboots:

```
# /etc/tmpfiles.d/caddy-tiles.conf
f /var/log/caddy/tiles.log 0640 caddy caddy -
```

Do not add `Access-Control-Allow-Origin` to anything proxied to go-pmtiles — it already sends
one (`--cors=*`), and browsers reject the duplicated header.

---

## Recipe 3 — add a new long-running service

Copy `serve/pmtiles.service` as the template and keep its hardening set; it is written for
exactly this shape of process (read a few files, listen on loopback, do nothing else).

- Commit the unit to `basemap/serve/`, with the **install commands in its header comment** —
  that is this directory's convention and the only place install steps are recorded.
- `ProtectSystem=strict` makes the whole filesystem read-only. Anything that needs to write
  needs an explicit `ReadWritePaths=`, `StateDirectory=` or `LogsDirectory=`.
- Bind `127.0.0.1` and let Caddy own TLS and the public edge. Pick the port per the table above.
- Run as a dedicated `--system` user with `/usr/sbin/nologin`, and give the deploy user a
  passwordless sudoers entry for only the specific `systemctl` verbs it needs.
- After `systemctl enable --now`, read `journalctl -u <unit>` in full. The hardening set on
  `pmtiles.service` is recorded as never having been exercised end-to-end, and a
  `SystemCallFilter` denial surfaces as an obscure `EPERM`, not as "systemd blocked this".

If the service needs to read `/srv/basemap`, note the ownership split `deploy.sh` enforces:
`ubuntu:pmtiles`, directory `755`, files `644`. Add your service user to the `pmtiles` group
rather than changing that.

---

## Recipe 4 — add a periodic job

`serve/tile-guard.{sh,service,timer}` is the template: a `Type=oneshot` unit, an
`EnvironmentFile=-/etc/default/<name>` for tunables, and a timer with `OnBootSec` /
`OnUnitActiveSec`.

The design rule worth copying: **ship it report-only.** `tile-guard.sh` bans nothing until
thresholds are set in `/etc/default/tile-guard`, so enabling the timer early is safe. Set
thresholds only from `serve/tile-stats.sh` output against a **real** pack download, and start
no lower than 5× a full pack — one legitimate customer saving a maximum-size region is ~57,000
requests from one address in a few minutes, and several users behind one office NAT share a
single address. A threshold a real customer can reach is a self-inflicted outage.

Always dry-run against live data *during* a legitimate download before arming anything:

```sh
tile-guard.sh --dry-run    # must ban nothing
```

---

## Recipe 5 — add a static file

Static assets (`glyphs/`, `sprite*`, `style.json`, `preview.html`) are served by Caddy off
disk, not by go-pmtiles. To add one:

1. Make sure it ends up **inside `out/`** before the rsync. `deploy.sh` copies `preview.html`
   into `out/` at deploy time precisely because a file placed on the box any other way is
   wiped by the next `--delete`.
2. Add its path to the `@static` matcher in `conf.d/tiles.caddy` if it should get the
   immutable one-year `Cache-Control`. Short-lived pointers like `style.json` get their own
   `handle` with `max-age=300` instead.

---

## Recipe 6 — kernel tuning

`serve/sysctl-tiles.conf` installs as `/etc/sysctl.d/60-tiles.conf`. If you add to it, apply
it and *confirm the values took* rather than trusting the exit status:

```sh
sudo install -m 644 serve/sysctl-tiles.conf /etc/sysctl.d/60-tiles.conf
sudo sysctl -p /etc/sysctl.d/60-tiles.conf
sysctl net.core.somaxconn net.ipv4.ip_local_port_range
```

Then run a real region download from the app and watch `ss -s` for `timewait` growth and
`ss -ltn` for `Recv-Q` on `:443` and `:8081`.

---

## The verification ladder

Run this after **any** change to the box. It is ordered so the cheapest check that can catch
your mistake comes first.

```sh
# 1. Caddy config is still valid, and still imports our file
ssh ubuntu@51.222.206.236 'sudo caddy validate --config /etc/caddy/Caddyfile'
ssh ubuntu@51.222.206.236 'grep -n "^import /etc/caddy/conf.d" /etc/caddy/Caddyfile; ls -l /etc/caddy/conf.d/'

# 2. Services are up, and the journal is clean
ssh ubuntu@51.222.206.236 'systemctl is-active caddy pmtiles; journalctl -u pmtiles -n 50 --no-pager'

# 3. TLS answers at all (alert 80 / no certificate = the site block is gone)
curl -sI https://tiles.sgss.ca/style.json

# 4. Every tileset's TileJSON
for t in basemap terrain contours roads context; do
  printf '%s %s\n' "$t" "$(curl -s -o /dev/null -w '%{http_code}' https://tiles.sgss.ca/$t.json)"
done

# 5. One real tile (404 here with a 200 above = permissions under /srv/basemap)
curl -s -o /dev/null -w '%{http_code}\n' https://tiles.sgss.ca/basemap/8/40/87.mvt

# 6. Static assets (403 here while tiles work = /srv/basemap is 750, not 755)
curl -s -o /dev/null -w '%{http_code}\n' 'https://tiles.sgss.ca/glyphs/Open%20Sans%20Bold/0-255.pbf'
curl -s -o /dev/null -w '%{http_code}\n' https://tiles.sgss.ca/sprite.json
```

7. Open **https://tiles.sgss.ca/preview.html** in a browser — style, glyphs, sprites and the
   tilesets it references, all exercised at once. This is the check `deploy.sh` is designed
   around, and the reason `preview.html` is inside the synced tree.
8. From the app: start a pack download, `systemctl restart pmtiles` mid-download (what every
   deploy does), and confirm the download recovers rather than alerting "Download failed".

## Rolling back

- **Caddy:** `sudo rm /etc/caddy/conf.d/<yours>.caddy`, then `caddy validate`, then
  `systemctl reload caddy`.
- **A unit:** `sudo systemctl disable --now <unit>`, remove the file, `daemon-reload`.
- **Tile data:** fix `out/` and re-run `deploy.sh`. Because the sync is `--delete`, the box is
  always exactly what `out/` was — so a bad deploy is repaired by repairing `out/`, never by
  editing files on the box.
- **A ban:** `tile-guard.sh --unban <ip>`. Bans live in the kernel only; a reboot clears them.

## Failures that are silent, or that look like something else

| Symptom | Actual cause |
|---|---|
| Blank map in the app; TLS alert 80, no certificate | The site block is gone — a website deploy removed the `import` line, or `conf.d/tiles.caddy` was deleted |
| Every tile 404s right after a deploy | `/srv/basemap` files are `ubuntu`-owned and unreadable by the `pmtiles` user (rsync `-a` preserving Windows modes). `deploy.sh` fixes this with an explicit `chown -R ubuntu:pmtiles` |
| Glyphs and sprites 403 while tiles are fine | `/srv/basemap` is `750`; the `caddy` user is in neither group and cannot traverse it. It must be `755` |
| Labels vanish from the map and nothing errors | The style asks for a font stack we do not self-host. `06-style.sh` has an exhaustive check for this — keep it exhaustive |
| `createPack` reports success, then the map is blank offline | The published `style.json` and the app's bundled `lib/basemap-style.json` disagree about a source `url`, so the pack cached tiles under a different key than the map requests |
| A whole zoom range of empty tile requests during pack downloads | Style `minzoom` is lower than what the archive really contains |
| CORS failures in the browser only | A second `Access-Control-Allow-Origin` added in Caddy on top of go-pmtiles' |
| `caddy validate` fails during someone else's deploy | `/var/log/caddy/tiles.log` is root-owned; see the tmpfiles rule |
| Caddy returns 502 mid-download | Ephemeral port exhaustion on the loopback hop — check the keepalive snippet is still imported and that the sysctl values took |
| `Permission denied (publickey)` to a box you can ssh to by hand | `DEPLOY_SSH` names a proxied hostname, or `~/.ssh/config` is supplying an identity the containerised rsync never sees. Use the address, and `DEPLOY_SSH_KEY` |
| A multi-GB deploy "succeeds" but the data is wrong | The tar-over-ssh fallback cannot detect a send-side pipe failure (POSIX sh has no `pipefail`). Trust the smoke test, not the exit status — better, install rsync or podman |

## Known gaps — open work an agent may be asked to close

1. **`roads.json` and `context.json` are not in the `@tilejson` matcher** in
   `serve/Caddyfile.example`. They are reachable through the catch-all, but get the 30-day
   tile cache header instead of the one-hour TileJSON one.
2. **`preview.html` loads only `basemap`, `terrain` and `contours`.** The post-deploy browser
   smoke test therefore never exercises the two BC-data tilesets.
3. **`deploy.sh`'s presence check** lists `terrain`, `contours`, glyphs and sprites — not
   `roads.pmtiles` or `context.pmtiles`, so a missing one deploys without a warning.
4. **The UNVERIFIED checklist at the end of `basemap/README.md`** is the standing list of
   things believed correct from documentation but never exercised. Tick items off it as you
   confirm them, and add to it rather than quietly assuming.
5. **The VPS's real public bandwidth figure** is still unrecorded; OVH's comparison page lists
   the 2027 range only. It has to be read off the panel's network tab.

## Decisions already made — do not relitigate them alone

These were settled, with reasons recorded in the files named. Re-opening one is a conversation
with the user, not a change you make:

- **No CDN in front of `tiles.sgss.ca`.** WHC's client-area Cloudflare proxies the apex and
  `www` only; SGS owns no Cloudflare account; and moving a zone that carries company email
  under `p=quarantine` was judged too destructive. (`serve/Caddyfile.example`)
- **No custom Caddy build.** `rate_limit` needs `xcaddy`, and swapping the Caddy binary on a
  box that also serves sgss.ca risks the company website to protect a tile server.
- **No nginx sidecar until measurement calls for it.** (`serve/nginx-tiles.conf.example`)
- **No `tile-guard` thresholds without `tile-stats.sh` output** from a real pack download.
- **Satellite imagery stays out of `style.json`.** Putting it there would bulk-cache Esri
  tiles into every offline pack — the exact thing this pipeline exists to avoid.

And the ones that need a human hand regardless: anything that writes to `/etc/caddy/Caddyfile`,
`systemctl restart caddy`, and any `rm` inside `/srv/basemap`.
