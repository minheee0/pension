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
    // 홈 첫 화면 로고 크기 (앞 값 = 폰, md: = 컴퓨터). 지붕은 높이:너비 ≈ 1:3.5 로 함께 바꿀 것
    //  - 처음(가장 큼): 지붕 h-12 w-40 / md:h-16 md:w-56 · 글자 text-5xl / md:text-7xl · 영문 text-[11px] / md:text-sm
    //  - 1차 축소:      지붕 h-8 w-28 / md:h-11 md:w-40  · 글자 text-4xl / md:text-5xl · 영문 text-[10px] / md:text-xs
    //  - 현재(중간):    지붕 h-10 w-36 / md:h-14 md:w-48 · 글자 text-[42px] / md:text-6xl · 영문 text-[11px] / md:text-[13px]
    return (
      <span className="inline-flex flex-col items-center">
        <RoofMark className="h-10 w-36 md:h-14 md:w-48" roofClass={roof} postClass={post} />{/* 지붕 크기 */}
        <span className={`-mt-1 pl-[0.2em] font-serif text-[42px] font-bold tracking-[0.2em] md:text-6xl ${name}`}>{SITE.name}</span>{/* "만복" 글자 크기 */}
        <span className={`mt-2 pl-[0.4em] font-serif text-[11px] tracking-[0.4em] md:text-[13px] ${sub}`}>MANBOK HANOK STAY</span>{/* 영문 크기 */}
      </span>
    );
  }
  // 헤더·바닥글 로고 크기: 지붕 h-[15px] w-[52px] · 글자 text-2xl
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <RoofMark className="h-[15px] w-[52px]" roofClass={roof} postClass={post} />
      <span className={`pl-[0.15em] font-serif text-2xl font-bold tracking-[0.15em] ${name}`}>{SITE.name}</span>
    </span>
  );
}
