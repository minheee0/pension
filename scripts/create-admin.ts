/**
 * 관리자 계정 만들기.
 *   npx tsx --env-file=.env.local scripts/create-admin.ts you@example.com "이름" [owner|staff]
 * 비밀번호는 실행 중에 물어봅니다(화면에 표시되지 않음, 10자 이상). 자동화용으로 ADMIN_PASSWORD 환경변수도 지원합니다.
 */
import readline from "node:readline";
import { pool } from "../src/server/db";
import { createAdmin } from "../src/server/admin/auth";

function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const anyRl = rl as any;
    anyRl._writeToOutput = (s: string) => { if (s.includes(q)) process.stdout.write(s); else if (s.includes("\n") || s.includes("\r")) process.stdout.write("\n"); };
    rl.question(q, (a) => { rl.close(); resolve(a); });
  });
}

(async () => {
  const [email, name, role = "owner"] = process.argv.slice(2);
  if (!email || !name || !["owner", "staff"].includes(role)) {
    console.error('사용법: npx tsx scripts/create-admin.ts 이메일 "이름" [owner|staff]');
    process.exitCode = 1;
    return;
  }
  const password = process.env.ADMIN_PASSWORD ?? (await askHidden("비밀번호(10자 이상): "));
  const id = await createAdmin(pool, { email, name, password, role: role as "owner" | "staff" });
  console.log(`관리자 계정을 만들었습니다 (id=${id}, ${role}). /admin/login 에서 로그인하세요.`);
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => pool.end());
