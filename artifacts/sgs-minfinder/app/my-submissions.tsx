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
import { outboxStatus, reportStatus, StatusChip, type Status } from "@/components/capture/StatusChip";
import { EmptyState, GUTTER, ListRow, ListSection, PillButton, radius, TextButton, type } from "@/components/ui";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { signIn, useSignedIn, type Provider } from "@/lib/auth";
import { getNamesByMinfilno } from "@/lib/db";
import { formatShortDate } from "@/lib/format";
import {
  deleteAccount,
  discardOutboxItem,
  getBlocks,
  getMySubmissions,
  getOutbox,
  LABEL_TEXT,
  onSyncChange,
  signOutAndForget,
  sync,
  unblockAll,
  uploadNow,
  type Contribution,
  type Label,
  type OutboxItem,
  type Submission,
} from "@/lib/sync";

/** What a report is, in a word or two: "Adit", "Couldn't find it", "Comment". */
const what = (r: Pick<Submission, "kind"> & { label?: Label | null }) =>
  r.kind === "location" ? LABEL_TEXT[r.label!] : r.kind === "not_found" ? "Couldn't find it" : "Comment";
const when = (d: Submission) => (d.kind === "note" ? null : d.captured_at);

// The server's rejection codes (artifacts/minfinder-api/README.md), in words.
const REJECTED: Record<string, string> = {
  unknown_mine: "That MINFILE number isn't in the published list any more.",
  photo_reused: "One of the photos was already used on another report.",
  id_taken: "This report clashed with another. Add it again.",
  gps_inaccurate: "The GPS fix wasn't accurate enough.",
  outside_bc: "Only mines in British Columbia can be reported.",
  pin_too_far: "The pin was more than 30 m from where you stood.",
  far_unconfirmed: "It's over 300 m from the published location and wasn't confirmed as the same mine.",
  different_mine: "It's over 10 km from the published location, so it's probably a different mine.",
  not_at_published: "You weren't inside your search radius of the published location.",
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
  const [mine, setMine] = useState<Contribution[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
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

  // Every report names its mine; one lookup for the lot.
  const nos = [...new Set([...(outbox ?? []).map((o) => o.data.minfilno), ...mine.map((m) => m.minfilno)])].sort().join(",");
  useEffect(() => {
    void getNamesByMinfilno(nos ? nos.split(",") : []).then(setNames).catch(() => {});
  }, [nos]);
  const nameOf = (no: string) => names.get(no) ?? `MINFILE ${no}`;

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

      {empty && <FirstRun />}

      {queued.length > 0 && (
        <ListSection
          title="On this phone"
          action={signedIn ? { label: "Upload now", onPress: () => void uploadNow() } : undefined}
        >
          {queued.map((o) => (
            <Row
              key={o.id}
              photo={o.photos[0]}
              label={o.data.kind === "location" ? o.data.label : null}
              title={nameOf(o.data.minfilno)}
              meta={`${what(o.data)} · ${formatShortDate(when(o.data) ?? o.created_at)}`}
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
              label={o.data.kind === "location" ? o.data.label : null}
              title={nameOf(o.data.minfilno)}
              meta={`${what(o.data)} · ${formatShortDate(when(o.data) ?? o.created_at)}`}
              status={outboxStatus(o, signedIn)}
              reason={REJECTED[o.error ?? ""] ?? (o.message || "The server didn't accept this report.")}
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
              label={m.label}
              title={nameOf(m.minfilno)}
              meta={`${what(m)} · ${formatShortDate(m.captured_at)}${
                m.kind === "note" ? (m.helpful ? ` · ${m.helpful} found it helpful` : "") : m.disputes ? ` · ${m.disputes} disagree` : ""
              }`}
              status={reportStatus({ ...m, queued: false })}
              reason={m.held_for ? heldReason(m.held_for) : undefined}
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
        {waiting > 0 ? `Sign in to upload ${waiting === 1 ? "your report" : `${waiting} reports`}` : "Sign in to send reports"}
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

/** "Provincial park: GARIBALDI PARK" -> "Inside Garibaldi Park, a provincial park, so SGS checks it first." */
function heldReason(heldFor: string): string {
  const [kind, name = ""] = heldFor.split(": ");
  const title = name.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
  const what = kind.toLowerCase().replace("first nations", "First Nations");
  return `Inside ${title}, ${/^[aeiou]/.test(what) ? "an" : "a"} ${what}, so SGS checks it first.`;
}

/** Blocks and account deletion, which Apple and Google both require in-app. */
function Account({ blocked }: { blocked: number }) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);

  const unblock = () =>
    unblockAll().catch(() => Alert.alert("Couldn't unblock", FAILED));

  const remove = () =>
    Alert.alert(
      "Delete your account?",
      "Your uploaded reports, their photos and your confirmations are deleted from SGS for good. Reports still on this phone stay here.",
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

/** First run: reports start from a mine, so teach where to find the button. */
function FirstRun() {
  const colors = useColors();
  const steps = [
    ["map-pin", "Open a mine on the map and choose Details."],
    ["plus", "On the Reports tab, add what you found or that you couldn't find it. Comments have their own tab."],
    ["upload-cloud", "It saves on the phone and uploads by itself once you have signal."],
  ] as const;
  return (
    <EmptyState
      glyph={<MineGlyph type="adit" size={36} color={colors.foreground} />}
      title="Been to a MINFILE mine?"
      body="Correct its location, say you couldn't find it, or leave a comment for the next visitor. Other visitors confirm what you report."
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
        <PillButton label="Go to the map" icon="map" onPress={() => router.back()} />
      </View>
    </EmptyState>
  );
}

function Row({
  photo,
  label,
  title,
  meta,
  status,
  reason,
  onDiscard,
}: {
  photo?: string;
  /** A located working's label, for the glyph; otherwise a report icon. */
  label: Label | null;
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
          {label ? (
            <MineGlyph type={label} size={24} color={colors.foreground} />
          ) : (
            <Feather name="message-square" size={22} color={colors.foreground} />
          )}
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
  providerBtn: { height: 48, borderRadius: radius.xl },
  steps: { gap: 14, paddingVertical: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowText: { flex: 1, gap: 4 },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  thumbGlyph: { alignItems: "center", justifyContent: "center" },
});
