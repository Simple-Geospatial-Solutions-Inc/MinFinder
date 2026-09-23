import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MineGlyph } from "@/components/capture/MineGlyph";
import { outboxStatus, StatusChip, TIER_STATUS, type Status } from "@/components/capture/StatusChip";
import { GUTTER, ListRow, ListSection, PillButton, TextButton, type } from "@/components/ui";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { signIn, useSignedIn, type Provider } from "@/lib/auth";
import { formatShortDate } from "@/lib/format";
import {
  discardOutboxItem,
  getMySubmissions,
  getOutbox,
  MINE_TYPES,
  onSyncChange,
  signOutAndForget,
  sync,
  uploadNow,
  type Mine,
  type MineType,
  type OutboxItem,
} from "@/lib/sync";

const TYPE_LABEL = Object.fromEntries(MINE_TYPES) as Record<MineType, string>;

// The server's rejection codes (artifacts/minfinder-api/README.md), in words.
const REJECTED: Record<string, string> = {
  too_close_to_yours: "You already have a mine within 100 m of this one.",
  duplicate: "Another member had already added this mine.",
  photo_reused: "One of the photos was already used for another mine.",
  id_taken: "This capture clashed with another. Add it again.",
  gps_inaccurate: "The GPS fix wasn't accurate enough.",
  outside_bc: "Only mines in British Columbia can be added.",
  pin_too_far: "The pin was more than 50 m from where you stood.",
  captured_in_future: "The capture time was in the future. Check the phone's date and time.",
  capture_too_old: "Captures older than 30 days can't be uploaded.",
  impossible_travel: "Too far from your previous capture for the time between them.",
  not_an_image: "A photo couldn't be read.",
  photos: "The photos couldn't be read.",
  photo_too_large: "A photo was too large.",
};

export default function MySubmissionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const [outbox, setOutbox] = useState<OutboxItem[] | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [signingIn, setSigningIn] = useState<Provider | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const load = useCallback(() => {
    getOutbox().then(setOutbox).catch(() => setOutbox([]));
    getMySubmissions().then(setMine).catch(() => {});
  }, []);
  useEffect(() => onSyncChange(load), [load]);
  useFocusEffect(
    useCallback(() => {
      load();
      void sync();
    }, [load]),
  );

  const onSignIn = async (p: Provider) => {
    setSigningIn(p);
    setSignInError(null);
    try {
      if (await signIn(p)) await uploadNow();
    } catch (e) {
      console.warn("sign-in failed", e);
      setSignInError("Sign-in didn't go through. Check your connection and try again.");
    } finally {
      setSigningIn(null);
    }
  };

  const queued = outbox?.filter((o) => o.state === "queued") ?? [];
  const rejected = outbox?.filter((o) => o.state === "rejected") ?? [];
  const empty = outbox !== null && outbox.length === 0 && mine.length === 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.gold}
          onRefresh={async () => {
            setRefreshing(true);
            await uploadNow();
            setRefreshing(false);
          }}
        />
      }
    >
      {signedIn ? (
        <View style={[styles.accountRow, { borderColor: colors.border }]}>
          <Feather name="user" size={18} color={colors.mutedForeground} />
          <Text style={[type.label, { color: colors.foreground, flex: 1 }]}>Signed in</Text>
          <TextButton label="Sign out" onPress={() => void signOutAndForget()} />
        </View>
      ) : (
        <SignIn busy={signingIn} error={signInError} onSignIn={onSignIn} waiting={queued.length} />
      )}

      {empty ? (
        <EmptyState />
      ) : (
        <View style={styles.btnRow}>
          <PillButton label="Add a mine" icon="plus" onPress={() => router.push("/submit")} />
        </View>
      )}

      {queued.length > 0 && (
        <ListSection
          title="On this phone"
          action={signedIn ? { label: "Upload now", onPress: () => void uploadNow() } : undefined}
        >
          {queued.map((o) => (
            <Row
              key={o.id}
              photo={o.photos[0]}
              type={o.data.type}
              title={o.data.name || TYPE_LABEL[o.data.type]}
              meta={`${TYPE_LABEL[o.data.type]} · ${formatShortDate(o.data.captured_at)}`}
              status={outboxStatus(o, signedIn)}
              reason={o.error === "upload_failed" && o.message ? `Error: ${o.message}` : undefined}
            />
          ))}
        </ListSection>
      )}

      {rejected.length > 0 && (
        <ListSection title="Not accepted">
          {rejected.map((o) => (
            <Row
              key={o.id}
              photo={o.photos[0]}
              type={o.data.type}
              title={o.data.name || TYPE_LABEL[o.data.type]}
              meta={`${TYPE_LABEL[o.data.type]} · ${formatShortDate(o.data.captured_at)}`}
              status={outboxStatus(o, signedIn)}
              reason={REJECTED[o.error ?? ""] ?? (o.message || "The server didn't accept this capture.")}
              onDiscard={() => void discardOutboxItem(o.id)}
            />
          ))}
        </ListSection>
      )}

      {mine.length > 0 && (
        <ListSection title="Uploaded">
          {mine.map((m) => (
            <Row
              key={m.id}
              type={m.type}
              title={m.name || TYPE_LABEL[m.type]}
              meta={`${TYPE_LABEL[m.type]} · ${formatShortDate(m.captured_at)}${
                m.tier !== "pending" && m.tier !== "hidden" ? ` · ${m.net >= 0 ? "+" : "−"}${Math.abs(m.net)} votes` : ""
              }`}
              status={TIER_STATUS[m.tier]}
            />
          ))}
        </ListSection>
      )}

      {!signedIn && mine.length === 0 && !empty && (
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          Sign in to see what you&apos;ve already uploaded.
        </Text>
      )}
    </ScrollView>
  );
}

function SignIn({
  busy,
  error,
  waiting,
  onSignIn,
}: {
  busy: Provider | null;
  error: string | null;
  waiting: number;
  onSignIn: (p: Provider) => void;
}) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  return (
    <View style={[styles.signIn, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
        {waiting > 0 ? `Sign in to upload ${waiting === 1 ? "your mine" : `${waiting} mines`}` : "Sign in to add mines"}
      </Text>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>
        Browsing never needs an account. We keep an anonymous ID from Apple or Google, never your name or email.
      </Text>
      {Platform.OS === "ios" && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            dark
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={24}
          style={styles.providerBtn}
          onPress={() => onSignIn("apple")}
        />
      )}
      <View style={styles.btnRow}>
        <PillButton
          label="Sign in with Google"
          variant="outline"
          busy={busy === "google"}
          disabled={busy !== null && busy !== "google"}
          onPress={() => onSignIn("google")}
        />
      </View>
      {error && (
        <Text style={[type.meta, { color: colors.destructive }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

/** First run: teach the flow, then offer it. */
function EmptyState() {
  const colors = useColors();
  const steps = [
    ["map-pin", "Stand at the working and put the pin on it."],
    ["camera", "Photograph the opening and its surroundings."],
    ["upload-cloud", "Save. It uploads by itself once you have signal."],
  ] as const;
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyGlyph, { backgroundColor: colors.muted }]}>
        <MineGlyph type="adit" size={36} color={colors.foreground} />
      </View>
      <Text style={[type.display, { color: colors.foreground }]}>Found a working that isn&apos;t on the map?</Text>
      <Text style={[type.label, { color: colors.mutedForeground }]}>
        Add it for other MinFinder users. SGS reviews a new member&apos;s first three submissions.
      </Text>
      <View style={styles.steps}>
        {steps.map(([icon, text]) => (
          <View key={icon} style={styles.stepRow}>
            <Feather name={icon} size={20} color={colors.foreground} />
            <Text style={[type.label, { color: colors.foreground, flex: 1 }]}>{text}</Text>
          </View>
        ))}
      </View>
      <View style={styles.btnRow}>
        <PillButton label="Add a mine" icon="plus" onPress={() => router.push("/submit")} />
      </View>
    </View>
  );
}

function Row({
  photo,
  type: kind,
  title,
  meta,
  status,
  reason,
  onDiscard,
}: {
  photo?: string;
  type: MineType;
  title: string;
  meta: string;
  status: Status;
  reason?: string;
  onDiscard?: () => void;
}) {
  const colors = useColors();
  return (
    <ListRow>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbGlyph, { backgroundColor: colors.muted }]}>
          <MineGlyph type={kind} size={24} color={colors.foreground} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={[type.label, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{meta}</Text>
        <StatusChip status={status} />
        {reason && <Text style={[type.meta, { color: colors.foreground }]}>{reason}</Text>}
        {onDiscard && <TextButton label="Discard" icon="trash-2" tone="destructive" onPress={onDiscard} />}
      </View>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: GUTTER, paddingTop: 16, gap: 24 },
  btnRow: { flexDirection: "row" },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
  },
  signIn: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  providerBtn: { height: 48, borderRadius: 24 },
  empty: { gap: 14, paddingTop: 8 },
  emptyGlyph: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  steps: { gap: 14, paddingVertical: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowText: { flex: 1, gap: 4 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  thumbGlyph: { alignItems: "center", justifyContent: "center" },
});
