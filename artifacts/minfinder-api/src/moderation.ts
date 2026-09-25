// Staff actions, shared by the CLI (admin.ts) and the web page (/admin in server.ts). Every
// write bumps the report's seq, which is what makes the change reach devices.
import { bump, CONTRIBUTION_SELECT, tx, type DB } from "./db.ts";
import { publishedPoint } from "./minfile.ts";
import { status } from "./rules.ts";

const DONE: Record<Action, string> = {
  approve: "Approved. It's now public in the app.",
  verify: "Verified. It shows as SGS verified in the app.",
  remove: "Removed. It disappears from phones at their next sync.",
  restore: "Flags cleared.",
  ban: "",
};

export const ACTIONS = ["approve", "verify", "remove", "restore", "ban"] as const;
export type Action = (typeof ACTIONS)[number];

export function statusOfRow(c: Record<string, any>) {
  return status({
    approved: !!c.approved, staffVerified: !!c.staff_verified, reports: c.reports, kind: c.kind,
    capturedAt: c.captured_at, verdicts: JSON.parse(c.verdicts),
  });
}

/**
 * Probation and held reports, anything flagged, and anything visitors mostly disagree with,
 * oldest first. Status needs the decay maths, so the last filter runs here rather than in SQL.
 */
export function queue(db: DB): Record<string, any>[] {
  const rows = db.prepare(`${CONTRIBUTION_SELECT} WHERE c.removed = 0 ORDER BY c.created_at`).all() as Record<string, any>[];
  return rows.filter((c) => !c.approved || c.reports > 0 || statusOfRow(c) === "collapsed");
}

export function reportReasons(db: DB, id: string): { reason: string; n: number }[] {
  return db.prepare("SELECT reason, COUNT(*) AS n FROM reports WHERE contribution_id = ? GROUP BY reason").all(id) as any[];
}

/** Applies one action to a report; `ban` bans its author and removes all they submitted. */
export function moderate(db: DB, action: Action, id: string): string {
  return tx(db, () => {
    const m = db.prepare("SELECT user_id, kind, label, minfilno FROM contributions WHERE id = ?").get(id) as
      | { user_id: number | null; kind: string; label: string | null; minfilno: string }
      | undefined;
    if (!m) throw new Error("That report no longer exists. Someone may have removed it already.");
    const set = (sql: string, target = id) => {
      db.prepare(sql).run(target);
      bump(db, target);
    };
    switch (action) {
      case "approve":
        set("UPDATE contributions SET approved = 1 WHERE id = ?");
        break;
      case "verify":
        set("UPDATE contributions SET approved = 1, staff_verified = 1 WHERE id = ?");
        break;
      case "remove":
        set("UPDATE contributions SET removed = 1 WHERE id = ?");
        break;
      case "restore":
        db.prepare("DELETE FROM reports WHERE contribution_id = ?").run(id);
        set("UPDATE contributions SET removed = 0 WHERE id = ?");
        break;
      case "ban": {
        if (m.user_id === null) throw new Error("That author has already deleted their account.");
        db.prepare("UPDATE users SET banned = 1 WHERE id = ?").run(m.user_id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(m.user_id);
        const ids = db.prepare("SELECT id FROM contributions WHERE user_id = ? AND removed = 0").all(m.user_id) as { id: string }[];
        for (const r of ids) set("UPDATE contributions SET removed = 1 WHERE id = ?", r.id);
        return `Banned the author and removed their ${ids.length} ${ids.length === 1 ? "report" : "reports"}.`;
      }
    }
    // "Adit location at NELSON CLAY: Approved. It's now public in the app."
    const what = m.kind === "location" ? `${m.label ?? "Other"} location` : m.kind === "not_found" ? "Couldn't-find-it report" : "Comment";
    const mine = publishedPoint(m.minfilno)?.name || `MINFILE ${m.minfilno}`;
    return `${what.replace(/^./, (c) => c.toUpperCase())} at ${mine}: ${DONE[action]}`;
  });
}
