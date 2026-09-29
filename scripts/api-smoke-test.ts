/**
 * API 스모크 테스트: 라우트 핸들러를 직접 호출한다(서버를 띄울 필요 없음).
 * 테스트 DB 전용(테이블을 비운다).
 *   npm run test:api
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { GET as quoteGET } from "../src/app/api/quote/route";
import { GET as calendarGET } from "../src/app/api/calendar/route";
import { POST as holdsPOST } from "../src/app/api/holds/route";
import { decryptText } from "../src/server/crypto";

if (process.env.ALLOW_TRUNCATE !== "1") {
  console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요.");
  process.exit(1);
}

const addDays = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
let ipSeq = 0;
const url = (p: string) => `http://localhost${p}`;
const postHold = (body: unknown, extra: Record<string, string> = {}) =>
  holdsPOST(new Request(url("/api/holds"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipSeq}`, ...extra },
    body: JSON.stringify(body),
  }));

async function main() {
  await pool.query("truncate bookings, stay_dates cascade");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const { rows } = await pool.query<{ d: string }>(
    `select ((now() at time zone 'Asia/Seoul')::date + 40)::text as d`,
  );
  const d0 = rows[0].d;
  const d2 = addDays(d0, 2);

  const validBody = {
    checkIn: d0, checkOut: d2, guests: 5,
    guest: { name: "홍길동", phone: "010-1234-5678" },
    agreedTerms: true,
  };

  // 1) 견적
  let res: Response = await quoteGET(new Request(url(`/api/quote?checkIn=${d0}&checkOut=${d2}&guests=5`)));
  let json: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.available, true);
  assert.equal(json.quote.nightsCount, 2);
  assert.equal(json.quote.extraGuestFee, 10000, "5명 → 추가 1명 × 1만원(1회)");
  assert.equal(json.quote.totalAmount, json.quote.roomTotal + 10000);
  console.log("1 통과: 견적 계산", json.quote.totalAmount.toLocaleString(), "원");

  // 2) 잘못된 입력
  res = await quoteGET(new Request(url(`/api/quote?checkIn=${d0}&checkOut=${d0}&guests=4`)));
  assert.equal(res.status, 400);
  res = await quoteGET(new Request(url(`/api/quote?checkIn=${d0}&checkOut=${d2}&guests=7`)));
  assert.equal(res.status, 400, "최대 인원 초과");
  res = await quoteGET(new Request(url(`/api/quote?checkIn=2020-01-01&checkOut=2020-01-02&guests=2`)));
  assert.equal(res.status, 400, "지난 날짜");
  console.log("2 통과: 잘못된 입력 400");

  // 3) 달력
  const month = d0.slice(0, 7);
  res = await calendarGET(new Request(url(`/api/calendar?month=${month}`)));
  json = await res.json();
  assert.equal(res.status, 200);
  const day = json.days.find((x: any) => x.date === d0);
  assert.equal(day.available, true);
  assert.ok(day.price > 0);
  res = await calendarGET(new Request(url(`/api/calendar?month=2026-13`)));
  assert.equal(res.status, 400);
  console.log("3 통과: 달력", json.days.length, "일");

  // 4) 점유 성공 + 개인정보 암호화 저장
  res = await postHold(validBody);
  json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.match(json.bookingNo, /^H[0-9A-Z]{10}$/);
  assert.equal(json.bookingId, undefined, "내부 UUID 노출 금지");
  const row = (await pool.query(
    `select guest_phone_enc, guest_phone_hash, guest_phone_last4, status from bookings where booking_no = $1`,
    [json.bookingNo],
  )).rows[0];
  assert.equal(row.status, "held");
  assert.ok(!row.guest_phone_enc.includes("01012345678"), "전화번호가 평문으로 저장됨");
  assert.equal(decryptText(row.guest_phone_enc), "01012345678");
  assert.equal(row.guest_phone_last4, "5678");
  console.log("4 통과: 점유 201, 전화번호 암호화 저장·복호화 확인");

  // 5) 달력에 반영 + 같은 날짜 재시도는 409
  res = await calendarGET(new Request(url(`/api/calendar?month=${month}`)));
  json = await res.json();
  assert.equal(json.days.find((x: any) => x.date === d0).available, false);
  res = await postHold({ ...validBody, guest: { name: "김철수", phone: "01099998888" } });
  assert.equal(res.status, 409);
  res = await quoteGET(new Request(url(`/api/quote?checkIn=${d0}&checkOut=${d2}&guests=4`)));
  assert.equal((await res.json()).available, false);
  console.log("5 통과: 점유 후 달력·견적에 반영, 중복 예약 409");

  // 6) 검증 실패들
  const other = { checkIn: addDays(d0, 10), checkOut: addDays(d0, 11), guests: 2 };
  res = await postHold({ ...other, guest: { name: "이영희", phone: "123" }, agreedTerms: true });
  assert.equal(res.status, 400, "잘못된 전화번호");
  res = await postHold({ ...other, guest: { name: "이영희", phone: "01011112222" }, agreedTerms: false });
  assert.equal(res.status, 400, "약관 미동의");
  res = await postHold({ ...other, guest: { name: "이영희", phone: "01011112222" }, agreedTerms: true, expectedTotal: 1 });
  assert.equal(res.status, 409, "금액 불일치");
  res = await holdsPOST(new Request(url("/api/holds"), { method: "POST", body: "x", headers: { "content-type": "text/plain" } }));
  assert.equal(res.status, 415);
  console.log("6 통과: 전화번호·동의·금액 불일치·Content-Type 검증");

  // 7) 같은 전화번호로 동시 점유 2건 제한
  const phoneBody = (i: number) => ({
    checkIn: addDays(d0, 20 + i * 2), checkOut: addDays(d0, 21 + i * 2), guests: 2,
    guest: { name: "박점유", phone: "01055556666" }, agreedTerms: true,
  });
  assert.equal((await postHold(phoneBody(0))).status, 201);
  assert.equal((await postHold(phoneBody(1))).status, 201);
  res = await postHold(phoneBody(2));
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, "TOO_MANY_HOLDS");
  console.log("7 통과: 전화번호당 동시 점유 2건 제한");

  // 8) IP 요청 제한
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const r = await holdsPOST(new Request(url("/api/holds"), {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: "{}",
    }));
    if (r.status === 429) limited++;
  }
  assert.ok(limited >= 2, "동일 IP 과다 요청은 429");
  console.log("8 통과: IP 요청 제한");

  console.log("\n전체 통과");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
