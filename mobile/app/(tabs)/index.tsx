import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { palette, radii, space } from "@/constants/Theme";
import { GlassCard } from "@/components/GlassCard";
import { ScanProgressModal } from "@/components/ScanProgressModal";
import { useWalletPortfolio } from "@/context/WalletContext";
import { postAggregate } from "@/lib/api";
import { saveSnapshot } from "@/lib/db";

export default function HomeScreen() {
  const router = useRouter();
  const { wallet, setWallet, setLastPayload } = useWalletPortfolio();
  const [modal, setModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prog, setProg] = useState(0);

  const runScan = async () => {
    const w = wallet.trim();
    if (!w) {
      setErr("Введите адрес кошелька");
      return;
    }
    setErr(null);
    setModal(true);
    setRunning(true);
    setProg(0.08);
    const timers = [0.2, 0.45, 0.72, 0.88].map((p, i) =>
      setTimeout(() => setProg(p), 400 + i * 700)
    );
    try {
      const payload = await postAggregate(w);
      setProg(1);
      setLastPayload(payload);
      await saveSnapshot(payload);
      setRunning(false);
      setTimeout(() => {
        setModal(false);
        router.push("/(tabs)/portfolio");
      }, 600);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка запроса");
      setRunning(false);
    } finally {
      timers.forEach(clearTimeout);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LinearGradient colors={["#0b0b12", "#050508"]} style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.brand}>SY Capital</Text>
          <Text style={styles.tag}>Portfolio Tracker</Text>
        </View>

        <GlassCard style={{ marginTop: space.lg }}>
          <Text style={styles.label}>Адрес кошелька</Text>
          <TextInput
            value={wallet}
            onChangeText={setWallet}
            placeholder="0x… (EVM) или Solana base58"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable style={styles.cta} onPress={runScan} disabled={running}>
            <LinearGradient
              colors={["#34d399", "#22c55e"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaGrad}
            >
              <Text style={styles.ctaTxt}>{running ? "Синхронизация…" : "Синхронизировать"}</Text>
            </LinearGradient>
          </Pressable>
          <Text style={styles.note}>
            Данные идут через ваш агрегатор (Node) с официальными API: DeBank, Krystal, Jupiter.
            Укажите URL сервера в «Настройки» для реального устройства.
          </Text>
        </GlassCard>

        <ScanProgressModal
          visible={modal}
          running={running}
          error={err}
          progress={prog}
          onClose={() => {
            if (!running) setModal(false);
          }}
        />
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.lg, paddingTop: 56 },
  header: { marginBottom: space.sm },
  brand: { color: palette.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  tag: { color: palette.textMuted, fontSize: 15, marginTop: 4 },
  label: { color: palette.textMuted, fontSize: 13, marginBottom: 8 },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: palette.text,
    fontSize: 15,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  cta: { marginTop: space.md, borderRadius: radii.lg, overflow: "hidden" },
  ctaGrad: { paddingVertical: 16, alignItems: "center" },
  ctaTxt: { color: "#04120a", fontSize: 17, fontWeight: "800" },
  note: { color: palette.textMuted, fontSize: 12, marginTop: space.md, lineHeight: 18 },
});
