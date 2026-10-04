import { SITE } from "@/lib/site";

/** 알림 문구. 문자는 짧고 필요한 정보만, 개인정보는 최소한으로 담는다. */
export type Kind =
  | "booking_confirmed" | "deposit_waiting" | "deposit_expired" | "booking_cancelled" | "auto_refunded"
  | "checkin_reminder" | "review_request"
  | "owner_new_booking" | "owner_cancelled" | "owner_refund_failed" | "owner_test";

export interface Ctx {
  bookingNo?: string; guestName?: string; checkIn?: string; checkOut?: string; nights?: number; guests?: number; total?: number;
  account?: { bank: string; number: string; holder?: string | null; dueDate?: string | null };
  refund?: { amount: number; deduct: number; done: boolean | null; byHost?: boolean } | null;
  guide?: string; refundId?: number; reason?: string;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export const md = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${DOW[x.getUTCDay()]})`; };
export const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const stay = (c: Ctx) => `${md(c.checkIn!)}~${md(c.checkOut!)} ${c.nights}박${c.guests ? ` · ${c.guests}명` : ""}`;
const dueText = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso.includes("+") || iso.endsWith("Z") ? iso : `${iso}+09:00`);
  return isNaN(+d) ? iso : d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const tail = () => `문의 ${SITE.phone}`;

export function render(kind: Kind, c: Ctx): { subject: string; body: string } {
  const tag = `[${SITE.name}]`;
  switch (kind) {
    case "booking_confirmed":
      return { subject: `${tag} 예약이 확정되었습니다 (${c.bookingNo})`, body: [
        `${tag} ${c.guestName}님, 예약이 확정되었습니다.`, `예약번호 ${c.bookingNo}`, stay(c), `결제금액 ${won(c.total!)}`,
        `체크인 ${SITE.checkIn} / 체크아웃 ${SITE.checkOut}`, `조회·취소: ${siteUrl()}/lookup`, tail()].join("\n") };
    case "deposit_waiting":
      return { subject: `${tag} 가상계좌 입금 안내 (${c.bookingNo})`, body: [
        `${tag} ${c.guestName}님, 아래 계좌로 입금해 주세요. 입금이 확인되면 예약이 확정됩니다.`,
        `${c.account!.bank} ${c.account!.number}${c.account!.holder ? ` (${c.account!.holder})` : ""}`,
        `입금액 ${won(c.total!)}${c.account!.dueDate ? ` / 기한 ${dueText(c.account!.dueDate)}까지` : ""}`,
        `예약번호 ${c.bookingNo} · ${stay(c)}`, `기한이 지나면 예약이 자동 취소됩니다.`, tail()].join("\n") };
    case "deposit_expired":
      return { subject: `${tag} 입금 기한이 지나 예약이 취소되었습니다 (${c.bookingNo})`, body: [
        `${tag} ${c.guestName}님, 입금 기한이 지나 예약이 자동 취소되었습니다.`, `예약번호 ${c.bookingNo} · ${stay(c)}`,
        `이미 입금하셨다면 아래로 연락 주세요.`, tail()].join("\n") };
    case "booking_cancelled": {
      const r = c.refund;
      const refundLine = !r ? "결제 전(입금 전) 예약이라 환불할 금액이 없습니다."
        : r.done ? `환불 ${won(r.amount)}${r.deduct ? ` (취소 수수료 ${won(r.deduct)} 공제)` : ""} — 카드사·은행에 따라 반영에 며칠 걸릴 수 있습니다.`
        : `환불 ${won(r.amount)}을 처리 중입니다. 완료되면 반영되며, 지연되면 연락드립니다.`;
      return { subject: `${tag} 예약이 취소되었습니다 (${c.bookingNo})`, body: [
        `${tag} ${c.guestName}님, 예약이 취소되었습니다.${r?.byHost ? " (사업자 사정으로 전액 환불)" : ""}`, `예약번호 ${c.bookingNo} · ${stay(c)}`, refundLine, tail()].join("\n") };
    }
    case "auto_refunded":
      return { subject: `${tag} 결제가 자동 취소되었습니다 (${c.bookingNo})`, body: [
        `${tag} ${c.guestName}님, 결제하시는 사이 선택하신 날짜의 예약을 완료하지 못해 결제가 자동 취소(전액 환불)되었습니다.`,
        `환불 ${won(c.total!)} — ${c.refund?.done === false ? "처리 중이며 완료되면 반영됩니다." : "카드사에 따라 반영에 며칠 걸릴 수 있습니다."}`,
        `불편을 드려 죄송합니다. 다른 날짜로 다시 예약해 주세요: ${siteUrl()}/reserve`, tail()].join("\n") };
    case "checkin_reminder":
      return { subject: `${tag} 내일 체크인 안내 (${c.bookingNo})`, body: [
        `${tag} ${c.guestName}님, 내일 뵙겠습니다.`, `예약번호 ${c.bookingNo} · ${stay(c)}`, `체크인 ${SITE.checkIn} 이후 / 체크아웃 ${SITE.checkOut}`,
        `주소: ${SITE.address}`, ...(c.guide ? [c.guide] : []), tail()].join("\n") };
    case "review_request":
      return { subject: `${tag} 머무르신 시간은 어떠셨나요?`, body: [
        `${tag} ${c.guestName}님, 머물러 주셔서 감사합니다.`, `후기를 남겨 주시면 다음 손님께 큰 도움이 됩니다.`,
        `예약번호와 휴대폰 번호로 확인 후 작성: ${siteUrl()}/lookup`, tail()].join("\n") };
    case "owner_new_booking":
      return { subject: `[${SITE.name} 관리] 새 예약 ${c.bookingNo}`, body: `[${SITE.name} 관리] 새 예약\n${c.bookingNo} ${c.guestName}\n${stay(c)}\n${won(c.total!)}\n${siteUrl()}/admin/bookings/${c.bookingNo}` };
    case "owner_cancelled":
      return { subject: `[${SITE.name} 관리] 예약 취소 ${c.bookingNo}`, body: `[${SITE.name} 관리] 예약 취소\n${c.bookingNo} ${c.guestName}\n${stay(c)}\n${c.refund ? `환불 ${won(c.refund.amount)} (${c.refund.done ? "완료" : "처리 중"})` : "환불 없음"}\n${siteUrl()}/admin/bookings/${c.bookingNo}` };
    case "owner_refund_failed":
      return { subject: `[${SITE.name} 관리] ⚠ 환불 실패 — 확인 필요`, body: `[${SITE.name} 관리] ⚠ 환불이 실패했습니다. 확인해 주세요.\n${c.bookingNo ?? ""} ${c.guestName ?? ""}\n${c.refund ? `환불 예정 ${won(c.refund.amount)}\n` : ""}${siteUrl()}/admin/refunds` };
    case "owner_test":
      return { subject: `[${SITE.name} 관리] 알림 테스트`, body: `[${SITE.name} 관리] 알림 발송 테스트입니다. 이 메시지가 보이면 설정이 정상입니다.` };
  }
}
