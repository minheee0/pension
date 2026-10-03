/** 관리자 화면의 입금 확인(토스 동기화) 테스트. 테스트 DB 전용.   npm run test:sync */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { encryptText, hmacHex } from "../src/server/crypto";
import { syncWaitingDeposits } from "../src/server/admin/sync";
import { createTossClient } from "../src/server/payments/toss";
import { POST as preparePOST } from "../src/app/api/payments/prepare/route";
import { POST as confirmPOST } from "../src/app/api/payments/confirm/route";
import { startMockToss } from "./mock-toss";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ip = 0;
const post = (h: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  h(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.8.0.${++ip}` }, body: JSON.stringify(body) }));
const q = async (sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows;

let mockRef: Awaited<ReturnType<typeof startMockToss>> | undefined;
async function main() {
  const mock = await startMockToss("test_sk_mock");
  mockRef = mock;
  Object.assign(process.env, { TOSS_API_BASE: mock.url, TOSS_SECRET_KEY: "test_sk_mock", TOSS_CLIENT_KEY: "test_ck_mock" });
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs restart identity cascade");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;

  async function pendingAccount(offset: number) {
    const h = await holdStay(pool, { checkIn: addDays(today, offset), checkOut: addDays(today, offset + 1), guests: 2,
      guest: { name: "입금테스트", phoneEnc: encryptText("01012345678"), phoneHash: hmacHex("01012345678"), phoneLast4: "5678" }, agreedTerms: true });
    const p = await (await post(preparePOST, "/api/payments/prepare", { bookingNo: h.bookingNo, method: "VIRTUAL_ACCOUNT" })).json() as any;
    const key = mock.createSession(p.orderId, p.amount, { method: "VIRTUAL_ACCOUNT" });
    await post(confirmPOST, "/api/payments/confirm", { paymentKey: key, orderId: p.orderId, amount: p.amount });
    return { ...h, key };
  }
  const status = async (no: string) => (await q(`select status from bookings where booking_no = $1`, [no]))[0].status as string;
  const admin = { id: 1, email: "o@x.co", name: "사장님", role: "owner" as const };
  await pool.query(`insert into admin_users (email, password_hash, name, role) values ('o@x.co', 'x', '사장님', 'owner')`);

  const A = await pendingAccount(20), B = await pendingAccount(22), C = await pendingAccount(24);
  assert.equal(await status(A.bookingNo), "pending_payment");

  // 1. 아무도 입금하지 않았으면 변화 없음
  assert.deepEqual(await syncWaitingDeposits(pool, admin), { checked: 3, changed: 0, errors: 0 });
  assert.equal(await status(A.bookingNo), "pending_payment");

  // 2. 입금됐는데 웹훅이 없다 → 관리자 화면을 열면 반영 (한 건만 지정해도, 전체도)
  mock.deposit(A.key);
  assert.deepEqual(await syncWaitingDeposits(pool, admin, { bookingNo: A.bookingNo.toLowerCase() }), { checked: 1, changed: 1, errors: 0 });
  assert.equal(await status(A.bookingNo), "confirmed");
  assert.equal(await status(B.bookingNo), "pending_payment", "지정하지 않은 예약은 그대로");
  mock.deposit(B.key);
  assert.deepEqual(await syncWaitingDeposits(pool, admin), { checked: 2, changed: 1, errors: 0 });
  assert.equal(await status(B.bookingNo), "confirmed");
  assert.equal((await q(`select count(*)::int as n from cash_receipts`))[0].n, 2, "현금영수증 기록도 함께 생성");
  assert.deepEqual(await syncWaitingDeposits(pool, admin), { checked: 1, changed: 0, errors: 0 }, "이미 처리된 건은 다시 바뀌지 않음");
  assert.equal((await q(`select count(*)::int as n from audit_logs where action = 'payment.sync'`))[0].n, 2);

  // 3. 토스 기한 만료 → 닫히고 날짜가 풀린다
  mock.setStatus(C.key, "EXPIRED");
  assert.deepEqual(await syncWaitingDeposits(pool, admin), { checked: 1, changed: 1, errors: 0 });
  assert.equal(await status(C.bookingNo), "cancelled");

  // 4. 토스에 연결할 수 없어도 화면은 열린다 (오류만 세고 예외를 던지지 않음)
  const D = await pendingAccount(26);
  mock.deposit(D.key);
  const dead = createTossClient({ baseUrl: "http://127.0.0.1:1", secretKey: "x", timeoutMs: 500 });
  const warn = console.warn; console.warn = () => {};
  const r = await syncWaitingDeposits(pool, admin, {}, dead);
  console.warn = warn;
  assert.deepEqual(r, { checked: 1, changed: 0, errors: 1 });
  assert.equal(await status(D.bookingNo), "pending_payment", "연결 실패 시 저장된 상태 유지");
  assert.equal((await syncWaitingDeposits(pool, admin)).changed, 1, "연결이 돌아오면 반영");
  assert.equal(await status(D.bookingNo), "confirmed");

  // 5. 토스 키가 없는 환경에서도 예외 없이 지나간다
  const E = await pendingAccount(28);
  const saved = process.env.TOSS_SECRET_KEY; delete process.env.TOSS_SECRET_KEY;
  assert.deepEqual(await syncWaitingDeposits(pool, admin), { checked: 1, changed: 0, errors: 1 });
  process.env.TOSS_SECRET_KEY = saved;
  assert.equal(await status(E.bookingNo), "pending_payment");
  console.log("통과: 입금 확인 — 변화 없음/웹훅 없이 반영(단건·전체)/중복 안전/기한 만료 정리/토스 장애·키 없음에도 화면 유지");
  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users restart identity cascade").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await mockRef?.close(); await cleanup(); await pool.end(); });
