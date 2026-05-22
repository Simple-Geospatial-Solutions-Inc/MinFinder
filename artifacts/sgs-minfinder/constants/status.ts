export type StatusCode =
  | "PROD"
  | "PAPR"
  | "DEPR"
  | "PROS"
  | "SHOW"
  | "ANOM"
  | string;

export interface StatusInfo {
  code: StatusCode;
  label: string;
  color: string;
  short: string;
}

export const STATUS_MAP: Record<string, StatusInfo> = {
  PROD: {
    code: "PROD",
    label: "Producer",
    short: "PR",
    color: "#D7263D",
  },
  PAPR: {
    code: "PAPR",
    label: "Past Producer",
    short: "PP",
    color: "#8B1E3F",
  },
  DEPR: {
    code: "DEPR",
    label: "Developed Prospect",
    short: "DP",
    color: "#F46036",
  },
  PROS: {
    code: "PROS",
    label: "Prospect",
    short: "PS",
    color: "#FCBA19",
  },
  SHOW: {
    code: "SHOW",
    label: "Showing",
    short: "SH",
    color: "#2E86AB",
  },
  ANOM: {
    code: "ANOM",
    label: "Anomaly",
    short: "AN",
    color: "#8E9AAF",
  },
};

export function getStatusInfo(code: string | null | undefined): StatusInfo {
  if (!code) return { code: "UNK", label: "Unknown", short: "??", color: "#5F6B7A" };
  return (
    STATUS_MAP[code] ?? {
      code,
      label: code,
      short: code.slice(0, 2),
      color: "#5F6B7A",
    }
  );
}

export const STATUS_ORDER: string[] = [
  "PROD",
  "PAPR",
  "DEPR",
  "PROS",
  "SHOW",
  "ANOM",
];
