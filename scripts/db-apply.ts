/**
 * SQL 파일을 순서대로 DB에 적용한다 (psql 없이 배포용 DB를 처음 세팅할 때 사용).
 *   npm run db:apply:vercel            → .env.vercel 의 DATABASE_URL 에 schema.sql, prices.sql 적용
 *   npx tsx --env-file=<파일> scripts/db-apply.ts <sql파일...>
 * schema.sql 은 테이블을 새로 만드므로 빈 DB에 한 번만 실행한다(이미 있으면 오류로 멈추고 아무것도 바꾸지 않는다).
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

(async () => {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("사용법: tsx scripts/db-apply.ts <sql파일...>");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 이 없습니다 (--env-file 확인)");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // 각 SQL 파일이 자체적으로 begin; … commit; 으로 감싸져 있어 실패하면 그 파일 전체가 취소된다.
    for (const f of files) {
      try {
        await client.query(readFileSync(f, "utf8"));
        console.log(`적용 완료: ${f}`);
      } catch (e) {
        throw new Error(`${f} 적용 실패: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
