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

  return (
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
  );
}

const styles = StyleSheet.create({
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
