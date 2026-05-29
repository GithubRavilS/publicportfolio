import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import { palette, radii, space } from "@/constants/Theme";
import { getAggregatorBaseUrl, setAggregatorUrlOverride } from "@/lib/api";

export default function SettingsScreen() {
  const [url, setUrl] = useState("");

  useEffect(() => {
    getAggregatorBaseUrl().then(setUrl);
  }, []);

  const save = async () => {
    await setAggregatorUrlOverride(url.trim() || null);
    const u = await getAggregatorBaseUrl();
    setUrl(u);
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.h}>URL агрегатора</Text>
      <Text style={styles.p}>
        iOS Simulator / Android Emulator:{" "}
        <Text style={styles.mono}>http://127.0.0.1:8787</Text>
        {"\n"}
        Реальное устройство: IP вашего Mac в Wi‑Fi, например{" "}
        <Text style={styles.mono}>http://192.168.1.10:8787</Text>
        {"\n"}
        Android emulator к хосту:{" "}
        <Text style={styles.mono}>http://10.0.2.2:8787</Text>
      </Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://api.your-domain.com"
        placeholderTextColor={palette.textMuted}
        style={styles.input}
      />
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnTxt}>Сохранить</Text>
      </Pressable>
      <Text style={styles.h2}>Ключи API</Text>
      <Text style={styles.p}>
        DEBANK_ACCESS_KEY, KRYSTAL_CLOUD_API_KEY, JUPITER_API_KEY задаются в{" "}
        <Text style={styles.mono}>server/.env</Text> на машине, где крутится агрегатор — так ключи
        не попадают в бинарник приложения.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: 80 },
  h: { color: palette.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  h2: { color: palette.text, fontSize: 18, fontWeight: "700", marginTop: space.xl },
  p: { color: palette.textMuted, fontSize: 14, lineHeight: 22, marginBottom: space.md },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: palette.accent },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    padding: 14,
    color: palette.text,
    backgroundColor: palette.card,
  },
  btn: {
    marginTop: space.md,
    alignSelf: "flex-start",
    backgroundColor: palette.accent,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radii.md,
  },
  btnTxt: { color: "#04120a", fontWeight: "800" },
});
