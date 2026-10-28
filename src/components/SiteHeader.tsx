import Link from "next/link";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/about", label: "소개" },
  { href: "/stay", label: "독채 안내" },
  { href: "/guide", label: "이용안내" },
  { href: "/reviews", label: "후기" },
  { href: "/lookup", label: "예약 조회" },
];

// 데스크톱: 로고 | 메뉴 + 예약하기 한 줄. 모바일: 1줄 로고 + 예약하기, 2줄 메뉴(가로 스크롤)
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-hanji/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <Link href="/" className="whitespace-nowrap font-serif text-2xl font-bold text-wood">{SITE.name}</Link>
        <div className="flex items-center gap-6 text-sm">
          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap hover:text-wood">{n.label}</Link>
            ))}
          </nav>
          <Link href="/reserve" className="whitespace-nowrap rounded bg-wood px-4 py-2 text-hanji hover:bg-giwa">예약하기</Link>
        </div>
      </div>
      <nav className="flex gap-5 overflow-x-auto whitespace-nowrap px-5 pb-2.5 text-sm md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="shrink-0 hover:text-wood">{n.label}</Link>
        ))}
      </nav>
    </header>
  );
}
