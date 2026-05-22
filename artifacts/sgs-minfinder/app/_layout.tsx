import { Feather } from "@expo/vector-icons";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const HEADER_BG = colors.light.navyDeep;
const HEADER_FG = "#F4F1EA";
const HEADER_ACCENT = colors.light.gold;

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: HEADER_BG },
        headerTintColor: HEADER_ACCENT,
        headerTitleStyle: {
          color: HEADER_FG,
          fontFamily: "Inter_700Bold",
        },
        contentStyle: { backgroundColor: colors.light.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="compass"
        options={{ title: "Navigate", headerBackTitle: "Map" }}
      />
      <Stack.Screen
        name="offline"
        options={{ title: "Offline maps", headerBackTitle: "Map" }}
      />
      <Stack.Screen
        name="about"
        options={{ title: "About", headerBackTitle: "Map" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Explicitly bundle the Feather icon font — Expo Go on Android (SDK 53/54)
    // often fails to auto-load @expo/vector-icons fonts, leaving icons as
    // empty/tofu boxes. Including it here forces the splash screen to wait
    // until the icon font is actually registered.
    ...Feather.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <StatusBar style="light" />
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
