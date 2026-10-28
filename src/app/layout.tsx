import type { Metadata } from "next";
import { Noto_Serif_KR, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ChromeGate from "@/components/ChromeGate";
import DemoBanner from "@/components/DemoBanner";
import { SITE } from "@/lib/site";

const serif = Noto_Serif_KR({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-serif-kr" });
const sans = Noto_Sans_KR({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-sans-kr" });

export const metadata: Metadata = {
  title: { default: `${SITE.name} | 독채 한옥 펜션`, template: `%s | ${SITE.name}` },
  description: SITE.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${serif.variable} ${sans.variable}`}>
      <body className="font-sans antialiased">
        <ChromeGate><DemoBanner /><SiteHeader /></ChromeGate>
        <main>{children}</main>
        <ChromeGate><SiteFooter /></ChromeGate>
      </body>
    </html>
  );
}
