#!/usr/bin/env sh
# tile-guard.sh — periodic aggregate-and-ban for abusive tile clients.
#
# Each run (every 5 min via tile-guard.timer) reads the tail of Caddy's JSON
# access log for tiles.sgss.ca, totals requests and bytes per client IP over
# the last TILE_GUARD_WINDOW seconds, and adds any address over threshold to
# an nftables set with a timeout. Packets from a banned address to :80/:443
# are DROPPED until the entry expires; nothing else on the box is touched.
#
# THRESHOLDS SHIP UNSET. With neither TILE_GUARD_MAX_REQUESTS nor
# TILE_GUARD_MAX_BYTES set, the script only reports the top clients in the
# window and bans nothing. Set them in /etc/default/tile-guard FROM
# tile-stats.sh OUTPUT, never from a guess: the app's offline downloader
# legitimately issues ~57,000 requests / ~400 MB for one maximum-size pack,
# a good connection finishes that inside a single window, and several users
# behind one office NAT share one address. A threshold that a real customer
# can reach is a self-inflicted outage — start no lower than 5x a full pack
# and let the Top IPs table from tile-stats.sh argue you down.
#
# Why this and not fail2ban: fail2ban keeps per-line, per-IP state and is
# built for "N failed logins"; a legitimate pack download is 57,000 successful
# lines from one address in a few minutes, which is exactly the shape it
# treats as an attack. Summing a window and comparing to a measured ceiling
# is a better fit, and small enough to read.
#
# Why drop, not reject or 429: a rejected request is an error the client acts
# on immediately; a dropped SYN is a connection timeout that MapLibre retries
# with exponential backoff (mln/util/http_timeout.cpp) and that
# app/offline.tsx rides out — so a wrongly banned real user degrades to a
# slow download, not a failed one. It is also the only response that costs
# the origin zero bytes against a scraper.
#
# Install (as root):
#   apt install jq nftables
#   install -m 755 tile-guard.sh /usr/local/sbin/tile-guard.sh
#   install -m 644 tile-guard.service tile-guard.timer /etc/systemd/system/
#   printf 'TILE_GUARD_MAX_REQUESTS=\nTILE_GUARD_MAX_BYTES=\n' > /etc/default/tile-guard
#   tile-guard.sh --dry-run          # against real log data, DURING a pack download
#   systemctl daemon-reload && systemctl enable --now tile-guard.timer
#   journalctl -u tile-guard.service  # each run's report and any bans
#
# Environment (all optional; systemd reads them from /etc/default/tile-guard):
#   TILE_GUARD_MAX_REQUESTS  ban above this many requests per window   (unset = report only)
#   TILE_GUARD_MAX_BYTES     ban above this many response bytes per window (unset = report only)
#   TILE_GUARD_WINDOW        seconds of log to judge, default 600
#   TILE_GUARD_BAN_SECONDS   how long a ban lasts, default 3600
#   TILE_GUARD_ALLOW         space-separated addresses never banned (office egress, monitors)
#   TILE_GUARD_LOG           default /var/log/caddy/tiles.log
#   TILE_GUARD_TAIL_LINES    lines read from the end of the log, default 1000000;
#                            the run warns if that did not reach back a full window
#
# Usage:
#   tile-guard.sh              judge the window; ban if thresholds are set
#   tile-guard.sh --dry-run    same report, prints WOULD BAN, changes nothing
#   tile-guard.sh --list       show current bans and their remaining time
#   tile-guard.sh --unban IP   lift one ban now (a customer on the phone)
#
# Bans live in the kernel only: a reboot clears them, and the next timer run
# recreates the table when it next needs to ban. Loopback and RFC1918/ULA
# addresses are never banned regardless of thresholds.
set -eu

LOG=${TILE_GUARD_LOG:-/var/log/caddy/tiles.log}
WINDOW=${TILE_GUARD_WINDOW:-600}
TAIL_LINES=${TILE_GUARD_TAIL_LINES:-1000000}
MAX_REQUESTS=${TILE_GUARD_MAX_REQUESTS:-}
MAX_BYTES=${TILE_GUARD_MAX_BYTES:-}
BAN_SECONDS=${TILE_GUARD_BAN_SECONDS:-3600}
ALLOW=${TILE_GUARD_ALLOW:-}

# nftables address family and table name, passed as two arguments everywhere.
FAMILY=inet
TABLE=tileguard

usage() {
  sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//'
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "tile-guard: $1 is required ($2)." >&2
    exit 1
  fi
}

# Create the table, sets and drop rules if they are not there. Idempotent:
# `nft list table` succeeds once it exists. Priority -10 runs ahead of the
# distribution's own filter chains (ufw/iptables-nft at 0) without touching
# them. Sets carry `flags timeout` so every ban expires on its own.
ensure_table() {
  nft list table "$FAMILY" "$TABLE" >/dev/null 2>&1 && return 0
  nft -f - <<EOF
table $FAMILY $TABLE {
	set banned {
		type ipv4_addr
		flags timeout
	}
	set banned6 {
		type ipv6_addr
		flags timeout
	}
	chain input {
		type filter hook input priority -10; policy accept;
		ip saddr @banned tcp dport { 80, 443 } drop
		ip6 saddr @banned6 tcp dport { 80, 443 } drop
	}
}
EOF
  echo "tile-guard: created nftables table '$FAMILY $TABLE'."
}

set_for() {
  case "$1" in
    *:*) echo banned6 ;;
    *)   echo banned ;;
  esac
}

# Addresses that must never be banned: loopback, RFC1918, link-local, ULA,
# plus anything in TILE_GUARD_ALLOW.
is_protected() {
  case "$1" in
    127.*|10.*|192.168.*|169.254.*|::1|fe80:*|fc*|fd*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
  esac
  for a in $ALLOW; do
    [ "$a" = "$1" ] && return 0
  done
  return 1
}

ban() {
  ip=$1; why=$2
  set=$(set_for "$ip")
  if [ "$DRY_RUN" = 1 ]; then
    echo "tile-guard: WOULD BAN $ip for ${BAN_SECONDS}s ($why)"
    return 0
  fi
  ensure_table
  # Delete-then-add rather than plain add: adding an element that already
  # exists fails, and re-adding is how a still-abusive address gets its
  # timeout refreshed.
  nft delete element "$FAMILY" "$TABLE" "$set" "{ $ip }" 2>/dev/null || true
  nft add element "$FAMILY" "$TABLE" "$set" "{ $ip timeout ${BAN_SECONDS}s }"
  echo "tile-guard: BANNED $ip for ${BAN_SECONDS}s ($why)"
}

DRY_RUN=0
MODE=judge
UNBAN_IP=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --list)    MODE=list ;;
    --unban)   MODE=unban; shift; UNBAN_IP=${1:-} ;;
    -h|--help) usage; exit 0 ;;
    *) echo "tile-guard: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$MODE" in
  list)
    need nft "apt install nftables"
    if nft list table "$FAMILY" "$TABLE" >/dev/null 2>&1; then
      nft list set "$FAMILY" "$TABLE" banned
      nft list set "$FAMILY" "$TABLE" banned6
    else
      echo "tile-guard: no bans (table '$FAMILY $TABLE' does not exist)."
    fi
    exit 0
    ;;
  unban)
    need nft "apt install nftables"
    [ -n "$UNBAN_IP" ] || { echo "tile-guard: --unban needs an address" >&2; exit 2; }
    if nft delete element "$FAMILY" "$TABLE" "$(set_for "$UNBAN_IP")" "{ $UNBAN_IP }" 2>/dev/null; then
      echo "tile-guard: unbanned $UNBAN_IP"
    else
      echo "tile-guard: $UNBAN_IP was not banned"
    fi
    exit 0
    ;;
esac

need jq "apt install jq"
if [ -z "$MAX_REQUESTS" ] && [ -z "$MAX_BYTES" ]; then
  echo "tile-guard: no thresholds set (TILE_GUARD_MAX_REQUESTS / TILE_GUARD_MAX_BYTES) — report only."
  DRY_RUN=1
fi
if [ "$DRY_RUN" = 0 ]; then
  need nft "apt install nftables"
  if [ "$(id -u)" -ne 0 ]; then
    echo "tile-guard: banning needs root (nft); use --dry-run to only report." >&2
    exit 1
  fi
fi
if [ ! -r "$LOG" ]; then
  echo "tile-guard: cannot read $LOG (Caddy's log is 0640 caddy:caddy; run as root)." >&2
  exit 1
fi

now=$(date +%s)
since=$((now - WINDOW))

# jq flattens to "ts ip bytes"; awk keeps only the window, sums per IP, and
# reports whether the tail reached back far enough to cover the whole window.
# Field precedence: client_ip (set when Caddy has trusted_proxies configured),
# remote_ip (Caddy >= 2.5), remote_addr "ip:port" (older Caddy).
summary=$(mktemp)
trap 'rm -f "$summary"' EXIT INT TERM
tail -n "$TAIL_LINES" "$LOG" | jq -r '
  select(.request != null and .ts != null)
  | [
      (.ts | floor),
      (.request.client_ip // .request.remote_ip
        // ((.request.remote_addr // "?") | sub(":[0-9]+$"; "")
            | ltrimstr("[") | rtrimstr("]"))),
      (.size // 0)
    ] | @tsv' \
| awk -F '\t' -v since="$since" -v window="$WINDOW" '
    { if (NR == 1 || $1 < oldest) oldest = $1 }
    $1 >= since && $2 != "?" { req[$2]++; bytes[$2] += $3 }
    END {
      if (NR > 0 && oldest > since)
        printf "tile-guard: WARNING: log tail only reaches back %d s of the %d s window; raise TILE_GUARD_TAIL_LINES\n", (oldest > 0 ? (since + window) - oldest : 0), window > "/dev/stderr"
      for (ip in req) printf "%s\t%d\t%d\n", ip, req[ip], bytes[ip]
    }' \
| sort -t "$(printf '\t')" -k2,2nr > "$summary"

total=$(wc -l < "$summary" | tr -d ' ')
echo "tile-guard: last ${WINDOW}s — $total client address(es); thresholds: requests=${MAX_REQUESTS:-unset} bytes=${MAX_BYTES:-unset}"
printf '  %10s  %14s  %s\n' REQUESTS BYTES ADDRESS
head -n 10 "$summary" | while IFS="$(printf '\t')" read -r ip req bytes; do
  printf '  %10d  %14d  %s\n' "$req" "$bytes" "$ip"
done

banned=0
while IFS="$(printf '\t')" read -r ip req bytes; do
  why=
  if [ -n "$MAX_REQUESTS" ] && [ "$req" -gt "$MAX_REQUESTS" ]; then
    why="requests $req > $MAX_REQUESTS"
  fi
  if [ -n "$MAX_BYTES" ] && [ "$bytes" -gt "$MAX_BYTES" ]; then
    why="${why:+$why, }bytes $bytes > $MAX_BYTES"
  fi
  [ -n "$why" ] || continue
  if is_protected "$ip"; then
    echo "tile-guard: $ip is over threshold ($why) but protected; not banned."
    continue
  fi
  ban "$ip" "$why"
  banned=$((banned + 1))
done < "$summary"

if [ "$banned" -eq 0 ]; then
  echo "tile-guard: nothing over threshold."
fi
