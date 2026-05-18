import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { VipAuthGate } from "@/components/VipAuthGate";

export const metadata: Metadata = {
  title: "VIP Public Portfolio",
  description: "Публичная платформа портфеля с автосбором и аналитикой"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="container">
          <header className="site-header">
            <div>
              <div className="brand">VIP Public Portfolio</div>
              <div className="brand-sub">Публичный трекер капитала и позиций</div>
            </div>
            <nav className="tabs">
              <Link href="/" className="tab">Дашборд</Link>
              <Link href="/positions" className="tab">Позиции</Link>
              <Link href="/transactions" className="tab">Транзакции</Link>
            </nav>
          </header>
          <VipAuthGate>
            <div className="main-col">{children}</div>
          </VipAuthGate>
        </div>
      </body>
    </html>
  );
}
