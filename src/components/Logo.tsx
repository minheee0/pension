import { SITE } from "@/lib/site";

/**
 * 기와지붕 마크 (로고 시안 A): 지붕 곡선 + 양 끝 처마 + 기둥 두 개.
 * roofClass / postClass 의 text-* 색을 currentColor 로 받는다.
 */
export function RoofMark({ className = "", roofClass = "text-giwa", postClass = "text-wood" }: {
  className?: string; roofClass?: string; postClass?: string;
}) {
  return (
    <svg viewBox="24 14 202 60" aria-hidden="true" className={className}>
      <g className={roofClass} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
        <path d="M45 52 Q125 18 205 52" />
        <path d="M30 60 Q48 62 58 50 M220 60 Q202 62 192 50" />
      </g>
      <path className={postClass} d="M72 58 L72 70 M178 58 L178 70" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 만복 로고 (지붕 + 이름 [+ 영문]).
 *  - size="sm": 헤더·바닥글용 (영문 생략)
 *  - size="lg": 홈 첫 화면용 (MANBOK HANOK STAY 포함)
 * 글자의 tracking 만큼 왼쪽을 채워(pl) 지붕 가운데에 오게 한다.
 */
export default function Logo({ size = "sm", tone = "dark" }: { size?: "sm" | "lg"; tone?: "dark" | "light" }) {
  const light = tone === "light";
  const roof = light ? "text-hanji" : "text-giwa";
  const post = light ? "text-hanji/70" : "text-wood";
  const name = light ? "text-hanji" : "text-wood";
  const sub = light ? "text-hanji/80" : "text-giwa";

  if (size === "lg") {
    return (
      <span className="inline-flex flex-col items-center">
        <RoofMark className="h-12 w-40 md:h-16 md:w-56" roofClass={roof} postClass={post} />
        <span className={`-mt-1 pl-[0.2em] font-serif text-5xl font-bold tracking-[0.2em] md:text-7xl ${name}`}>{SITE.name}</span>
        <span className={`mt-2 pl-[0.4em] font-serif text-[11px] tracking-[0.4em] md:text-sm ${sub}`}>MANBOK HANOK STAY</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <RoofMark className="h-[15px] w-[52px]" roofClass={roof} postClass={post} />
      <span className={`pl-[0.15em] font-serif text-2xl font-bold tracking-[0.15em] ${name}`}>{SITE.name}</span>
    </span>
  );
}
