import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

/** The colour tokens for the device's current light/dark setting. */
export function useColors() {
  return useColorScheme() === "dark" ? colors.dark : colors.light;
}
