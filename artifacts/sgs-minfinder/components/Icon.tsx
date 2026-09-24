import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleX,
  Clock,
  CloudUpload,
  Crosshair,
  Download,
  DownloadCloud,
  ExternalLink,
  EyeOff,
  Flag,
  Gift,
  Hourglass,
  Inbox,
  Info,
  Layers,
  LocateFixed,
  Lock,
  Map,
  MapPin,
  Menu,
  Navigation,
  Play,
  Plus,
  RotateCw,
  Satellite,
  Search,
  Settings,
  ThumbsDown,
  ThumbsUp,
  ShieldCheck,
  Trash2,
  User,
  UserX,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react-native";

const ICONS = {
  "alert-circle": AlertCircle,
  "alert-triangle": AlertTriangle,
  "arrow-left-right": ArrowLeftRight,
  camera: Camera,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-dashed": CircleDashed,
  "circle-x": CircleX,
  clock: Clock,
  crosshair: Crosshair,
  download: Download,
  "download-cloud": DownloadCloud,
  "external-link": ExternalLink,
  "eye-off": EyeOff,
  flag: Flag,
  gift: Gift,
  hourglass: Hourglass,
  inbox: Inbox,
  info: Info,
  layers: Layers,
  "locate-fixed": LocateFixed,
  lock: Lock,
  map: Map,
  "map-pin": MapPin,
  menu: Menu,
  navigation: Navigation,
  play: Play,
  plus: Plus,
  "rotate-cw": RotateCw,
  satellite: Satellite,
  search: Search,
  settings: Settings,
  "shield-check": ShieldCheck,
  "thumbs-down": ThumbsDown,
  "thumbs-up": ThumbsUp,
  "trash-2": Trash2,
  "upload-cloud": CloudUpload,
  user: User,
  "user-x": UserX,
  "wifi-off": WifiOff,
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
