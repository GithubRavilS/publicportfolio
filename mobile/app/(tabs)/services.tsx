import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { palette, radii, space } from "@/constants/Theme";

const cards = [
  {
    title: "Обучение DeFi",
    body: "Баллы и модули — скоро. Пока пользуйтесь бесплатным трекером.",
    url: null as string | null,
  },
  {
    title: "DeFi Labs VIP",
    body: "Закрытый поток сигналов и разборов — подключение через ваши каналы.",
    url: null,
  },
  {
    title: "SY Capital",
    body: "Управление капиталом и хедж-продукты — только для квалифицированных инвесторов.",
    url: null,
  },
];

export default function ServicesScreen() {
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.h}>Экосистема</Text>
      <Text style={styles.intro}>
        Трекер остаётся бесплатным. Здесь — мягкие входы в платные сервисы сообщества.
      </Text>
      {cards.map((c) => (
        <View key={c.title} style={styles.card}>
          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.body}>{c.body}</Text>
          {c.url ? (
            <Pressable onPress={() => Linking.openURL(c.url!)} style={styles.link}>
              <Text style={styles.linkTxt}>Узнать больше</Text>
            </Pressable>
          ) : (
            <Text style={styles.soon}>Скоро в приложении</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: 100 },
  h: { color: palette.text, fontSize: 26, fontWeight: "800" },
  intro: { color: palette.textMuted, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: space.lg },
  card: {
    padding: space.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    marginBottom: space.md,
  },
  title: { color: palette.text, fontSize: 18, fontWeight: "700" },
  body: { color: palette.textMuted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  link: { marginTop: 14, alignSelf: "flex-start" },
  linkTxt: { color: palette.blue, fontWeight: "700" },
  soon: { marginTop: 12, color: palette.warning, fontSize: 13, fontWeight: "600" },
});
