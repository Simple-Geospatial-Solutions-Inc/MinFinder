import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";

import { getStatusInfo } from "@/constants/status";

// Single-element SVG marker — Android's native bitmap snapshot captures the
// exact <Svg width/height>, so there are no measurement, padding, or label-
// truncation pitfalls like there are with nested <View> markers.
export const PIN_W_NARROW = 40;
export const PIN_H_NARROW = 40;
export const PIN_W_WIDE = 200;
export const PIN_H_WIDE = 68;
export const PIN_DOT_CX_NARROW = PIN_W_NARROW / 2; // 20
export const PIN_DOT_CY_NARROW = 20;
export const PIN_DOT_CX_WIDE = PIN_W_WIDE / 2; // 100
export const PIN_DOT_CY_WIDE = 18;

export function MarkerPin({
  code,
  selected,
  name,
  showName,
}: {
  code: string | null | undefined;
  selected?: boolean;
  name?: string | null;
  showName?: boolean;
}) {
  const info = getStatusInfo(code);
  const wide = !!(showName && name);
  const W = wide ? PIN_W_WIDE : PIN_W_NARROW;
  const H = wide ? PIN_H_WIDE : PIN_H_NARROW;
  const cx = wide ? PIN_DOT_CX_WIDE : PIN_DOT_CX_NARROW;
  const cy = wide ? PIN_DOT_CY_WIDE : PIN_DOT_CY_NARROW;
  const r = 14;
  const ringR = selected ? r + 3 : r + 1.5;
  const ringColor = selected ? "#FCBA19" : "rgba(255,255,255,0.95)";

  // Trim very long names so the 200-wide bitmap never overflows.
  const displayName =
    wide && name && name.length > 24 ? name.slice(0, 23) + "…" : name || "";

  return (
    <Svg width={W} height={H}>
      {/* Soft halo so the pin reads on busy basemaps */}
      <Circle cx={cx} cy={cy} r={ringR + 3} fill="rgba(0,0,0,0.18)" />
      {/* White/gold outer ring */}
      <Circle cx={cx} cy={cy} r={ringR} fill={ringColor} />
      {/* Coloured status dot */}
      <Circle cx={cx} cy={cy} r={r} fill={info.color} />
      {/* Short status code centred in the dot */}
      <SvgText
        x={cx}
        y={cy + 4}
        fontSize={11}
        fontWeight="bold"
        fill="#fff"
        textAnchor="middle"
      >
        {info.short}
      </SvgText>

      {wide && (
        <>
          <Rect
            x={cx - 90}
            y={H - 22}
            width={180}
            height={18}
            rx={4}
            ry={4}
            fill="rgba(14,36,68,0.92)"
          />
          <SvgText
            x={cx}
            y={H - 9}
            fontSize={11}
            fontWeight="600"
            fill="#F4F1EA"
            textAnchor="middle"
          >
            {displayName}
          </SvgText>
        </>
      )}
    </Svg>
  );
}
