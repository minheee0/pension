/**
 * 손님 화면의 버튼·링크 모양을 한곳에서 정한다. 페이지마다 여백·색이 달라지지 않게 이 함수만 쓴다.
 *  - primary   : 갈색 채운 버튼. 그 화면에서 가장 중요한 행동 하나 (예약하기, 결제하기, 조회하기)
 *  - secondary : 갈색 테두리 버튼. 함께 놓이는 보조 행동 (홈으로, 취소 등)
 *  - textLink  : 갈색 글자 + 옅은 밑줄. 문장 사이 링크나 "자세히 보기 →" 같은 이동
 * 크기: sm(헤더·작은 칸) / md(기본) , full: 칸 너비를 꽉 채움
 */
type Variant = "primary" | "secondary";
type Size = "xs" | "sm" | "md";

const base = "inline-flex items-center justify-center gap-1 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const variants: Record<Variant, string> = {
  primary: "bg-wood text-hanji hover:bg-giwa",
  secondary: "border border-wood text-wood hover:bg-wood/10",
};
const sizes: Record<Size, string> = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3",
};

export function button(variant: Variant = "primary", size: Size = "md", opts: { full?: boolean } = {}): string {
  return `${base} ${variants[variant]} ${sizes[size]}${opts.full ? " w-full" : ""}`;
}

export const textLink = "text-wood underline decoration-wood/40 underline-offset-4 transition-colors hover:decoration-wood";
