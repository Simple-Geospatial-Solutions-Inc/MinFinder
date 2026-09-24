import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
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
import { EmptyState, GUTTER, ListRow, ListSection, PillButton, radius, TextButton, type } from "@/components/ui";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { signIn, useSignedIn, type Provider } from "@/lib/auth";
import { formatShortDate } from "@/lib/format";
import {
  deleteAccount,
  discardOutboxItem,
  getBlocks,
  getMySubmissions,
  getOutbox,
  MINE_TYPES,
  onSyncChange,
  signOutAndForget,
  sync,
  unblockAll,
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
  const [blockedCount, setBlockedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [signingIn, setSigningIn] = useState<Provider | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const load = useCallback(() => {
    getOutbox().then(setOutbox).catch(() => setOutbox([]));
    getMySubmissions().then(setMine).catch(() => {});
    getBlocks().then((b) => setBlockedCount(b.authors)).catch(() => {});
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
        <FirstRun />
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

      {signedIn && <Account blocked={blockedCount} />}
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
      <Text style={[type.meta, { color: colors.mutedForeground }]}>
        By signing in you agree to the Terms of Use: nothing offensive, and no harassing other members. SGS removes
        content and accounts that break them.
      </Text>
      <TextButton
        label="Terms of Use"
        accessibilityRole="link"
        onPress={() => void WebBrowser.openBrowserAsync("https://sgss.ca/mobile-apps/minfinder/terms")}
      />
    </View>
  );
}

const FAILED = "That didn't go through. Check your connection and try again.";

/** Blocks and account deletion, which Apple and Google both require in-app. */
function Account({ blocked }: { blocked: number }) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);

  const unblock = () =>
    unblockAll().catch(() => Alert.alert("Couldn't unblock", FAILED));

  const remove = () =>
    Alert.alert(
      "Delete your account?",
      "Your uploaded mines, their photos and your votes are deleted from SGS for good. Mines still on this phone stay here.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
            } catch {
              Alert.alert("Couldn't delete your account", FAILED);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <ListSection title="Account">
      {blocked > 0 && (
        <ListRow>
          <Text style={[type.label, { flex: 1, color: colors.foreground, alignSelf: "center" }]}>
            {blocked === 1 ? "1 member blocked" : `${blocked} members blocked`}
          </Text>
          <TextButton label="Unblock all" onPress={() => void unblock()} />
        </ListRow>
      )}
      <ListRow onPress={busy ? undefined : remove} accessibilityLabel="Delete account">
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.destructive }]}>{busy ? "Deleting…" : "Delete account"}</Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>Removes everything you've uploaded.</Text>
        </View>
      </ListRow>
    </ListSection>
  );
}

/** First run: teach the flow, then offer it. */
function FirstRun() {
  const colors = useColors();
  const steps = [
    ["map-pin", "Stand at the working and put the pin on it."],
    ["camera", "Photograph the opening and its surroundings."],
    ["upload-cloud", "Save. It uploads by itself once you have signal."],
  ] as const;
  return (
    <EmptyState
      glyph={<MineGlyph type="adit" size={36} color={colors.foreground} />}
      title="Found a working that isn't on the map?"
      body="Add it for other MinFinder users. SGS reviews a new member's first three submissions."
    >
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
    </EmptyState>
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
  signIn: { padding: 16, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  providerBtn: { height: 48, borderRadius: 24 },
  steps: { gap: 14, paddingVertical: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowText: { flex: 1, gap: 4 },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  thumbGlyph: { alignItems: "center", justifyContent: "center" },
});
