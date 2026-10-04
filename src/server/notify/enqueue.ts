/**
 * 알림 대기열 등록 (notify). 결제·취소 같은 핵심 흐름을 절대 막지 않도록 모든 오류를 삼키고 로그만 남긴다.
 * 같은 이벤트는 dedupe_key 로 한 번만 만들어진다(재시도·중복 호출에 안전).
 */
import { after } from "next/server";
import type { Pool } from "pg";
import { encryptText } from "@/server/crypto";
import { sendDue } from "./send";
import { render, type Ctx, type Kind } from "./templates";
import type { Audience, Channel } from "./types";

export type NotifyEvent =
  | { type: "booking_confirmed" | "deposit_waiting" | "deposit_expired" | "checkin_reminder" | "review_request"; bookingId: string; scheduledAt?: Date }
  | { type: "booking_cancelled"; bookingId: string; refund?: Ctx["refund"]; notifyOwner?: boolean }
  | { type: "auto_refunded"; bookingId: string; refund?: Ctx["refund"] }
  | { type: "owner_refund_failed"; refundId: number }
  | { type: "owner_test"; channel: Channel };

interface Booking { id: string; booking_no: string; guest_name: string; guest_phone_enc: string; guest_email: string | null; check_in: string; check_out: string; nights: number; guests: number; total_amount: number }

async function loadBooking(db: Pool, id: string): Promise<Booking> {
  const r = await db.query(
    `select id, booking_no, guest_name, guest_phone_enc, guest_email, check_in::text as check_in, check_out::text as check_out, nights, guests, total_amount from bookings where id = $1`, [id]);
  if (!r.rows[0]) throw new Error(`예약을 찾을 수 없습니다: ${id}`);
  return r.rows[0];
}

async function insert(db: Pool, row: { kind: Kind; audience: Audience; channel: Channel; bookingId?: string; recipientEnc?: string | null; dedupe: string; scheduledAt?: Date; ctx: Ctx }) {
  const m = render(row.kind, row.ctx);
  await db.query(
    `insert into notifications (kind, audience, channel, booking_id, recipient_enc, subject, body, dedupe_key, scheduled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now())) on conflict (dedupe_key) do nothing`,
    [row.kind, row.audience, row.channel, row.bookingId ?? null, row.recipientEnc ?? null, m.subject, m.body, row.dedupe, row.scheduledAt ?? null]);
}

const ownerChannels = (): Channel[] => [...(process.env.OWNER_PHONE ? ["sms" as const] : []), ...(process.env.OWNER_EMAIL ? ["email" as const] : [])];

async function guestRows(db: Pool, kind: Kind, b: Booking, ctx: Ctx, scheduledAt?: Date, key = `${kind}:${b.id}`) {
  await insert(db, { kind, audience: "guest", channel: "sms", bookingId: b.id, recipientEnc: b.guest_phone_enc, dedupe: `${key}:sms`, scheduledAt, ctx });
  if (b.guest_email) await insert(db, { kind, audience: "guest", channel: "email", bookingId: b.id, recipientEnc: encryptText(b.guest_email), dedupe: `${key}:email`, scheduledAt, ctx });
}
async function ownerRows(db: Pool, kind: Kind, ctx: Ctx, bookingId: string | undefined, key: string) {
  const ch = ownerChannels();
  if (ch.length === 0) console.warn(`[notify] OWNER_PHONE/OWNER_EMAIL 이 설정되지 않아 사장님 알림(${kind})을 보내지 않습니다`);
  for (const channel of ch) await insert(db, { kind, audience: "owner", channel, bookingId, dedupe: `${key}:${channel}`, ctx });
}

/**
 * 알림을 대기열에 넣은 뒤, 응답을 돌려준 직후(Next.js after) 바로 발송을 시도한다. 결제 확정 문자가 정기 작업을 기다리지 않게 한다.
 *  - 요청 밖(스크립트·테스트)에서는 after 를 쓸 수 없어 건너뛴다 → 정기 작업(/api/cron/run)이 발송한다.
 *  - 즉시 발송이 실패해도 대기열에 남아 정기 작업이 재시도한다.
 */
function dispatchSoon(db: Pool) {
  try {
    after(async () => {
      try { await sendDue(db, { limit: 10 }); }
      catch (e) { console.error("[notify] 즉시 발송 실패 — 정기 작업이 다시 시도합니다", e); }
    });
  } catch { /* 요청 범위 밖 */ }
}

export async function notify(db: Pool, ev: NotifyEvent): Promise<void> {
  await enqueueEvent(db, ev);
  dispatchSoon(db);
}

async function enqueueEvent(db: Pool, ev: NotifyEvent): Promise<void> {
  try {
    if (ev.type === "owner_test") {
      const key = `owner_test:${Date.now()}`;
      await insert(db, { kind: "owner_test", audience: "owner", channel: ev.channel, dedupe: `${key}:${ev.channel}`, ctx: {} });
      return;
    }
    if (ev.type === "owner_refund_failed") {
      const r = (await db.query(
        `select r.id, r.amount, r.booking_id, b.booking_no, b.guest_name from refunds r join bookings b on b.id = r.booking_id where r.id = $1`, [ev.refundId])).rows[0];
      if (!r) return;
      await ownerRows(db, "owner_refund_failed", { bookingNo: r.booking_no, guestName: r.guest_name, refund: { amount: r.amount, deduct: 0, done: false } }, r.booking_id, `owner_refund_failed:${ev.refundId}`);
      return;
    }
    const b = await loadBooking(db, ev.bookingId);
    const base: Ctx = { bookingNo: b.booking_no, guestName: b.guest_name, checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, guests: b.guests, total: b.total_amount };
    switch (ev.type) {
      case "booking_confirmed":
        await guestRows(db, "booking_confirmed", b, base, ev.scheduledAt);
        await ownerRows(db, "owner_new_booking", base, b.id, `owner_new_booking:${b.id}`);
        break;
      case "deposit_waiting": {
        const va = (await db.query(`select virtual_account from payments where booking_id = $1 and status = 'waiting_deposit' order by id desc limit 1`, [b.id])).rows[0]?.virtual_account;
        if (!va) return;
        const { bankName } = await import("@/lib/banks");
        await guestRows(db, "deposit_waiting", b, { ...base, account: { bank: bankName(va.bankCode), number: va.accountNumber, holder: va.holderName, dueDate: va.dueDate } });
        break;
      }
      case "deposit_expired": await guestRows(db, "deposit_expired", b, base); break;
      case "booking_cancelled":
        await guestRows(db, "booking_cancelled", b, { ...base, refund: ev.refund ?? null });
        if (ev.notifyOwner !== false) await ownerRows(db, "owner_cancelled", { ...base, refund: ev.refund ?? null }, b.id, `owner_cancelled:${b.id}`);
        break;
      case "auto_refunded": await guestRows(db, "auto_refunded", b, { ...base, refund: ev.refund ?? null }); break;
      case "checkin_reminder": {
        const guide = (await db.query(`select value from policy_settings where key = 'checkin_guide'`)).rows[0]?.value as string | undefined;
        await guestRows(db, "checkin_reminder", b, { ...base, guide: guide?.trim() || undefined }, ev.scheduledAt);
        break;
      }
      case "review_request": await guestRows(db, "review_request", b, base, ev.scheduledAt); break;
    }
  } catch (e) {
    console.error(`[notify] 알림 등록 실패 (${ev.type}) — 핵심 처리에는 영향 없음`, e);
  }
}
