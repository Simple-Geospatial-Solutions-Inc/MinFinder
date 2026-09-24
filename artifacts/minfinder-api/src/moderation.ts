// Staff actions, shared by the CLI (admin.ts) and the web page (/admin in server.ts). Every
// write bumps the mine's seq, which is what makes the change reach devices.
import { bump, MINE_SELECT, tx, type DB } from "./db.ts";

export const ACTIONS = ["approve", "verify", "remove", "restore", "ban"] as const;
export type Action = (typeof ACTIONS)[number];

/** Probation submissions plus anything reported or voted down, oldest first. */
export function queue(db: DB): Record<string, any>[] {
  return db
    .prepare(
      `SELECT * FROM (${MINE_SELECT}) WHERE removed = 0 AND (approved = 0 OR reports > 0 OR net <= -3) ORDER BY created_at`,
    )
    .all() as Record<string, any>[];
}

export function reportReasons(db: DB, id: string): { reason: string; n: number }[] {
  return db.prepare("SELECT reason, COUNT(*) AS n FROM reports WHERE mine_id = ? GROUP BY reason").all(id) as any[];
}

/** Applies one action to a mine; `ban` bans the mine's author and removes all they submitted. */
export function moderate(db: DB, action: Action, id: string): string {
  return tx(db, () => {
    const m = db.prepare("SELECT user_id FROM mines WHERE id = ?").get(id) as { user_id: number | null } | undefined;
    if (!m) throw new Error(`no mine ${id}`);
    const set = (sql: string, mineId = id) => {
      db.prepare(sql).run(mineId);
      bump(db, mineId);
    };
    switch (action) {
      case "approve":
        set("UPDATE mines SET approved = 1 WHERE id = ?");
        break;
      case "verify":
        set("UPDATE mines SET approved = 1, staff_verified = 1 WHERE id = ?");
        break;
      case "remove":
        set("UPDATE mines SET removed = 1 WHERE id = ?");
        break;
      case "restore":
        db.prepare("DELETE FROM reports WHERE mine_id = ?").run(id);
        set("UPDATE mines SET removed = 0 WHERE id = ?");
        break;
      case "ban": {
        if (m.user_id === null) throw new Error("that account is already deleted");
        db.prepare("UPDATE users SET banned = 1 WHERE id = ?").run(m.user_id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(m.user_id);
        const ids = db.prepare("SELECT id FROM mines WHERE user_id = ? AND removed = 0").all(m.user_id) as { id: string }[];
        for (const r of ids) set("UPDATE mines SET removed = 1 WHERE id = ?", r.id);
        return `banned the author, removed ${ids.length} submissions`;
      }
    }
    return `${action}: done`;
  });
}
