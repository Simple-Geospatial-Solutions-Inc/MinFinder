import React from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import type { OutboxItem, Tier } from "@/lib/sync";

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

export const TIER_STATUS: Record<Tier, Status> = {
  pending: { icon: "hourglass", label: "In review", tone: "wait" },
  unverified: { icon: "circle-dashed", label: "Unverified", tone: "neutral" },
  confirmed: { icon: "check", label: "Confirmed", tone: "ok" },
  verified: { icon: "shield-check", label: "Verified by SGS", tone: "ok" },
  hidden: { icon: "eye-off", label: "Hidden for review", tone: "bad" },
};

/** Icon plus words in a tinted pill, so the state reads without colour. */
export function StatusChip({ status }: { status: Status }) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  // weak fill + strong text, the AllTrails status-token pairing.
  const [bg, fg] = {
    ok: dark ? ["#12321F", "#8FD9A8"] : ["#E3F1E7", "#1B6B3A"],
    wait: dark ? ["#3A2C08", "#F2C45A"] : ["#FFF1CC", "#6B4700"],
    bad: dark ? ["#3D1714", "#F08A80"] : ["#FBE4E2", "#8C1D17"],
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
