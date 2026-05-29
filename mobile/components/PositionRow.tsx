import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Link } from "expo-router";
import { palette, radii, space } from "@/constants/Theme";
import type { AggregatePosition } from "@/lib/types";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function PositionRow({ item }: { item: AggregatePosition }) {
  const [open, setOpen] = useState(false);
  const apy = item.apyPercent;
  const invested = item.investedUsd ?? item.assetUsd;
  const current = item.currentUsd ?? item.netUsd;
  const liq = item.liquidationHint;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={styles.card}>
      <Pressable onPress={toggle} style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pair}>{item.positionName || item.pair || "Позиция"}</Text>
          <Text style={styles.meta}>
            {item.protocolName} · {item.chain || "—"}
          </Text>
          <Text style={styles.sources}>
            {(item.sources || [item.source]).join(" + ")}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.apy}>{fmtPct(apy)}</Text>
          <Text style={styles.apyLabel}>APR / доходность</Text>
        </View>
      </Pressable>
      <View style={styles.statsRow}>
        <View>
          <Text style={styles.statLab}>Инвестировано</Text>
          <Text style={styles.statVal}>{fmtUsd(invested)}</Text>
        </View>
        <View>
          <Text style={styles.statLab}>Текущая стоимость</Text>
          <Text style={styles.statVal}>{fmtUsd(current)}</Text>
        </View>
        <View>
          <Text style={styles.statLab}>Net</Text>
          <Text style={[styles.statVal, { color: palette.accent }]}>{fmtUsd(item.netUsd)}</Text>
        </View>
      </View>
      {liq ? (
        <View style={styles.liqBox}>
          <Text style={styles.liqText}>
            Health × цена: HF {liq.healthFactor.toFixed(3)} · оценка ликвидации ~$
            {liq.liquidationPriceUsd.toFixed(4)}
          </Text>
        </View>
      ) : null}
      {open ? (
        <View style={styles.expand}>
          <Text style={styles.rawHint}>Кратко из агрегатора</Text>
          <Text style={styles.mono} numberOfLines={8}>
            {JSON.stringify(item.raw ?? {}, null, 0).slice(0, 600)}
            {(JSON.stringify(item.raw ?? {}) || "").length > 600 ? "…" : ""}
          </Text>
          <Link
            href={{
              pathname: "/detail",
              params: { data: encodeURIComponent(JSON.stringify(item)) },
            }}
            asChild
          >
            <Pressable style={styles.linkBtn}>
              <Text style={styles.linkTxt}>Полный экран деталей →</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    padding: space.md,
    marginBottom: space.md,
  },
  head: { flexDirection: "row", gap: 12 },
  pair: { color: palette.text, fontSize: 18, fontWeight: "700" },
  meta: { color: palette.textMuted, fontSize: 13, marginTop: 4 },
  sources: { color: palette.purple, fontSize: 11, marginTop: 6 },
  apy: { color: palette.accent, fontSize: 22, fontWeight: "800" },
  apyLabel: { color: palette.textMuted, fontSize: 11, marginTop: 2 },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.cardBorder,
  },
  statLab: { color: palette.textMuted, fontSize: 11 },
  statVal: { color: palette.text, fontSize: 15, fontWeight: "600", marginTop: 4 },
  liqBox: {
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radii.sm,
    backgroundColor: "rgba(255,214,10,0.08)",
  },
  liqText: { color: palette.warning, fontSize: 12 },
  expand: { marginTop: space.md },
  rawHint: { color: palette.textMuted, fontSize: 12, marginBottom: 6 },
  mono: { color: palette.textMuted, fontSize: 10, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  linkBtn: {
    marginTop: space.md,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: palette.accentDim,
  },
  linkTxt: { color: palette.accent, fontWeight: "700" },
});
