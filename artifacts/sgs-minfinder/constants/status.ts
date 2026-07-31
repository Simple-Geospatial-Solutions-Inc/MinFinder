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
  /**
   * Plain-language explanation of the MINFILE status, shown in the About
   * screen's marker legend. Optional so the `getStatusInfo` fallbacks below
   * (unknown or missing codes) don't need one.
   */
  description?: string;
}

export const STATUS_MAP: Record<string, StatusInfo> = {
  PROD: {
    code: "PROD",
    label: "Producer",
    short: "PR",
    color: "#D7263D",
    description:
      "A mine in production — ore is being extracted and shipped. These are " +
      "active industrial sites: access is normally restricted and permission " +
      "is required.",
  },
  PAPR: {
    code: "PAPR",
    label: "Past Producer",
    short: "PP",
    color: "#8B1E3F",
    description:
      "Ore was mined and shipped here at some point, but the operation has " +
      "stopped. Old workings — adits, shafts, pits, tailings — may still be " +
      "on the ground and can be unsafe.",
  },
  DEPR: {
    code: "DEPR",
    label: "Developed Prospect",
    short: "DP",
    color: "#F46036",
    description:
      "Exploration went far enough to outline a resource and put real " +
      "development in the ground — extensive drilling, trenching, sometimes " +
      "adits or shafts — but the site never shipped ore. Between a prospect " +
      "and a mine.",
  },
  PROS: {
    code: "PROS",
    label: "Prospect",
    short: "PS",
    color: "#FCBA19",
    description:
      "Mineralization has been tested by work such as sampling, trenching, " +
      "geophysics or drilling and looks potentially economic. No resource has " +
      "been outlined and nothing has been mined.",
  },
  SHOW: {
    code: "SHOW",
    label: "Showing",
    short: "SH",
    color: "#2E86AB",
    description:
      "Mineralization was observed at surface — in outcrop, float or a " +
      "trench — with little or no follow-up work. This is the most common " +
      "status in MINFILE; grade and extent are usually unknown.",
  },
  ANOM: {
    code: "ANOM",
    label: "Anomaly",
    short: "AN",
    color: "#8E9AAF",
    description:
      "A geochemical or geophysical signal (soil, silt, rock or survey data) " +
      "hints at mineralization, but none has been found in outcrop. The " +
      "weakest level of evidence in the database.",
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
