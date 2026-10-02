export const won = (n: number | string) => `${Number(n).toLocaleString("ko-KR")}원`;
export const STATUS_KO: Record<string, string> = {
  held: "결제 대기", pending_payment: "입금 대기", confirmed: "예약 확정", completed: "이용 완료", cancelled: "취소", expired: "만료", no_show: "노쇼",
};
export const PAY_KO: Record<string, string> = {
  ready: "결제 전", waiting_deposit: "입금 대기", paid: "결제 완료", partial_cancelled: "부분 환불", cancelled: "전액 환불·취소", failed: "실패", expired: "만료",
};
export const REFUND_KO: Record<string, string> = { requested: "처리 중", done: "완료", failed: "실패", manual_needed: "확인 필요" };

const TONE: Record<string, string> = {
  confirmed: "bg-green-100 text-green-900", completed: "bg-line text-giwa", pending_payment: "bg-amber-100 text-amber-900", held: "bg-amber-100 text-amber-900",
  cancelled: "bg-red-100 text-red-900", expired: "bg-line text-giwa", no_show: "bg-red-100 text-red-900",
};
export function Badge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${TONE[status] ?? "bg-line text-giwa"}`}>{STATUS_KO[status] ?? status}</span>;
}
export function Banner({ children, tone = "ok" }: { children: React.ReactNode; tone?: "ok" | "warn" }) {
  return <p className={`rounded border p-3 text-sm ${tone === "warn" ? "border-red-800/30 bg-red-50 text-red-800" : "border-line bg-white"}`}>{children}</p>;
}
export const inputCls = "mt-1 block w-full rounded border border-line bg-white px-2 py-1.5 text-sm";
export const th = "border-b border-line px-2 py-2 text-left font-medium";
export const td = "border-b border-line/60 px-2 py-2";
