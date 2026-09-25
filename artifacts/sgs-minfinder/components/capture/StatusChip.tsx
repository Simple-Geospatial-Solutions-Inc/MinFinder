import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import type { OutboxItem, Report } from "@/lib/sync";

type Tone = "ok" | "wait" | "bad" | "neutral";
export interface Status {
  icon: FeatherIconName;
  label: string;
  tone: Tone;
}

export function outboxStatus(item: OutboxItem, signedIn: boolean): Status {
  if (item.state === "rejected") return { icon: "circle-x", label: "Not accepted", tone: "bad" };
  if (!signedIn) return { icon: "user", label: "Sign in to upload", tone: "wait" };
  switch (item.error) {
    case null:
      return { icon: "clock", label: "Waiting to upload", tone: "wait" };
    case "network":
      return { icon: "wifi-off", label: "Waiting for signal", tone: "wait" };
    case "daily_limit":
      return { icon: "clock", label: "Daily limit, retrying later", tone: "wait" };
    case "submissions_paused":
      return { icon: "clock", label: "Uploads paused, retrying", tone: "wait" };
    default:
      return { icon: "clock", label: "Upload failed, retrying", tone: "wait" };
  }
}

/** A report's status in words. Confirmed names its visitors, as on the Field reports mockup. */
export function reportStatus(r: Pick<Report, "status" | "confirms" | "queued">): Status {
  if (r.queued) return { icon: "clock", label: "On this phone", tone: "wait" };
  switch (r.status) {
    case "pending":
      return { icon: "hourglass", label: "In review", tone: "wait" };
    case "unconfirmed":
      return { icon: "circle-dashed", label: "Unconfirmed", tone: "neutral" };
    case "disputed":
      return { icon: "alert-triangle", label: "Disputed", tone: "wait" };
    case "collapsed":
      return { icon: "eye-off", label: "Most visitors disagree", tone: "bad" };
    case "confirmed":
      return { icon: "check", label: `Confirmed by ${r.confirms} visitors`, tone: "ok" };
    case "verified":
      return { icon: "shield-check", label: "Verified by SGS", tone: "ok" };
    case "hidden":
      return { icon: "eye-off", label: "Hidden for review", tone: "bad" };
  }
}

/** Icon plus words in a tinted pill, so the state reads without colour. */
export function StatusChip({ status }: { status: Status }) {
  const colors = useColors();
  // weak fill + strong text, the AllTrails status-token pairing.
  const [bg, fg] = {
    ok: [colors.successSubtle, colors.success],
    wait: [colors.warningSubtle, colors.warning],
    bad: [colors.dangerSubtle, colors.danger],
    neutral: [colors.muted, colors.foreground],
  }[status.tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Feather name={status.icon} size={13} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{status.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  text: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
});
