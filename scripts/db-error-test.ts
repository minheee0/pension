/** DB 연결 오류 안내 테스트 (DB 불필요).   npm run test:dberror */
import assert from "node:assert/strict";
import dns from "node:dns";

// localhost 가 주소 2개로 풀리는 상황(Windows: ::1 + 127.0.0.1)을 흉내 → 두 곳 모두 연결 거부되면 Node 가 빈 AggregateError 를 만든다
const orig = dns.lookup;
(dns as any).lookup = function (host: string, opts: any, cb: any) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  if ((host === "localhost" || host === "twoaddr.test") && opts?.all) return process.nextTick(cb, null, [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }]);
  return (orig as any).call(dns, host, opts, cb);
};
process.env.DATABASE_URL = "postgres://hanok:pw@localhost:5432/hanok";

async function main() {
  const { pool, explainDbError, DbUnavailableError } = await import("../src/server/db");

  // 0. localhost → 127.0.0.1 (주소가 2개로 풀려 AggregateError 가 생기는 것을 원천 차단)
  const { useIpv4Loopback } = await import("../src/server/db");
  assert.equal(useIpv4Loopback("postgres://hanok:pw@localhost:5432/hanok"), "postgres://hanok:pw@127.0.0.1:5432/hanok");
  assert.equal(useIpv4Loopback("postgresql://u:p@LOCALHOST/db"), "postgresql://u:p@127.0.0.1/db");
  assert.equal(useIpv4Loopback("postgres://localhost:5432/db"), "postgres://127.0.0.1:5432/db");
  assert.equal(useIpv4Loopback("postgres://u:p@localhost.example.com:5432/db"), "postgres://u:p@localhost.example.com:5432/db", "localhost 로 시작하는 다른 호스트는 건드리지 않음");
  assert.equal(useIpv4Loopback("postgres://u:p@db.internal:5432/localhost"), "postgres://u:p@db.internal:5432/localhost", "DB 이름이 localhost 여도 그대로");
  assert.equal(useIpv4Loopback("postgres://u:p@10.0.0.5:5432/db"), "postgres://u:p@10.0.0.5:5432/db");
  assert.equal(useIpv4Loopback(undefined), undefined);

  // 1. 실제 연결 실패 (아무도 듣지 않는 포트)
  await assert.rejects(pool.query("select 1"), (e: any) => {
    assert.ok(e instanceof DbUnavailableError, `일반 오류로 바뀌어야 함: ${e?.constructor?.name}`);
    assert.ok(!(e instanceof AggregateError));
    assert.equal(e.code, "DB_UNAVAILABLE");
    assert.match(e.message, /데이터베이스에 연결할 수 없습니다/);
    assert.match(e.message, /ECONNREFUSED/, "원인 코드가 메시지에 들어감");
    assert.match(e.message, /docker compose up -d/, "해결 방법 안내");
    return true;
  });
  await assert.rejects(pool.connect(), (e: any) => e instanceof DbUnavailableError, "트랜잭션용 pool.connect() 도 같은 안내");
  await pool.end().catch(() => {});
  assert.ok(true);

  // 2. 변환 규칙
  const agg = Object.assign(new AggregateError([Object.assign(new Error("x"), { code: "ECONNREFUSED" }), Object.assign(new Error("y"), { code: "ECONNREFUSED" })], ""), { code: "ECONNREFUSED" });
  assert.equal(agg.message, "", "원래 오류는 message 가 비어 있음");
  assert.match((explainDbError(agg) as Error).message, /\(ECONNREFUSED\)/, "같은 코드는 한 번만 표시");
  assert.match((explainDbError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })) as Error).message, /ETIMEDOUT/);
  assert.match((explainDbError(Object.assign(new Error("the database system is starting up"), { code: "57P03" })) as Error).message, /연결할 수 없습니다/);
  assert.match((explainDbError(Object.assign(new Error("password authentication failed"), { code: "28P01" })) as Error).message, /아이디·비밀번호/);
  assert.match((explainDbError(Object.assign(new Error('database "x" does not exist'), { code: "3D000" })) as Error).message, /DB 이름/);

  // 3. 정상적인 DB 오류는 절대 바꾸지 않는다 (코드가 오류 코드로 직접 판단함)
  for (const code of ["23505", "23P01", "23514", "22P02", "40001", "42P01", "P0001"]) {
    const e = Object.assign(new Error("db error"), { code });
    assert.equal(explainDbError(e), e, `${code} 는 그대로 통과`);
  }
  const plain = new Error("그냥 오류"); assert.equal(explainDbError(plain), plain);
  assert.equal(explainDbError(null), null); assert.equal(explainDbError("문자열"), "문자열");
  const already = new DbUnavailableError("m", "d"); assert.equal(explainDbError(already), already, "이미 변환된 오류는 다시 감싸지 않음");
  delete process.env.DATABASE_URL;
  assert.match((explainDbError(agg) as Error).message, /DATABASE_URL 이 없습니다/, "환경변수 자체가 없으면 그렇게 안내");
  console.log("통과: DB 연결 실패를 원인·해결 방법이 담긴 오류로 변환(AggregateError 제거), 정상 DB 오류(중복 키 등)는 그대로, 트랜잭션 연결도 동일");
  console.log("\n전체 통과");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
