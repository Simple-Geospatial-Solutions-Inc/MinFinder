#!/usr/bin/env sh
# tile-stats.sh — what the tile server's access log says about real load.
#
# Reports, from Caddy's JSON access log for tiles.sgss.ca:
#   * peak requests/second, overall and per client IP
#   * peak bytes/second and total egress over the log window
#   * repeat-tile share: requests for a tile URL already served earlier in the
#     window — the ceiling on what an edge cache could ever have saved
#   * status code histogram (502s cluster around pmtiles restarts)
#   * top client IPs by request count and by bytes
#
# Why it exists: there is no CDN in front of this server and none is coming
# (see Caddyfile.example), so every burst lands on the origin. The offline
# downloader legitimately issues ~57,000 requests for one maximum-size pack,
# and any per-IP threshold in tile-guard.sh or the nginx sidecar has to sit
# well above what THIS report shows for a real pack download — not above a
# guess. Run it after the first real region download, and again whenever the
# style or zoom range changes the pack size.
#
# Usage:
#   sh tile-stats.sh                       # /var/log/caddy/tiles.log
#   sh tile-stats.sh /path/tiles.log ...   # one or more files; .gz accepted
#   ssh vps 'sudo cat /var/log/caddy/tiles.log' > tiles.log && sh tile-stats.sh tiles.log
#
# Caddy rotates the log as tiles-<timestamp>.log.gz (compression is hardcoded
# in Caddy's file writer), so pass the rotated files too for a wider window:
#   sh tile-stats.sh /var/log/caddy/tiles-*.log.gz /var/log/caddy/tiles.log
#
# Requires jq (apt install jq) and an awk with strftime() — gawk, or the mawk
# Ubuntu ships (≥ 1.3.4); Git Bash has gawk. Memory: the repeat-tile
# count keeps one awk array entry per distinct tile URL — a few hundred MB for
# a multi-million-line log, fine on the 24 GB box.
#
# Log format: Caddy's `log` directive with no `format` emits one JSON object
# per line. Fields used: .ts (unix seconds, float), .request.remote_ip
# (Caddy ≥ 2.5; older builds have .request.remote_addr as "ip:port"),
# .request.uri, .status, .size (response body bytes). If Caddy is ever
# configured with trusted_proxies, .request.client_ip is the real client and
# is preferred when present.
set -eu

# Unlike the build scripts this one reads no config.env and deliberately does
# not cd to basemap/: its arguments are log files, resolved from wherever the
# operator ran it.

if ! command -v jq >/dev/null 2>&1; then
  echo "tile-stats: jq is required (apt install jq / brew install jq / pacman -S jq)." >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  set -- /var/log/caddy/tiles.log
fi
for f in "$@"; do
  if [ ! -r "$f" ]; then
    echo "tile-stats: cannot read $f (missing, or needs sudo — Caddy's log is 0640 caddy:caddy)." >&2
    exit 1
  fi
done

# One jq pass flattens each entry to a TSV line: second, ip, status, size, uri.
# Everything else is a single awk pass over that stream. Lines that are not
# access-log entries (Caddy writes the odd non-request message to the same
# file) lack .request and are skipped.
emit() {
  for f in "$@"; do
    case "$f" in
      *.gz) gzip -dc "$f" ;;
      *)    cat "$f" ;;
    esac
  done | jq -r '
    select(.request != null and .ts != null)
    | [
        (.ts | floor),
        (.request.client_ip // .request.remote_ip
          // ((.request.remote_addr // "?") | sub(":[0-9]+$"; "")
              | ltrimstr("[") | rtrimstr("]"))),
        (.status // 0),
        (.size // 0),
        (.request.uri // "")
      ] | @tsv'
}

emit "$@" | awk -F '\t' '
  {
    n++
    sec = $1; ip = $2; status = $3; size = $4 + 0; uri = $5
    if (n == 1 || sec < t0) t0 = sec
    if (n == 1 || sec > t1) t1 = sec

    bytes += size
    per_sec[sec]++
    bytes_sec[sec] += size
    per_ip_sec[ip "\t" sec]++
    ip_req[ip]++
    ip_bytes[ip] += size
    st[status]++

    # Only tile requests count for repeat share: /{tileset}/{z}/{x}/{y}.{ext}.
    # A ? is stripped so a cache-busting query cannot hide a repeat.
    sub(/\?.*$/, "", uri)
    if (uri ~ /^\/[A-Za-z0-9_-]+\/[0-9]+\/[0-9]+\/[0-9]+\.[a-z]+$/) {
      tiles++
      if (uri in seen) repeats++
      else seen[uri] = 1
      tile_bytes += size
    }
  }
  function human(b) {
    if (b >= 1073741824) return sprintf("%.2f GiB", b / 1073741824)
    if (b >= 1048576)    return sprintf("%.1f MiB", b / 1048576)
    if (b >= 1024)       return sprintf("%.1f KiB", b / 1024)
    return b " B"
  }
  END {
    if (n == 0) { print "tile-stats: no access-log entries found."; exit 0 }
    span = t1 - t0 + 1

    printf "Window   : %s .. %s  (%d s, %d requests)\n", strftime("%Y-%m-%d %H:%M:%SZ", t0, 1), strftime("%Y-%m-%d %H:%M:%SZ", t1, 1), span, n
    printf "Egress   : %s total, %s tiles only, %s/s average\n", human(bytes), human(tile_bytes), human(bytes / span)

    pk = 0; for (s in per_sec)   if (per_sec[s]   > pk) { pk = per_sec[s]; pks = s }
    pb = 0; for (s in bytes_sec) if (bytes_sec[s] > pb) { pb = bytes_sec[s]; pbs = s }
    printf "Peak     : %d req/s at %s, %s/s at %s\n", pk, strftime("%H:%M:%SZ", pks, 1), human(pb), strftime("%H:%M:%SZ", pbs, 1)

    # Peak req/s for any single IP: the number a per-IP limiter would have to
    # tolerate for a legitimate download.
    pi = 0
    for (k in per_ip_sec) if (per_ip_sec[k] > pi) { pi = per_ip_sec[k]; pik = k }
    split(pik, parts, "\t")
    printf "Peak/IP  : %d req/s from %s at %s\n", pi, parts[1], strftime("%H:%M:%SZ", parts[2], 1)

    if (tiles > 0)
      printf "Repeats  : %d of %d tile requests (%.1f%%) were for a URL already served in this window — the most an edge cache could have absorbed\n", repeats, tiles, 100 * repeats / tiles
    else
      print "Repeats  : no tile-shaped URLs in this log"

    printf "\nStatus   :"
    for (s in st) printf "  %s=%d", s, st[s]
    printf "\n"

    # fflush() before each sort pipe: awk buffers its own stdout, sort writes
    # straight to the terminal, and without the flush the heading can land
    # below the list it introduces.
    print "\nTop IPs by requests:"; fflush()
    for (i in ip_req) printf "  %10d  %-40s %s\n", ip_req[i], i, human(ip_bytes[i]) | "sort -rn | head -10"
    close("sort -rn | head -10")

    print "\nTop IPs by bytes:"; fflush()
    for (i in ip_bytes) printf "  %14d  %-40s %d req  (%s)\n", ip_bytes[i], i, ip_req[i], human(ip_bytes[i]) | "sort -rn | head -10"
    close("sort -rn | head -10")

    print "\nA maximum-size offline pack is ~57,000 requests / ~400 MB from one IP."
    print "Any per-IP threshold (tile-guard.sh, nginx sidecar) must clear that with"
    print "room for several users behind one NAT — set it from these numbers."
  }
'
