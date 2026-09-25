import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

import type { Label } from "@/lib/sync";

// Line glyphs for each kind of working, drawn on lucide's 24-unit grid with the
// same 2px round stroke so they sit beside the app's other icons. Each is the
// working's silhouette as you'd see it from the ground or in section.
const ADIT = ["M2 21h20", "M3 21 9 9l4-4 8 9v7", "M9 21v-6.5a3 3 0 0 1 6 0V21"];
const HEADFRAME = ["M2 21h20", "M7 21 12 7l5 14", "M8.8 16h6.4"];
const PATHS: Record<Label, string[]> = {
  // A timbered portal cut into a hillside.
  adit: ADIT,
  // A headframe over the collar, sheave wheel on top.
  shaft: HEADFRAME,
  portal: ADIT,
  // A straight-walled cut through the overburden.
  trench: ["M2 9h5v9h10V9h5", "M7 13h10"],
  // A dump of waste rock, tipped in layers.
  dump: ["M2 20h20", "M3 20 10 8l3.5 5 2.5-3 5 10", "M7.2 14.5h5", "M5.4 17.5h10"],
  headframe: HEADFRAME,
  // A cabin with its door.
  ruins: ["M3 11 12 4l9 7v10H3z", "M10 21v-6h4v6"],
  // Anything else.
  other: ["M9.2 9a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.6-2.8 2.6", "M12 17h.01"],
};

export function MineGlyph({
  type,
  size = 32,
  color,
}: {
  type: Label;
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {(type === "shaft" || type === "headframe") && <Circle cx={12} cy={5} r={2} stroke={color} strokeWidth={2} />}
      {type === "other" && <Circle cx={12} cy={12} r={9.5} stroke={color} strokeWidth={2} />}
      {PATHS[type].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

/** One line each, for people who don't know the terms. */
export const LABEL_HINTS: Record<Label, string> = {
  adit: "A horizontal tunnel driven into a hillside.",
  shaft: "A vertical or steep opening into the ground.",
  portal: "The timbered or collapsed mouth of a tunnel.",
  trench: "A long, narrow cut dug to expose bedrock.",
  dump: "Piles of waste rock or processed ore.",
  headframe: "The frame over a shaft that carried the hoist.",
  ruins: "A cabin, mill or other building, standing or fallen.",
  other: "Something else. Describe it in the note.",
};
