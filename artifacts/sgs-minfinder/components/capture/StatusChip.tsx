import React from "react";
import { StyleSheet, Text, View } from "react-native";

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

/** Icon plus words, so the state reads without colour. */
export function StatusChip({ status }: { status: Status }) {
  const colors = useColors();
  const fg =
    status.tone === "ok"
      ? colors.foreground
      : status.tone === "bad"
        ? colors.destructive
        : colors.mutedForeground;
  return (
    <View style={styles.chip}>
      <Feather name={status.icon} size={15} color={status.tone === "ok" ? "#2E8B57" : fg} />
      <Text style={[styles.text, { color: fg }]}>{status.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
