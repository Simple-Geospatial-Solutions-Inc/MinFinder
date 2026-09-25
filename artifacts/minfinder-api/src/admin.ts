// Staff moderation from the box (the same actions as the /admin page):
//
//   sudo -u minfinder-api env DATA_DIR=/var/lib/minfinder-api node /srv/minfinder-api/app/src/admin.ts <command>
//
//   queue                 probation and held reports, and anything flagged or collapsed
//   show <id>             one report in full, with its photo paths for scp
//   approve <id>          release a probation or held report
//   verify <id>           staff-verify: "Verified by SGS"
//   remove <id>           take it down; devices drop it on their next sync
//   restore <id>          undo remove, and clear its reports
//   ban <id>              ban the author of that report and remove everything they submitted
import { join } from "node:path";
import { CONTRIBUTION_SELECT, openDb } from "./db.ts";
import { ACTIONS, moderate, queue, reportReasons, statusOfRow, type Action } from "./moderation.ts";

const dataDir = process.env.DATA_DIR ?? "./data";
const db = openDb(join(dataDir, "api.db"));
const [cmd, arg] = process.argv.slice(2);

if (cmd === "queue") {
  console.table(
    queue(db).map((m) => ({
      id: m.id, user_id: m.user_id, minfilno: m.minfilno, kind: m.kind, label: m.label, status: statusOfRow(m), reports: m.reports,
      created: new Date(m.created_at).toISOString(),
    })),
  );
} else if (cmd === "show" && arg) {
  const m = db.prepare(`${CONTRIBUTION_SELECT} WHERE c.id = ?`).get(arg);
  if (!m) throw new Error(`no report ${arg}`);
  console.log(m);
  console.log(reportReasons(db, arg));
  for (const p of JSON.parse(String(m.photo_ids))) console.log(join(dataDir, "photos", `${p}.jpg`));
} else if ((ACTIONS as readonly string[]).includes(cmd) && arg) {
  console.log(moderate(db, cmd as Action, arg));
} else {
  console.log(`usage: admin.ts queue | show <id> | ${ACTIONS.map((a) => `${a} <id>`).join(" | ")}`);
  process.exitCode = 1;
}
