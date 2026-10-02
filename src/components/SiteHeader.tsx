import Link from "next/link";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/about", label: "소개" },
  { href: "/stay", label: "독채 안내" },
  { href: "/guide", label: "이용안내" },
  { href: "/lookup", label: "예약 조회" },
];

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-hanji/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <Link href="/" className="font-serif text-2xl font-bold text-wood">{SITE.name}</Link>
        <nav className="flex items-center gap-4 text-sm md:gap-6">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-wood">{n.label}</Link>
          ))}
          <Link href="/reserve" className="rounded bg-wood px-4 py-2 text-hanji hover:bg-giwa">예약하기</Link>
        </nav>
      </div>
    </header>
  );
}
