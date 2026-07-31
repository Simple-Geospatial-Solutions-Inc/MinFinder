import React from "react";
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
  SquareDashed,
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
  "square-dashed": SquareDashed,
  "trash-2": Trash2,
  x: X,
} satisfies Record<string, LucideIcon>;

export type FeatherIconName = keyof typeof ICONS;

export type FeatherProps = {
  name: FeatherIconName;
  size?: number;
  color?: string;
  style?: React.ComponentProps<LucideIcon>["style"];
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
  return <Cmp size={size} color={color} style={style} />;
}

Feather.font = {} as Record<string, never>;
