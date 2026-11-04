import { SITE } from "@/lib/site";

/** 기와지붕 처마 곡선. 색은 currentColor 를 따르므로 부모의 text-* 로 바꾼다 */
export function RoofMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 26" aria-hidden="true" className={className}>
      <path d="M5 21 Q13 24 20 15 Q50 -3 80 15 Q87 24 95 21" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 만복 로고 (지붕 + 이름).
 *  - size="sm": 헤더용, 지붕이 이름 위에 작게 얹힌다
 *  - size="lg": 홈 첫 화면용
 */
export default function Logo({ size = "sm", tone = "dark" }: { size?: "sm" | "lg"; tone?: "dark" | "light" }) {
  const roof = tone === "light" ? "text-hanji" : "text-giwa";
  const name = tone === "light" ? "text-hanji" : "text-wood";
  if (size === "lg") {
    return (
      <span className="inline-flex flex-col items-center">
        <RoofMark className={`h-7 w-40 md:h-10 md:w-56 ${roof}`} />
        <span className={`-mt-1 pl-[0.2em] font-serif text-5xl font-bold tracking-[0.2em] md:text-7xl ${name}`}>{SITE.name}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <RoofMark className={`h-[9px] w-[52px] ${roof}`} />
      <span className={`mt-0.5 pl-[0.15em] font-serif text-2xl font-bold tracking-[0.15em] ${name}`}>{SITE.name}</span>
    </span>
  );
}
