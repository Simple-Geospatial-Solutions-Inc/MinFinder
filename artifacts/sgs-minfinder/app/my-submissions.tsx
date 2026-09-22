import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
  type OutboxItem,
  type Tier,
} from "@/lib/sync";

const TYPE_LABEL = Object.fromEntries(MINE_TYPES) as Record<string, string>;

const TIER_LABEL: Record<Tier, string> = {
  pending: "In review",
  unverified: "Unverified",
  confirmed: "Confirmed",
  verified: "Verified by SGS",
  hidden: "Hidden pending review",
};

// The server's rejection codes (artifacts/minfinder-api/README.md), in words.
const REJECTED: Record<string, string> = {
  too_close_to_yours: "You already have a mine within 100 m of this one.",
  duplicate: "Another member has already added this mine.",
  photo_reused: "One of the photos was already used for another mine.",
  id_taken: "This capture clashed with another. Take it again.",
  gps_inaccurate: "The GPS fix wasn't accurate enough.",
  outside_bc: "Only mines in British Columbia can be added.",
  pin_too_far: "The pin was too far from where you stood.",
  captured_in_future: "The capture time was in the future. Check the phone's date and time.",
  capture_too_old: "Captures older than 30 days can't be uploaded.",
  impossible_travel: "Too far from your previous capture for the time between them.",
  not_an_image: "A photo couldn't be read.",
  photos: "The photos couldn't be read.",
  photo_too_large: "A photo was too large.",
};

function queuedStatus(item: OutboxItem, signedIn: boolean): string {
  if (!signedIn) return "Sign in to upload";
  switch (item.error) {
    case null:
      return "Waiting to upload";
    case "daily_limit":
      return "Daily limit reached. Will retry.";
    case "submissions_paused":
      return "Uploads are paused by SGS. Will retry.";
    case "network":
      return "Waiting for signal";
    default:
      return "Upload failed. Will retry.";
  }
}

export default function MySubmissionsScreen() {
  const colors = useColors();
  const signedIn = useSignedIn();
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [signingIn, setSigningIn] = useState<Provider | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const load = useCallback(() => {
    getOutbox().then(setOutbox).catch(() => {});
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
      setSignInError("Sign-in didn't work. Check your connection and try again.");
    } finally {
      setSigningIn(null);
    }
  };

  const card = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];
  const queued = outbox.filter((o) => o.state === "queued");
  const rejected = outbox.filter((o) => o.state === "rejected");

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await uploadNow();
            setRefreshing(false);
          }}
        />
      }
    >
      {/* Account */}
      <View style={card}>
        {signedIn ? (
          <View style={styles.row}>
            <Feather name="user" size={18} color={colors.foreground} />
            <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>Signed in</Text>
            <Pressable onPress={() => void signOutAndForget()} hitSlop={8}>
              <Text style={[styles.link, { color: colors.primary }]}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>Sign in to upload and vote</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Browsing never needs an account. We keep only an anonymous id from Apple or Google, not your
              name or email.
            </Text>
            {Platform.OS === "ios" && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={10}
                style={styles.appleBtn}
                onPress={() => void onSignIn("apple")}
              />
            )}
            <Pressable
              onPress={() => void onSignIn("google")}
              disabled={signingIn !== null}
              accessibilityRole="button"
              style={[styles.btn, { borderColor: colors.border, opacity: signingIn ? 0.6 : 1 }]}
            >
              {signingIn ? <ActivityIndicator color={colors.foreground} /> : null}
              <Text style={[styles.btnText, { color: colors.foreground }]}>Sign in with Google</Text>
            </Pressable>
            {signInError && <Text style={[styles.note, { color: colors.destructive }]}>{signInError}</Text>}
          </>
        )}
      </View>

      <Pressable
        onPress={() => router.push("/submit")}
        accessibilityRole="button"
        style={[styles.addBtn, { backgroundColor: colors.primary }]}
      >
        <Feather name="plus" size={18} color={colors.primaryForeground} />
        <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Add a mine</Text>
      </Pressable>

      {/* Waiting to upload */}
      {queued.length > 0 && (
        <>
          <View style={styles.row}>
            <Text style={[styles.section, { color: colors.mutedForeground, flex: 1 }]}>
              WAITING TO UPLOAD ({queued.length})
            </Text>
            {signedIn && (
              <Pressable onPress={() => void uploadNow()} hitSlop={8}>
                <Text style={[styles.link, { color: colors.primary }]}>Upload now</Text>
              </Pressable>
            )}
          </View>
          {queued.map((o) => (
            <OutboxRow key={o.id} item={o} status={queuedStatus(o, signedIn)} />
          ))}
        </>
      )}

      {rejected.length > 0 && (
        <>
          <Text style={[styles.section, { color: colors.mutedForeground }]}>NOT ACCEPTED</Text>
          {rejected.map((o) => (
            <OutboxRow
              key={o.id}
              item={o}
              status={REJECTED[o.error ?? ""] ?? o.message ?? "The server didn't accept this."}
              danger
              onDiscard={() => void discardOutboxItem(o.id)}
            />
          ))}
        </>
      )}

      <Text style={[styles.section, { color: colors.mutedForeground }]}>UPLOADED</Text>
      {mine.length === 0 ? (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          {signedIn ? "Nothing uploaded yet." : "Sign in to see what you've uploaded."}
        </Text>
      ) : (
        mine.map((m) => (
          <View key={m.id} style={card}>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {m.name || TYPE_LABEL[m.type]}
            </Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {TYPE_LABEL[m.type]} · {formatShortDate(m.captured_at)} · {TIER_LABEL[m.tier]}
              {m.tier !== "pending" ? ` · ${m.net >= 0 ? "+" : ""}${m.net}` : ""}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function OutboxRow({
  item,
  status,
  danger,
  onDiscard,
}: {
  item: OutboxItem;
  status: string;
  danger?: boolean;
  onDiscard?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {item.photos[0] && <Image source={{ uri: item.photos[0] }} style={styles.thumb} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { color: colors.foreground }]}>
          {item.data.name || TYPE_LABEL[item.data.type]}
        </Text>
        <Text style={[styles.note, { color: danger ? colors.destructive : colors.mutedForeground }]}>
          {formatShortDate(item.data.captured_at)} · {status}
        </Text>
      </View>
      {onDiscard && (
        <Pressable onPress={onDiscard} hitSlop={8} accessibilityLabel="Discard">
          <Feather name="trash-2" size={18} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 10, paddingBottom: 48 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  body: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  section: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.6, marginTop: 8 },
  appleBtn: { height: 44 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
});
