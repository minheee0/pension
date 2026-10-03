/** 별점 표시 (서버·클라이언트 공용) */
export default function Stars({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return <span role="img" aria-label={`5점 만점에 ${value}점`} className={`tracking-tight text-amber-600 ${className}`}>{"★".repeat(v)}<span className="text-line">{"★".repeat(5 - v)}</span></span>;
}
