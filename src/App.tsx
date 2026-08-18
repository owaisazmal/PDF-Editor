// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

import { BatchScreen } from '@/features/batch/BatchScreen';
import { ConvertScreen } from '@/features/convert/ConvertScreen';
import { HomeScreen } from '@/features/home/HomeScreen';
import { OptionsScreen } from '@/features/options/OptionsScreen';
import { ThemeProvider, useTheme, colors } from '@/theme';
import type { RootStackParamList } from '@/navigation/types';

// Held until the fonts resolve so the first frame is never rendered in a fallback face.
void SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigation() {
  const theme = useTheme();

  const navTheme: NavTheme = {
    dark: theme.isDark,
    colors: {
      primary: theme.color.accentInk,
      background: theme.color.bgCanvas,
      card: theme.color.bgSurface,
      text: theme.color.textPrimary,
      border: theme.color.borderHairline,
      notification: theme.color.accentFill,
    },
    fonts: {
      regular: { fontFamily: theme.text('body').fontFamily!, fontWeight: '400' },
      medium: { fontFamily: theme.text('body').fontFamily!, fontWeight: '500' },
      bold: { fontFamily: theme.text('h3').fontFamily!, fontWeight: '600' },
      heavy: { fontFamily: theme.text('h1').fontFamily!, fontWeight: '700' },
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.bgCanvas },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Convert" component={ConvertScreen} />
        <Stack.Screen name="Batch" component={BatchScreen} />
        <Stack.Screen name="Options" component={OptionsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export function App() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  // A font that fails to load must not block the app — the system face is an
  // acceptable degradation, an app that never shows a frame is not.
  const ready = fontsLoaded || fontError != null;

  const onLayout = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    // Painted from the raw token rather than the theme, because this renders before
    // the provider mounts. It matches the splash background, so there is no flash.
    return <View style={{ flex: 1, backgroundColor: colors.light.bgCanvas }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayout}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Navigation />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
