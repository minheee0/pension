import { Pool, types } from "pg";

// DATE 컬럼을 JS Date(타임존 오염) 대신 'YYYY-MM-DD' 문자열로 받는다.
types.setTypeParser(1082, (v: string) => v);

// 개발 서버의 핫리로드로 모듈이 다시 로드돼도 연결(Pool)이 늘어나지 않게 전역에 보관
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;
