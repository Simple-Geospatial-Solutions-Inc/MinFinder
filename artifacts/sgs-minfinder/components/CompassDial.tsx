import React from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { COMPASS_ARROW_XML, COMPASS_DISC_XML } from "@/assets/compass/svg";

interface CompassDialProps {
  size?: number;
  heading: number;
  bearing: number;
}

export function CompassDial({ size = 280, heading, bearing }: CompassDialProps) {
  const discRotation = -heading;
  const arrowRotation = bearing - heading;
  const bodyPad = 18;
  const bodySize = size + bodyPad * 2;

  return (
    <View
      style={[
        styles.body,
        { width: bodySize, height: bodySize, padding: bodyPad },
      ]}
    >
      <View style={[styles.wrap, { width: size, height: size }]}>
        <View
          style={[
            styles.layer,
            { width: size, height: size, transform: [{ rotate: `${discRotation}deg` }] },
          ]}
        >
          <SvgXml xml={COMPASS_DISC_XML} width={size} height={size} />
        </View>
        <View
          style={[
            styles.layer,
            { width: size, height: size, transform: [{ rotate: `${arrowRotation}deg` }] },
          ]}
        >
          <SvgXml xml={COMPASS_ARROW_XML} width={size} height={size} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    backgroundColor: "#1A2436",
    borderRadius: 32,
    borderWidth: 4,
    borderColor: "#2A3850",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  layer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});
