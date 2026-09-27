import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";

import { MAX_ACCURACY_M, useLiveFix, type LiveFix } from "@/components/capture/gps";
import { MineGlyph } from "@/components/capture/MineGlyph";
import { reportStatus, StatusChip } from "@/components/capture/StatusChip";
import { Feather, type FeatherIconName } from "@/components/Icon";
import { Chip, GUTTER, ListRow, PillButton, radius, TextButton, type } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { API_URL, authHeader, useSignedIn } from "@/lib/auth";
import { bearingDegrees, bearingToCompass, distanceMeters, formatDistance } from "@/lib/geo";
import { toast } from "@/components/Toast";
import {
  blockAuthor,
  deleteMyReport,
  flagReport,
  getMyResponses,
  getReports,
  LABEL_TEXT,
  mineSummary,
  ON_SITE_M,
  onSyncChange,
  REPORT_REASONS,
  respond,
  type MyResponse,
  type Report,
} from "@/lib/sync";

type LatLon = { lat: number; lon: number };
export interface ReportedMine {
  minfilno: string;
  name: string;
  published: LatLon;
}

/** "12 Aug 2026": reports outlive a season, so the year matters. */
const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const month = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

const OFFLINE = "That needs a connection. Try again when you have signal.";

const KIND_WORD = { location: "point", not_found: "search report", note: "comment" } as const;

/** Confirms, then deletes one of the user's own reports. Shared with My reports. */
export function confirmDelete(r: { id: string; kind: keyof typeof KIND_WORD; queued?: boolean }) {
  const word = KIND_WORD[r.kind];
  Alert.alert(
    `Delete this ${word}?`,
    r.queued
      ? "It hasn't uploaded yet, so it's only on this phone."
      : "It's removed from MinFinder for everyone, photos and all. This can't be undone.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void deleteMyReport(r.id)
            .then(() => toast(`${word[0].toUpperCase()}${word.slice(1)} deleted.`))
            .catch(() => Alert.alert("Couldn't delete it", OFFLINE)),
      },
    ],
  );
}

/**
 * Reading never needs an account; anything that adds to a mine does. Without one the app can't
 * tell your own posts from other people's, so it could let you vouch for yourself.
 */
function askSignIn(what: string) {
  Alert.alert(
    `Sign in to ${what}`,
    "Browsing never needs an account. Adding to a mine does, so other members can trust it.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Sign in", onPress: () => router.push("/my-submissions") },
    ],
  );
}

/** One mine's reports from user.db, re-read on every sync. */
export type ReportsState = "loading" | "ready" | "error";

/**
 * One mine's reports from user.db, re-read on every sync. The state keeps "none yet" honest:
 * an empty list only means empty once it has actually been read.
 */
export function useReports(minfilno: string | null | undefined): { reports: Report[]; state: ReportsState } {
  const [got, setGot] = useState<{ reports: Report[]; state: ReportsState }>({ reports: [], state: "loading" });
  useEffect(() => {
    if (!minfilno) return setGot({ reports: [], state: "ready" });
    setGot({ reports: [], state: "loading" });
    const load = () =>
      void getReports(minfilno)
        .then((reports) => setGot({ reports, state: "ready" }))
        .catch((e) => {
          console.warn("field reports", e);
          setGot((g) => ({ ...g, state: "error" }));
        });
    load();
    return onSyncChange(load);
  }, [minfilno]);
  return got;
}

/** The server's Helpful count, with this user's press swapped in before it has uploaded. */
const helpfulCount = (r: Report, mine?: MyResponse) =>
  Math.max(0, r.helpful - (mine?.helpfulSent ? 1 : 0) + (mine?.helpful ? 1 : 0));

/** Someone else's public report: only these take verdicts, Helpful and flags. */
const theirs = (r: Report) => !r.own && !r.queued && r.status !== "pending" && r.status !== "hidden";
const verifiable = (r: Report) => theirs(r) && r.kind !== "note";

/** Whether the user is standing where a verdict on any of these reports would count. */
export const onSiteForAny = (reports: Report[], fix: LiveFix | null, mine: ReportedMine) =>
  reports.some((r) => verifiable(r) && onSite(r, fix, mine));

/** Whether this fix puts the user where a verdict on `r` counts (see LIMITS in rules.ts). */
function onSite(r: Report, fix: LiveFix | null, mine: ReportedMine): boolean {
  if (!fix || fix.accuracy > MAX_ACCURACY_M || Date.now() - fix.time > 120_000) return false;
  if (r.kind === "location") return distanceMeters(fix.lat, fix.lon, r.lat!, r.lon!) <= ON_SITE_M;
  if (r.kind === "not_found")
    return distanceMeters(fix.lat, fix.lon, mine.published.lat, mine.published.lon) <= r.search_radius_m!;
  return false;
}

// Locations first, the best-supported on top; then searches; then notes by Helpful.
const RANK: Record<string, number> = {
  verified: 0,
  confirmed: 1,
  unconfirmed: 2,
  pending: 2,
  disputed: 3,
  collapsed: 4,
  hidden: 5,
};
const KIND_RANK = { location: 0, not_found: 1, note: 2 } as const;
const REORDER = LinearTransition.duration(220);

function order(a: Report, b: Report, mine: Record<string, MyResponse>) {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.kind === "note"
      ? helpfulCount(b, mine[b.id]) - helpfulCount(a, mine[a.id])
      : RANK[a.status] - RANK[b.status] || b.confirms - a.confirms) ||
    b.captured_at - a.captured_at
  );
}

export type ReportSection = "reports" | "comments";
/** Which tab of the mine sheet a report belongs on: on-site evidence, or talk. */
export const sectionOf = (r: Report): ReportSection => (r.kind === "note" ? "comments" : "reports");

/**
 * One tab of a MINFILE mine's sheet. Reports: what visitors found on site and
 * how far others back it up. Comments: notes from anywhere, sorted by Helpful.
 * Verdicts only count from on site, so the GPS is watched only while there's
 * something here to confirm.
 */
export function FieldReports({
  reports: all,
  section,
  ...rest
}: {
  mine: ReportedMine;
  /** Every report on this mine, from useReports; this tab picks out its own. */
  reports: Report[];
  state: ReportsState;
  section: ReportSection;
  isPaid: boolean;
  /** The list scrolls only at the sheet's full height, as the record's does. */
  scrollEnabled: boolean;
  /** Room below the list for the home indicator. */
  bottomInset: number;
  /** Called before navigating away, so the sheet can close. */
  onLeave: () => void;
  onRequestUpgrade: (feature: string) => void;
}) {
  const reports = all.filter((r) => sectionOf(r) === section);
  const props = { ...rest, reports, section };
  return reports.some(verifiable) ? <WithFix {...props} /> : <ReportList {...props} fix={null} />;
}

function WithFix(props: Omit<React.ComponentProps<typeof ReportList>, "fix">) {
  // No buzz on lock here: this runs whenever a mine with reports is open, not just in the field.
  const { fix } = useLiveFix({ haptic: false });
  return <ReportList {...props} fix={fix} />;
}

function ReportList({
  mine,
  reports,
  state,
  section,
  isPaid,
  fix,
  scrollEnabled,
  bottomInset,
  onLeave,
  onRequestUpgrade,
}: {
  mine: ReportedMine;
  reports: Report[];
  state: ReportsState;
  section: ReportSection;
  isPaid: boolean;
  fix: LiveFix | null;
  scrollEnabled: boolean;
  bottomInset: number;
  onLeave: () => void;
  onRequestUpgrade: (feature: string) => void;
}) {
  const colors = useColors();
  const signedIn = useSignedIn();
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mine_, setMine] = useState<Record<string, MyResponse>>({});
  useEffect(() => {
    const load = () => void getMyResponses().then((r) => setMine(r.mine));
    load();
    return onSyncChange(load);
  }, []);

  const summary = mineSummary(reports);
  const sorted = [...reports].sort((a, b) => order(a, b, mine_));
  const shown = sorted.filter((r) => r.status !== "collapsed" || showHidden);
  const collapsed = sorted.length - sorted.filter((r) => r.status !== "collapsed").length;

  const verdict = (r: Report, value: 1 | -1) => {
    if (!signedIn) return askSignIn("confirm reports");
    if (!fix) return;
    const next = mine_[r.id]?.value === value ? 0 : value;
    setMine((m) => ({ ...m, [r.id]: { ...m[r.id], value: next } }));
    void respond(r.id, {
      value: next,
      lat: fix.lat,
      lon: fix.lon,
      accuracy_m: fix.accuracy,
      captured_at: fix.time,
    });
  };
  const helpful = (r: Report) => {
    if (!signedIn) return askSignIn("mark comments helpful");
    const next = !mine_[r.id]?.helpful;
    setMine((m) => ({ ...m, [r.id]: { ...m[r.id], helpful: next } }));
    void respond(r.id, { helpful: next });
  };

  // Waze's "Still there?": the first report here, near enough to check, that
  // this user hasn't answered.
  const prompt = shown.find(
    (r) =>
      verifiable(r) &&
      r.status !== "confirmed" &&
      r.status !== "verified" &&
      onSite(r, fix, mine) &&
      !mine_[r.id]?.value &&
      !dismissed.has(r.id),
  );

  // The sheet stays open under the report screen, so Back lands on this mine again.
  const start = (kind: "location" | "not_found" | "note") => {
    if (!signedIn) return askSignIn(kind === "note" ? "comment" : "add a report");
    router.push({
      pathname: "/submit",
      params: {
        kind,
        minfilno: mine.minfilno,
        name: mine.name,
        lat: String(mine.published.lat),
        lon: String(mine.published.lon),
      },
    });
  };

  const fg = { color: colors.foreground };
  const sub = { color: colors.mutedForeground };

  return (
    <>
      {/* The same quiet row on both tabs, so adding never outshouts what's already
          here; held above the list, so adding is never a scroll away. */}
      <View style={[styles.sectionHead, styles.pinned]}>
        <Text style={[type.meta, state === "error" ? { color: colors.destructive } : sub, { flex: 1 }]}>
          {state === "loading"
            ? "Loading…"
            : state === "error"
              ? "Couldn't read this mine's reports on the phone. Close the mine and open it again."
              : section === "comments"
                ? reports.length
                  ? "Most helpful first"
                  : "No comments yet. Know the access, the roads or the history? Share it, from anywhere."
                : reports.length
                  ? "Checked by visitors on site"
                  : "No reports yet. Been here? Mark what you found, or say you couldn't find it."}
        </Text>
        <PillButton
          label={section === "comments" ? "Comment" : adding ? "Close" : "Report"}
          icon={section === "reports" && adding ? "x" : "plus"}
          variant="secondary"
          grow={false}
          small
          onPress={() =>
            section === "comments" ? start("note") : signedIn ? setAdding((a) => !a) : askSignIn("add a report")
          }
        />
      </View>

      <BottomSheetScrollView
        scrollEnabled={scrollEnabled}
        contentContainerStyle={[styles.section, styles.list, { paddingBottom: bottomInset }]}
      >
      {summary.best && (
        <Banner tone="ok" icon="check" title={`Better location confirmed by ${summary.best.confirms} visitors`}>
          {`The ${LABEL_TEXT[summary.best.label!].toLowerCase()} is ${place(summary.best, mine, isPaid)}. Last visit ${day(summary.best.last_visit_at!)}.`}
        </Banner>
      )}
      {summary.disputed && (
        <Banner tone="wait" icon="wrench" title="Published location disputed">
          {`${summary.searches.length} visitors searched around the published spot and found nothing. Last search ${month(Math.max(...summary.searches.map((s) => s.captured_at)))}.`}
        </Banner>
      )}

      {prompt && (
        <View style={[styles.prompt, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[type.label, fg]}>
            {prompt.kind === "location"
              ? `You're ${Math.round(distanceMeters(fix!.lat, fix!.lon, prompt.lat!, prompt.lon!))} m from ${
                  prompt.label === "adit" ? "an adit" : `a ${LABEL_TEXT[prompt.label!].toLowerCase()}`
                } someone marked. Can you see it?`
              : "You're where someone searched and found nothing. Is anything here?"}
          </Text>
          <Text style={[type.meta, sub]}>Saved now with your GPS fix, and uploaded when you're back in signal.</Text>
          <View style={styles.chips}>
            <PillButton
              label={prompt.kind === "location" ? "Found it here" : "Nothing here"}
              icon="check"
              onPress={() => verdict(prompt, 1)}
            />
            <PillButton
              label={prompt.kind === "location" ? "Not here" : "It's here"}
              icon="x"
              variant="secondary"
              onPress={() => verdict(prompt, -1)}
            />
          </View>
          <TextButton label="Can't say" onPress={() => setDismissed((d) => new Set(d).add(prompt.id))} />
        </View>
      )}

      {section === "reports" && adding && (
        <View style={[styles.menu, { borderColor: colors.border }]}>
          <MenuRow
            icon="map-pin"
            title="I found it"
            hint="Mark the adit, shaft or other workings, on site"
            onPress={() => start("location")}
          />
          <MenuRow
            icon="search-x"
            title="Couldn't find it"
            hint="You searched at the published spot and found nothing"
            onPress={() => start("not_found")}
          />
        </View>
      )}

      {/* A Helpful re-sorts the list at once; items slide to their new place rather than jump. */}
      {shown.map((r) => (
        <Animated.View key={r.id} layout={REORDER}>
          <ReportItem
            r={r}
            mine={mine}
            isPaid={isPaid}
            here={onSite(r, fix, mine)}
            response={mine_[r.id]}
            signedIn={signedIn}
            onVerdict={(v) => verdict(r, v)}
            onHelpful={() => helpful(r)}
            onLeave={onLeave}
            onRequestUpgrade={onRequestUpgrade}
          />
        </Animated.View>
      ))}

      {collapsed > 0 && (
        <View style={[styles.collapsed, { backgroundColor: colors.muted }]}>
          <Feather name={showHidden ? "eye" : "eye-off"} size={16} color={colors.mutedForeground} />
          <Text style={[type.meta, sub, { flex: 1 }]}>
            {collapsed} {section === "comments" ? "comment" : "report"}
            {collapsed === 1 ? "" : "s"} hidden: most visitors disagree
          </Text>
          <TextButton label={showHidden ? "Hide" : "Show"} onPress={() => setShowHidden((s) => !s)} />
        </View>
      )}
      </BottomSheetScrollView>
    </>
  );
}

/** "420m NE of the published spot" for Pro; distance only for free, so the point stays behind the location gate. */
function place(r: Report, mine: ReportedMine, isPaid: boolean): string {
  const d = r.distance_m ?? distanceMeters(r.lat!, r.lon!, mine.published.lat, mine.published.lon);
  const dir = bearingToCompass(bearingDegrees(mine.published.lat, mine.published.lon, r.lat!, r.lon!));
  return isPaid ? `${formatDistance(d)} ${dir} of the published spot` : `${formatDistance(d)} from the published spot`;
}

function ReportItem({
  r,
  mine,
  isPaid,
  here,
  response,
  signedIn,
  onVerdict,
  onHelpful,
  onLeave,
  onRequestUpgrade,
}: {
  r: Report;
  mine: ReportedMine;
  isPaid: boolean;
  /** The user's fix puts them where a verdict on this report counts. */
  here: boolean;
  response?: MyResponse;
  signedIn: boolean;
  onVerdict: (value: 1 | -1) => void;
  onHelpful: () => void;
  onLeave: () => void;
  onRequestUpgrade: (feature: string) => void;
}) {
  const colors = useColors();
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fg = { color: colors.foreground };
  const sub = { color: colors.mutedForeground };

  const title = r.kind === "location" ? `${LABEL_TEXT[r.label!]} · ${place(r, mine, isPaid)}` : "Couldn't find it";
  const meta =
    r.kind === "note"
      ? day(r.captured_at)
      : r.kind === "not_found"
        ? `Searched ${r.search_radius_m} m around · ${day(r.captured_at)}`
        : r.status === "disputed" || r.status === "collapsed"
          ? `${r.confirms} found it · ${r.disputes} didn't · last ${day(r.last_visit_at!)}`
          : r.status === "confirmed" || r.status === "verified"
            ? `last ${day(r.last_visit_at!)}`
            : `Marked on site ${day(r.captured_at)}${r.accuracy_m ? ` · GPS ±${Math.round(r.accuracy_m)} m` : ""}`;

  const flag = async (reason: (typeof REPORT_REASONS)[number][0]) => {
    setError(null);
    try {
      await flagReport(r.id, reason);
      setFlagged(true);
      setFlagging(false);
    } catch {
      setError(OFFLINE);
    }
  };
  const block = () =>
    Alert.alert(
      "Block this member?",
      "You won't see anything they've reported, now or later. You can undo this in My reports.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => void blockAuthor(r.id).catch(() => setError(OFFLINE)),
        },
      ],
    );

  const navigate = () => {
    onLeave();
    router.push({
      pathname: "/compass",
      params: {
        lat: String(r.lat),
        lon: String(r.lon),
        name: `${mine.name} ${LABEL_TEXT[r.label!].toLowerCase()}`,
      },
    });
  };

  return (
    <View style={[styles.item, { borderTopColor: colors.border }]}>
      {/* A comment is already on the Comments tab; a heading saying so is noise. */}
      {r.kind !== "note" && (
        <View style={styles.kind}>
          <View style={[styles.kindIcon, { backgroundColor: colors.muted }]}>
            {r.kind === "location" ? (
              <MineGlyph type={r.label!} size={18} color={colors.foreground} />
            ) : (
              <Feather name="search-x" size={16} color={colors.foreground} />
            )}
          </View>
          <Text style={[type.label, fg, { flex: 1 }]}>{title}</Text>
        </View>
      )}

      {r.kind !== "note" || r.queued || r.status === "pending" ? (
        <View style={styles.statusRow}>
          <StatusChip status={reportStatus(r)} />
          <Text style={[type.meta, sub, styles.shrink]}>{meta}</Text>
        </View>
      ) : (
        <Text style={[type.meta, sub]}>{meta}</Text>
      )}

      {r.kind === "location" &&
        (isPaid ? (
          <View style={styles.statusRow}>
            <Text style={[type.meta, sub, styles.mono]} selectable>
              {r.lat!.toFixed(5)}, {r.lon!.toFixed(5)}
            </Text>
            <TextButton label="Navigate" icon="navigation" onPress={navigate} />
          </View>
        ) : (
          <TextButton
            label="Exact point shown with Pro"
            icon="lock"
            onPress={() => onRequestUpgrade("exact report locations")}
          />
        ))}

      {!!r.text && <Text style={[type.meta, fg]}>{r.text}</Text>}

      {r.photos.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
          {r.photos.map((p, i) => (
            <Image
              key={p}
              source={
                r.queued
                  ? { uri: p }
                  : {
                      uri: `${API_URL}/v1/photos/${p}_t.jpg`,
                      headers: r.status === "pending" ? authHeader() : undefined,
                    }
              }
              style={[styles.photo, { backgroundColor: colors.muted }]}
              accessibilityLabel={`Photo ${i + 1} of ${r.photos.length}`}
            />
          ))}
        </ScrollView>
      )}

      {r.own ? (
        <View style={styles.ownRow}>
          <Text style={[type.meta, sub, styles.shrink]}>
            {r.queued
              ? "Added by you · uploads when you have signal"
              : r.held_for
                ? `Added by you · SGS checks reports in a ${r.held_for.split(":")[0].toLowerCase()} first`
                : "Added by you"}
          </Text>
          <TextButton label="Delete" icon="trash-2" tone="destructive" onPress={() => confirmDelete(r)} />
        </View>
      ) : theirs(r) && r.kind !== "note" ? (
        <View style={{ gap: 6 }}>
          {here ? (
            <View style={styles.chips} accessibilityRole="radiogroup">
              <Chip
                label={r.kind === "location" ? "Found it here" : "Nothing here"}
                role="radio"
                selected={response?.value === 1}
                onPress={() => onVerdict(1)}
                icon={(c) => <Feather name="check" size={16} color={c} />}
              />
              <Chip
                label={r.kind === "location" ? "Not here" : "It's here"}
                role="radio"
                selected={response?.value === -1}
                onPress={() => onVerdict(-1)}
                icon={(c) => <Feather name="x" size={16} color={c} />}
              />
            </View>
          ) : (
            <View style={styles.statusRow}>
              <Feather name="crosshair" size={14} color={colors.mutedForeground} />
              <Text style={[type.meta, sub, styles.shrink]}>
                {response?.value
                  ? `You said ${response.value === 1 ? (r.kind === "location" ? "you found it" : "nothing's there") : r.kind === "location" ? "it's not there" : "it's there"}.`
                  : r.kind === "location"
                    ? `Visit to confirm: within ${ON_SITE_M} m of the point.`
                    : `Visit to confirm: inside the ${r.search_radius_m} m it covered.`}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {theirs(r) &&
        (flagging ? (
          <View style={[styles.menu, { borderColor: colors.border }]}>
            {REPORT_REASONS.map(([reason, text]) => (
              <ListRow key={reason} onPress={() => void flag(reason)} accessibilityLabel={text}>
                <Text style={[type.label, fg, { flex: 1 }]}>{text}</Text>
              </ListRow>
            ))}
            <View style={styles.flagFoot}>
              <TextButton label="Cancel" onPress={() => setFlagging(false)} />
              <TextButton label="Block this member" icon="user-x" tone="destructive" onPress={block} />
            </View>
          </View>
        ) : (
          <View style={styles.ownRow}>
            {flagged ? (
              <Text style={[type.meta, sub, styles.shrink]}>Thanks. SGS will take a look.</Text>
            ) : (
              <TextButton label="Flag" icon="flag" onPress={() => (signedIn ? setFlagging(true) : askSignIn("flag it"))} />
            )}
            {/* Tucked in the corner, just the thumb and its count, so it never competes with the comment. */}
            {r.kind === "note" && (
              <Pressable
                onPress={onHelpful}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!response?.helpful }}
                accessibilityLabel={`Helpful${helpfulCount(r, response) ? `, ${helpfulCount(r, response)}` : ""}`}
                hitSlop={{ left: 12, right: 8 }}
                style={({ pressed }) => [styles.helpful, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Feather name="thumbs-up" size={16} color={response?.helpful ? colors.primary : colors.mutedForeground} />
                {!!helpfulCount(r, response) && (
                  <Text style={[type.meta, { color: response?.helpful ? colors.primary : colors.mutedForeground }]}>
                    {helpfulCount(r, response)}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        ))}
      {error && (
        <Text style={[type.meta, { color: colors.destructive }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: "ok" | "wait";
  icon: FeatherIconName;
  title: string;
  children: string;
}) {
  const colors = useColors();
  const [bg, fg] = tone === "ok" ? [colors.successSubtle, colors.success] : [colors.warningSubtle, colors.warning];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Feather name={icon} size={18} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.label, { color: fg }]}>{title}</Text>
        <Text style={[type.meta, { color: fg }]}>{children}</Text>
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: FeatherIconName;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <ListRow onPress={onPress} accessibilityLabel={title}>
      <Feather name={icon} size={18} color={colors.foreground} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.label, { color: colors.foreground }]}>{title}</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{hint}</Text>
      </View>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  helpful: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, marginLeft: "auto" },
  ownRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  pinned: { paddingHorizontal: GUTTER, paddingTop: 24, paddingBottom: 12 },
  list: { paddingHorizontal: GUTTER },
  banner: {
    flexDirection: "row",
    gap: 10,
    borderRadius: radius.md,
    padding: 12,
  },
  prompt: { borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 10 },
  menu: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  flagFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  item: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  kind: { flexDirection: "row", alignItems: "center", gap: 10 },
  kindIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  shrink: { flexShrink: 1 },
  mono: { fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photos: { gap: 8 },
  photo: { width: 96, height: 72, borderRadius: radius.sm },
  collapsed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    paddingLeft: 12,
    paddingRight: 8,
  },
});
