// 배포 DB 상태 점검 (값만 출력, 접속 주소·개인정보는 출력하지 않음).  npx tsx --env-file=.env.vercel scripts/db-check.ts
import { Client } from "pg";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string) => (await c.query(s)).rows;
  try {
    console.log("tables:", (await q("select count(*)::int n from information_schema.tables where table_schema='public'"))[0].n);
    console.log("stay_dates:", (await q("select count(*)::int n, min(date)::text a, max(date)::text b from stay_dates"))[0]);
    console.log("base_prices:", await q("select day_type, price from base_prices order by 1"));
    console.log("admins:", (await q("select count(*)::int n from admin_users"))[0].n);
    console.log("bookings:", await q("select status, count(*)::int n from bookings group by 1 order by 1"));
    console.log("payments:", await q("select status, method, count(*)::int n, sum(amount)::int amount from payments group by 1, 2 order by 1"));
    console.log("refunds:", await q("select status, count(*)::int n from refunds group by 1 order by 1"));
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
