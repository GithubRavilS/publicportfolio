import React, { useMemo } from "react";
import { Text, ScrollView, StyleSheet, Pressable, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { palette, radii, space } from "@/constants/Theme";
import type { AggregatePosition } from "@/lib/types";

export default function DetailModal() {
  const router = useRouter();
  const { data } = useLocalSearchParams<{ data?: string }>();

  const item = useMemo(() => {
    if (!data) return null;
    try {
      return JSON.parse(decodeURIComponent(data)) as AggregatePosition;
    } catch {
      return null;
    }
  }, [data]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
        {!item ? (
          <Text style={styles.err}>Нет данных</Text>
        ) : (
          <>
            <Text style={styles.title}>{item.positionName || item.pair}</Text>
            <Text style={styles.sub}>
              {item.protocolName} · {item.chain}
            </Text>
            <Text style={styles.mono}>{JSON.stringify(item.raw, null, 2)}</Text>
          </>
        )}
        <Pressable style={styles.close} onPress={() => router.back()}>
          <Text style={styles.closeTxt}>Закрыть</Text>
        </Pressable>
      </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: 48 },
  title: { color: palette.text, fontSize: 22, fontWeight: "800" },
  sub: { color: palette.textMuted, marginTop: 6, marginBottom: space.lg },
  mono: {
    color: palette.textMuted,
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  err: { color: palette.danger },
  close: {
    marginTop: space.xl,
    alignSelf: "center",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.cardBorder,
  },
  closeTxt: { color: palette.text, fontWeight: "700" },
});
