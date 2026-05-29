import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { palette, radii } from "@/constants/Theme";

export function GlassCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.wrap, style]}>
      <LinearGradient
        colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.02)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.cardBorder,
    backgroundColor: palette.card,
  },
  inner: {
    padding: 16,
  },
});
