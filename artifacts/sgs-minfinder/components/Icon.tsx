import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Download,
  DownloadCloud,
  ExternalLink,
  Info,
  Layers,
  Lock,
  Map,
  MapPin,
  Navigation,
  Play,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react-native";

const ICONS = {
  "alert-circle": AlertCircle,
  "alert-triangle": AlertTriangle,
  "chevron-down": ChevronDown,
  download: Download,
  "download-cloud": DownloadCloud,
  "external-link": ExternalLink,
  info: Info,
  layers: Layers,
  lock: Lock,
  map: Map,
  "map-pin": MapPin,
  navigation: Navigation,
  play: Play,
  plus: Plus,
  search: Search,
  settings: Settings,
  "trash-2": Trash2,
  x: X,
} satisfies Record<string, LucideIcon>;

export type FeatherIconName = keyof typeof ICONS;

export type FeatherProps = {
  name: FeatherIconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Drop-in replacement for `@expo/vector-icons` `Feather`, rendered as SVG via
 * `lucide-react-native`. Lucide is the actively maintained fork of the Feather
 * icon set, so the icon names and visual style are identical.
 *
 * Why: Expo Go on Android (SDK 53/54, Fabric/New Architecture) has a known
 * Text fontFamily registration bug that causes icon glyphs to render as tofu
 * boxes even when the icon font is loaded. SVG icons bypass the native font
 * system entirely and render correctly on every platform.
 */
export function Feather({ name, size = 24, color = "black", style }: FeatherProps) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  const icon = <Cmp size={size} color={color} />;
  if (!style) return icon;
  // `style` goes on a wrapper View, never on the icon itself: lucide spreads any
  // prop it doesn't recognise (including `style`) onto every child SVG element,
  // and react-native-svg reads `style.transform` there as an *SVG* transform,
  // which rotates about the viewBox origin instead of the icon's centre. A
  // `rotate: "180deg"` pushes the path outside the 24x24 viewBox and it stops
  // rendering entirely. On a View it stays a normal RN view transform.
  // (Same reason CompassDial rotates a View around its SvgXml.)
  return <View style={style}>{icon}</View>;
}

Feather.font = {} as Record<string, never>;
