import { Pool, types } from "pg";

// DATE 컬럼을 JS Date(타임존 오염) 대신 'YYYY-MM-DD' 문자열로 받는다.
types.setTypeParser(1082, (v: string) => v);

/** DB 에 연결하지 못했을 때 던지는 오류. 원인과 해결 방법이 메시지에 들어 있다. (code = "DB_UNAVAILABLE") */
export class DbUnavailableError extends Error {
  code = "DB_UNAVAILABLE";
  constructor(message: string, public detail: string) { super(message); this.name = "DbUnavailableError"; }
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "57P03"]);

/**
 * 연결·접속 문제만 알아보기 쉬운 오류로 바꾼다. 그 외의 DB 오류(중복 키, 제약 위반 등)는 코드가 오류 코드(23505 등)로
 * 직접 판단하므로 절대 바꾸지 않고 그대로 돌려준다.
 *  - localhost 가 IPv6(::1)와 IPv4 두 주소로 풀리면 Node 가 message 가 빈 AggregateError 를 만들어, 로그에서 원인을 알 수 없고
 *    Next.js 개발 서버가 "object null is not iterable" 같은 엉뚱한 오류를 내기도 한다.
 */
export function explainDbError(e: unknown): unknown {
  const err = e as { code?: string; errors?: { code?: string }[]; message?: string } | null;
  if (!err || typeof err !== "object" || err instanceof DbUnavailableError) return e;
  const inner = Array.isArray(err.errors) ? err.errors.map((x) => x?.code).filter((c): c is string => !!c) : [];
  const code = err.code ?? inner[0];
  const detail = [...new Set(inner.length ? inner : code ? [code] : [])].join(", ") || (err.message ?? "");
  const hasUrl = !!process.env.DATABASE_URL;

  if (e instanceof AggregateError || (code && CONNECTION_CODES.has(code))) {
    return new DbUnavailableError(
      `데이터베이스에 연결할 수 없습니다 (${detail || "원인 불명"}). ` +
      (hasUrl ? "DB(Docker)가 켜져 있는지 확인하세요: docker compose up -d  /  DATABASE_URL 의 주소·포트도 확인하세요." : ".env.local 에 DATABASE_URL 이 없습니다."), detail);
  }
  if (code === "28P01" || code === "28000") return new DbUnavailableError("데이터베이스 로그인에 실패했습니다. DATABASE_URL 의 아이디·비밀번호를 확인하세요.", code);
  if (code === "3D000") return new DbUnavailableError("데이터베이스가 존재하지 않습니다. DATABASE_URL 의 DB 이름을 확인하세요(스키마를 아직 만들지 않았을 수도 있습니다).", code);
  return e;
}

/**
 * 접속 주소의 localhost 를 127.0.0.1 로 바꾼다.
 * Windows 등에서 localhost 가 IPv6(::1)와 IPv4 두 주소로 풀리면, DB 가 꺼져 있을 때 Node 가 message 가 빈 AggregateError 를 만들고
 * Next.js 개발 서버가 이를 처리하다가 홈 화면이 500 으로 죽는다. Docker 가 공개한 포트는 IPv4 로 접속하는 것이 가장 확실하다.
 */
export function useIpv4Loopback(url: string | undefined): string | undefined {
  return url?.replace(/^(postgres(?:ql)?:\/\/(?:[^@\/]*@)?)localhost(?=[:\/?]|$)/i, "$1127.0.0.1");
}

function makePool(): Pool {
  const p = new Pool({ connectionString: useIpv4Loopback(process.env.DATABASE_URL), max: 10 });
  const q = p.query.bind(p) as (...a: unknown[]) => unknown;
  const c = p.connect.bind(p) as (...a: unknown[]) => unknown;
  const rewrap = (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => {
    const r = fn(...a) as { then?: unknown; catch?: (f: (e: unknown) => never) => unknown };
    return r && typeof r.then === "function" && r.catch ? r.catch((e: unknown) => { throw explainDbError(e); }) : r;
  };
  (p as unknown as { query: unknown }).query = rewrap(q);
  (p as unknown as { connect: unknown }).connect = rewrap(c);
  return p;
}

// 개발 서버의 핫리로드로 모듈이 다시 로드돼도 연결(Pool)이 늘어나지 않게 전역에 보관
const globalForPg = globalThis as unknown as { pgPool?: Pool };
export const pool = globalForPg.pgPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;
