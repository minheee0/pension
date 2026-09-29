import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { holdStay, StayError } from "@/server/booking/hold";
import { countActiveHolds } from "@/server/booking/queries";
import { holdBodySchema } from "@/server/booking/schemas";
import { encryptText, hmacHex, normalizeKrMobile } from "@/server/crypto";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ACTIVE_HOLDS_PER_PHONE = 2;

// POST /api/holds  → 날짜를 임시 점유하고 결제로 넘어갈 예약번호를 돌려준다.
// 독채라 "점유 선점"이 곧 영업 방해가 될 수 있어, 요청 제한과 전화번호별 동시 점유 제한을 둔다.
export async function POST(req: Request) {
  try {
    const rl = rateLimit(`hold:${clientIp(req)}`, 10, 10 * 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);

    if (!req.headers.get("content-type")?.includes("application/json")) {
      return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
    }
    const raw = await req.json().catch(() => {
      throw new StayError("INVALID_INPUT", "요청 본문이 올바른 JSON이 아닙니다");
    });
    const body = holdBodySchema.parse(raw);

    const phone = normalizeKrMobile(body.guest.phone);
    if (!phone) throw new StayError("INVALID_INPUT", "휴대폰 번호 형식이 올바르지 않습니다");
    const phoneHash = hmacHex(phone);

    if ((await countActiveHolds(pool, phoneHash)) >= MAX_ACTIVE_HOLDS_PER_PHONE) {
      return jsonError(
        "TOO_MANY_HOLDS",
        "진행 중인 예약이 있습니다. 결제를 마치거나 잠시 후 다시 시도해 주세요.",
        429,
      );
    }

    const result = await holdStay(pool, {
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      guests: body.guests,
      options: body.options,
      guest: {
        name: body.guest.name,
        phoneEnc: encryptText(phone),
        phoneHash,
        phoneLast4: phone.slice(-4),
        email: body.guest.email || undefined,
      },
      memo: body.memo,
      agreedTerms: body.agreedTerms,
      expectedTotal: body.expectedTotal,
    });

    // 내부 UUID(bookingId)는 응답에 싣지 않는다. 클라이언트가 쓰는 식별자는 bookingNo 뿐.
    return NextResponse.json(
      {
        bookingNo: result.bookingNo,
        holdExpiresAt: result.holdExpiresAt,
        payAmount: result.quote.totalAmount,
        quote: result.quote,
      },
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
