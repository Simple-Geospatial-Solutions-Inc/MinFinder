import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Polygon,
  Text as SvgText,
} from "react-native-svg";

interface CompassDialProps {
  size?: number;
  heading: number;
  bearing: number;
  color?: string;
  accent?: string;
  background?: string;
}

export function CompassDial({
  size = 280,
  heading,
  bearing,
  color = "#7BB8E0",
  accent = "#4DA3D9",
  background = "#1A2436",
}: CompassDialProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR - 22;

  const dialRotation = -heading;
  const relativeBearing = bearing - heading;

  const labels = [
    { d: 0, t: "0" },
    { d: 45, t: "45" },
    { d: 90, t: "90" },
    { d: 135, t: "135" },
    { d: 180, t: "180" },
    { d: 225, t: "225" },
    { d: 270, t: "270" },
    { d: 315, t: "315" },
  ];
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);

  // Arrow polygon pointing right (toward 0deg before rotation = up). We will rotate by relativeBearing - 90 to point "up".
  const arrowPoints = (() => {
    const len = innerR - 12;
    const w = 18;
    return `0,0 ${len},${w} ${len * 0.55},0 ${len},${-w}`;
  })();

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Outer dial background */}
        <Circle cx={cx} cy={cy} r={outerR} fill={background} stroke={accent} strokeWidth={2} />
        <Circle cx={cx} cy={cy} r={innerR} fill="#0F1722" stroke={accent} strokeWidth={1} />

        {/* Rotating dial */}
        <G rotation={dialRotation} origin={`${cx}, ${cy}`}>
          {ticks.map((deg) => {
            const isMajor = deg % 45 === 0;
            const isMid = deg % 15 === 0;
            const len = isMajor ? 14 : isMid ? 10 : 5;
            const sw = isMajor ? 2 : 1;
            const r1 = outerR - 4;
            const r2 = outerR - 4 - len;
            const rad = ((deg - 90) * Math.PI) / 180;
            const x1 = cx + r1 * Math.cos(rad);
            const y1 = cy + r1 * Math.sin(rad);
            const x2 = cx + r2 * Math.cos(rad);
            const y2 = cy + r2 * Math.sin(rad);
            return (
              <Line
                key={deg}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={sw}
                strokeOpacity={isMajor ? 1 : isMid ? 0.7 : 0.45}
              />
            );
          })}
          {labels.map(({ d, t }) => {
            const r = outerR - 32;
            const rad = ((d - 90) * Math.PI) / 180;
            const x = cx + r * Math.cos(rad);
            const y = cy + r * Math.sin(rad);
            return (
              <SvgText
                key={d}
                x={x}
                y={y}
                fill="#fff"
                fontSize={13}
                fontWeight="600"
                textAnchor="middle"
                alignmentBaseline="middle"
                rotation={d}
                origin={`${x}, ${y}`}
              >
                {t}
              </SvgText>
            );
          })}
        </G>

        {/* Bearing arrow — rotates with relative bearing */}
        <G rotation={relativeBearing - 90} origin={`${cx}, ${cy}`}>
          <Polygon
            points={arrowPoints}
            fill={accent}
            stroke="#fff"
            strokeWidth={1}
            transform={`translate(${cx}, ${cy})`}
          />
        </G>

        {/* Center hub */}
        <Circle cx={cx} cy={cy} r={5} fill="#fff" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
