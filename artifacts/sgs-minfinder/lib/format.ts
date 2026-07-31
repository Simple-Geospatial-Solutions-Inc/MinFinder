// Small display formatters shared by the offline-region rows and the map's
// region pill.

// Byte counts come from MapLibre's `OfflinePack.status()` and are shown per
// region. Regions are tens of MB, so MB is the useful unit; KB only shows up
// for a download that has barely started.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 100) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

// `metadata.createdAt` epoch ms -> "Jul 28". Returns null for packs created
// before the app started recording a timestamp, so callers can drop the line
// entirely rather than render "Invalid Date".
export function formatShortDate(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
