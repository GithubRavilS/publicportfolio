import React, { useEffect, useMemo, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { palette, radii, space } from "@/constants/Theme";

const STEPS = [
  { id: "chain", label: "Сканирование блокчейнов", sub: "EVM + Solana маршрутизация" },
  { id: "debank", label: "DeBank — протоколы и займы", sub: "Портфель, health, кривые" },
  { id: "krystal", label: "Krystal — LP-пулы", sub: "Открытые и закрытые позиции" },
  { id: "jupiter", label: "Jupiter — Solana", sub: "Holdings через Ultra API" },
  { id: "merge", label: "Дедупликация и отчёт", sub: "Сборка вкладок и графика" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  running: boolean;
  error: string | null;
  progress: number;
};

export function ScanProgressModal({ visible, onClose, running, error, progress }: Props) {
  const p = useSharedValue(0);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    p.value = withTiming(Math.min(1, Math.max(0, progress)), {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, p]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % STEPS.length);
    }, 2200);
    return () => clearInterval(t);
  }, [running]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${p.value * 100}%`,
  }));

  const activeStep = useMemo(() => STEPS[idx % STEPS.length], [idx]);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Синхронизация портфеля</Text>
          <Text style={styles.stepTitle}>{activeStep.label}</Text>
          <Text style={styles.stepSub}>{activeStep.sub}</Text>
          <View style={styles.track}>
            <Animated.View style={[styles.bar, barStyle]} />
          </View>
          {error ? <Text style={styles.err}>{error}</Text> : null}
          {running ? (
            <View style={styles.row}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.hint}>Официальные API — скорость зависит от лимитов</Text>
            </View>
          ) : null}
          {!running && !error ? (
            <Text style={styles.ok}>Готово</Text>
          ) : null}
          <Pressable style={styles.btn} onPress={onClose} disabled={running}>
            <Text style={[styles.btnText, running && { opacity: 0.4 }]}>Закрыть</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: space.lg,
  },
  sheet: {
    backgroundColor: palette.bgElevated,
    borderRadius: radii.xl,
    padding: space.xl,
    borderWidth: 1,
    borderColor: palette.cardBorder,
  },
  title: {
    color: palette.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: space.md,
  },
  stepTitle: { color: palette.text, fontSize: 17, fontWeight: "600" },
  stepSub: { color: palette.textMuted, fontSize: 14, marginTop: 4, marginBottom: space.lg },
  track: {
    height: 8,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    marginBottom: space.md,
  },
  bar: {
    height: "100%",
    borderRadius: 6,
    backgroundColor: palette.accent,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  hint: { flex: 1, color: palette.textMuted, fontSize: 13 },
  err: { color: palette.danger, marginTop: 8, fontSize: 14 },
  ok: { color: palette.accent, marginTop: 8, fontSize: 15, fontWeight: "600" },
  btn: {
    marginTop: space.lg,
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  btnText: { color: palette.text, fontWeight: "600" },
});
