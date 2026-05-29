import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Dimensions, Pressable } from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { useWalletPortfolio } from "@/context/WalletContext";
import { palette, radii, space } from "@/constants/Theme";
import { PositionRow } from "@/components/PositionRow";
import { loadSnapshotsForChart } from "@/lib/db";
import { useFocusEffect } from "expo-router";

const W = Dimensions.get("window").width - 40;

type TabKey = "liquidity" | "lending" | "other";

export default function PortfolioScreen() {
  const { lastPayload } = useWalletPortfolio();
  const [tab, setTab] = useState<TabKey>("liquidity");
  const [localPts, setLocalPts] = useState<{ t: number; v: number }[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      (async () => {
        if (!lastPayload?.wallet) return;
        const pts = await loadSnapshotsForChart(lastPayload.wallet, 80);
        if (alive) setLocalPts(pts);
      })();
      return () => {
        alive = false;
      };
    }, [lastPayload?.wallet])
  );

  const chartData = useMemo(() => {
    const fromApi = lastPayload?.chart?.points || [];
    const merged: { t: number; v: number }[] = [...fromApi];
    for (const p of localPts) {
      if (!merged.some((m) => Math.abs(m.t - p.t) < 60)) merged.push(p);
    }
    merged.sort((a, b) => a.t - b.t);
    const tail = merged.slice(-40);
    return tail.map((p) => ({
      value: p.v,
      label: "",
      dataPointText: "",
    }));
  }, [lastPayload, localPts]);

  const list =
    lastPayload?.tabs?.[tab] ||
    ([] as NonNullable<typeof lastPayload>["tabs"]["liquidity"]);

  if (!lastPayload) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>Портфель пуст</Text>
        <Text style={styles.emptySub}>
          Введите адрес на вкладке «Главная» и запустите синхронизацию.
        </Text>
      </View>
    );
  }

  const total = lastPayload.totals.combinedUsd;

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Оценка баланса</Text>
        <Text style={styles.heroVal}>
          {total != null ? `$${total.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
        </Text>
        <Text style={styles.heroHint}>
          EVM: DeBank · LP: Krystal · Solana: Jupiter (по ключам на сервере)
        </Text>
      </View>

      {chartData.length >= 2 ? (
        <View style={styles.chartBox}>
          <Text style={styles.chartTitle}>Динамика (DeBank + локальные снимки)</Text>
          <LineChart
            data={chartData}
            width={W}
            height={180}
            curved
            thickness={2}
            color={palette.accent}
            hideDataPoints
            initialSpacing={0}
            endSpacing={8}
            yAxisColor="transparent"
            xAxisColor="rgba(255,255,255,0.08)"
            yAxisTextStyle={{ color: palette.textMuted, fontSize: 10 }}
            rulesColor="rgba(255,255,255,0.06)"
            rulesType="solid"
            yAxisThickness={0}
            xAxisThickness={1}
            noOfSections={4}
            maxValue={
              Math.max(...chartData.map((d) => d.value), 1) * 1.06 || 1
            }
            yAxisOffset={4}
          />
        </View>
      ) : (
        <View style={styles.chartBox}>
          <Text style={styles.chartTitle}>График</Text>
          <Text style={styles.chartFallback}>
            Недостаточно точек кривой. Сделайте несколько синхронизаций — сохраним историю в SQLite
            на устройстве.
          </Text>
        </View>
      )}

      {lastPayload.warnings?.length ? (
        <View style={styles.warn}>
          {lastPayload.warnings.slice(0, 4).map((w, i) => (
            <Text key={i} style={styles.warnTxt}>
              · {w}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            ["liquidity", "Полуликвидность"],
            ["lending", "Лендинг"],
            ["other", "Прочее"],
          ] as const
        ).map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={[styles.tab, tab === k && styles.tabOn]}
          >
            <Text style={[styles.tabTxt, tab === k && styles.tabTxtOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {list.length === 0 ? (
        <Text style={styles.noPos}>Нет позиций в этой группе</Text>
      ) : (
        list.map((item) => <PositionRow key={item.dedupeKey} item={item} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingBottom: 120 },
  emptyWrap: { flex: 1, padding: space.xl, justifyContent: "center" },
  emptyTitle: { color: palette.text, fontSize: 22, fontWeight: "700" },
  emptySub: { color: palette.textMuted, marginTop: 10, fontSize: 15, lineHeight: 22 },
  hero: {
    padding: space.lg,
    borderRadius: radii.xl,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    marginBottom: space.md,
  },
  heroLabel: { color: palette.textMuted, fontSize: 13 },
  heroVal: { color: palette.accent, fontSize: 40, fontWeight: "800", marginTop: 6 },
  heroHint: { color: palette.textMuted, fontSize: 12, marginTop: 10, lineHeight: 18 },
  chartBox: {
    padding: space.md,
    borderRadius: radii.lg,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    marginBottom: space.md,
  },
  chartTitle: { color: palette.text, fontWeight: "700", marginBottom: 8 },
  chartFallback: { color: palette.textMuted, fontSize: 13, lineHeight: 20 },
  warn: {
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,69,58,0.08)",
    marginBottom: space.md,
  },
  warnTxt: { color: palette.danger, fontSize: 12, marginBottom: 4 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: space.md },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
  },
  tabOn: { backgroundColor: palette.accentDim },
  tabTxt: { color: palette.textMuted, fontSize: 13, fontWeight: "600" },
  tabTxtOn: { color: palette.accent },
  noPos: { color: palette.textMuted, textAlign: "center", marginTop: 24 },
});
