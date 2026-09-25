#!/usr/bin/env sh
# pull-backup.sh — copy the newest nightly database backup and every photo off the VPS, then
# prove the copy restores: SQLite's integrity check passes and every photo row has its files.
#
# ponytail: a stopgap. It's manual, it lands on the operator's machine and it copies every photo
# each run. Replace with an automated off-box destination (object storage) when there is one.
#
# The copy holds users' Apple/Google ids: keep it on an encrypted disk and don't share it.
#
# Env overrides:
#   BACKUP_DIR      default ~/minfinder-backups (a dated folder is made inside it)
#   DEPLOY_SSH      ssh destination, default ubuntu@51.222.206.236
#   DEPLOY_SSH_KEY  default ~/.ssh/minfinder_tiles
set -eu

DEPLOY_SSH="${DEPLOY_SSH:-ubuntu@51.222.206.236}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/minfinder_tiles}"
DEST="${BACKUP_DIR:-$HOME/minfinder-backups}/$(date -u +%Y%m%d-%H%M)"
mkdir -p "$DEST"
chmod 700 "$DEST"

# Read-only on the box: finds the newest backup, warns if the nightly timer has stopped, and
# streams that file plus photos/ back. The state directory is 0750, so globbing needs sudo too.
ssh -i "$DEPLOY_SSH_KEY" -o StrictHostKeyChecking=accept-new "$DEPLOY_SSH" '
  set -eu
  cd /var/lib/minfinder-api
  latest=$(sudo sh -c "ls -1t backups/api-*.db 2>/dev/null | head -1")
  [ -n "$latest" ] || { echo "pull-backup: no backups on the box" >&2; exit 1; }
  if [ -n "$(sudo find "$latest" -mmin +1560)" ]; then
    echo "pull-backup: WARNING newest backup $latest is over 26 hours old; check minfinder-api-backup.timer" >&2
  fi
  sudo tar -cf - "$latest" photos
' | tar -C "$DEST" -xf -

# Node on Windows needs a Windows path; `pwd -W` gives one in Git Bash and fails elsewhere.
DIR=$(cd "$DEST" && (pwd -W 2>/dev/null || pwd))
node --disable-warning=ExperimentalWarning --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  import { existsSync, readdirSync } from "node:fs";
  import { join } from "node:path";
  const dir = process.argv[1];
  const file = readdirSync(join(dir, "backups")).find((f) => f.endsWith(".db"));
  const db = new DatabaseSync(join(dir, "backups", file), { readOnly: true });
  const check = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const n = (sql) => Object.values(db.prepare(sql).get())[0];
  const photos = db.prepare("SELECT id FROM photos").all();
  const missing = photos.filter((p) => !existsSync(join(dir, "photos", p.id + ".jpg")) || !existsSync(join(dir, "photos", p.id + "_t.jpg")));
  console.log(`backup ${file}: integrity ${check}; ${n("SELECT COUNT(*) FROM contributions WHERE removed = 0")} live reports, ` +
    `${n("SELECT COUNT(*) FROM users")} users, ${photos.length} photos (${missing.length} missing files)`);
  if (check !== "ok" || missing.length) process.exit(1);
' "$DIR"
echo "pull-backup: saved to $DEST"
