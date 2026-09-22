// Staff moderation from the box until the admin page lands in phase 4:
//
//   sudo -u minfinder-api env DATA_DIR=/var/lib/minfinder-api node /srv/minfinder-api/app/src/admin.ts <command>
//
//   queue                 pending (probation) submissions and anything reported or hidden
//   show <id>             one submission in full, with its photo paths for scp
//   approve <id>          release a probation submission
//   verify <id>           staff-verify (the top tier)
//   remove <id>           take it down; devices drop it on their next sync
//   restore <id>          undo remove, and clear its reports
//   ban <user_id>         ban the account and remove everything it submitted
//
// Every write bumps the mine's seq, which is what makes the change reach devices.
import { join } from "node:path";
import { bump, MINE_SELECT, openDb } from "./db.ts";

const dataDir = process.env.DATA_DIR ?? "./data";
const db = openDb(join(dataDir, "api.db"));
const [cmd, arg] = process.argv.slice(2);

function set(sql: string, id: string) {
  const r = db.prepare(sql).run(id);
  if (!r.changes) throw new Error(`no mine ${id}`);
  bump(db, id);
  console.log(`${cmd} ${id}: done`);
}

switch (cmd) {
  case "queue":
    console.table(
      db
        .prepare(`SELECT id, user_id, type, name, approved, net, reports, datetime(created_at / 1000, 'unixepoch') AS created
                  FROM (${MINE_SELECT}) WHERE removed = 0 AND (approved = 0 OR reports > 0 OR net <= -3) ORDER BY created_at`)
        .all(),
    );
    break;
  case "show": {
    const m = db.prepare(`${MINE_SELECT} WHERE m.id = ?`).get(arg);
    if (!m) throw new Error(`no mine ${arg}`);
    console.log(m);
    console.log(db.prepare("SELECT reason, COUNT(*) AS n FROM reports WHERE mine_id = ? GROUP BY reason").all(arg));
    for (const p of JSON.parse(String(m.photo_ids))) console.log(join(dataDir, "photos", `${p}.jpg`));
    break;
  }
  case "approve":
    set("UPDATE mines SET approved = 1 WHERE id = ?", arg);
    break;
  case "verify":
    set("UPDATE mines SET approved = 1, staff_verified = 1 WHERE id = ?", arg);
    break;
  case "remove":
    set("UPDATE mines SET removed = 1 WHERE id = ?", arg);
    break;
  case "restore":
    db.prepare("DELETE FROM reports WHERE mine_id = ?").run(arg);
    set("UPDATE mines SET removed = 0 WHERE id = ?", arg);
    break;
  case "ban": {
    db.prepare("UPDATE users SET banned = 1 WHERE id = ?").run(Number(arg));
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(Number(arg));
    const ids = db.prepare("SELECT id FROM mines WHERE user_id = ? AND removed = 0").all(Number(arg)) as { id: string }[];
    for (const { id } of ids) set("UPDATE mines SET removed = 1 WHERE id = ?", id);
    console.log(`banned user ${arg}, removed ${ids.length} submissions`);
    break;
  }
  default:
    console.log("usage: admin.ts queue | show <id> | approve <id> | verify <id> | remove <id> | restore <id> | ban <user_id>");
    process.exitCode = 1;
}
