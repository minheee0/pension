/**
 * 관리자 인증
 *  - 비밀번호: scrypt(솔트 포함). 존재하지 않는 계정에도 같은 계산을 해서 응답 시간으로 계정 유무를 알 수 없게 한다.
 *  - 세션: 서명된 쿠키 토큰 `adminId.만료.비밀번호태그.서명`. DB 테이블이 필요 없다.
 *      · 만료(기본 8시간) · 서명(HMAC) · 계정 활성 여부 · 비밀번호 태그(비밀번호를 바꾸면 기존 세션 모두 무효)를 매 요청 확인
 *  - 로그인 시도 제한: lookup_attempts 재사용 (booking_no = 'admin:이메일'). 같은 이메일 5회 / 같은 IP 20회 실패 시 15분 잠금
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Pool } from "pg";
import { AdminError } from "./errors";
import { audit, type AdminCtx } from "./audit";

export const SESSION_COOKIE = "manbok_admin";
export const SESSION_TTL_MS = 8 * 3600e3;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), h.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

let dummyHash: string | undefined;
const DUMMY = () => (dummyHash ??= hashPassword("not-a-real-password"));

function secret(): Buffer {
  const raw = process.env.ADMIN_SESSION_SECRET;
  const buf = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (buf.length < 32) throw new Error("환경변수 ADMIN_SESSION_SECRET(base64, 32바이트 이상)이 필요합니다 (.env.local 확인)");
  return buf;
}
const b64u = (b: Buffer) => b.toString("base64url");
const pwTag = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("hex").slice(0, 12);
const sign = (payload: string) => b64u(createHmac("sha256", secret()).update(payload).digest());

export function signSession(adminId: number, passwordHash: string, now = Date.now(), ttl = SESSION_TTL_MS): string {
  const payload = `${adminId}.${now + ttl}.${pwTag(passwordHash)}`;
  return `${payload}.${sign(payload)}`;
}

export function parseSession(token: string, now = Date.now()): { adminId: number; tag: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, exp, tag, sig] = parts;
  const expected = sign(`${id}.${exp}.${tag}`);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!(Number(exp) > now)) return null;
  const adminId = Number(id);
  return Number.isInteger(adminId) ? { adminId, tag } : null;
}

export async function getAdminByToken(pool: Pool, token: string | undefined | null): Promise<AdminCtx | null> {
  if (!token) return null;
  const s = parseSession(token);
  if (!s) return null;
  const { rows } = await pool.query(`select id, email, name, role, active, password_hash from admin_users where id = $1`, [s.adminId]);
  const a = rows[0];
  if (!a || !a.active || pwTag(a.password_hash) !== s.tag) return null;
  return { id: a.id, email: a.email, name: a.name, role: a.role };
}

export function readCookie(req: Request, name = SESSION_COOKIE): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function loginAdmin(pool: Pool, email: string, password: string, ip: string) {
  const key = `admin:${email.trim().toLowerCase()}`;
  const inet = isIP(ip) ? ip : null;
  const { rows: cnt } = await pool.query(
    `select count(*) filter (where booking_no = $1) as by_email,
            count(*) filter (where ip = $2::inet and booking_no like 'admin:%') as by_ip
       from lookup_attempts where success = false and created_at > now() - interval '15 minutes'`, [key, inet]);
  if (Number(cnt[0].by_email) >= 5 || Number(cnt[0].by_ip) >= 20) {
    throw new AdminError("RATE_LIMITED", "로그인 시도가 너무 많습니다. 15분 후에 다시 시도해 주세요", 429);
  }
  const r = await pool.query(
    `select id, email, name, role, password_hash from admin_users where lower(email) = lower($1) and active`, [email.trim()]);
  const row = r.rows[0];
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY()) && !!row;
  await pool.query(`insert into lookup_attempts (booking_no, ip, success) values ($1, $2::inet, $3)`, [key, inet, ok]);
  if (!ok) throw new AdminError("LOGIN_FAILED", "이메일 또는 비밀번호가 올바르지 않습니다", 401);

  await pool.query(`update admin_users set last_login_at = now() where id = $1`, [row.id]);
  const admin: AdminCtx = { id: row.id, email: row.email, name: row.name, role: row.role, ip };
  await audit(pool, admin, "auth.login", {});
  return { admin, token: signSession(row.id, row.password_hash) };
}

export async function createAdmin(pool: Pool, p: { email: string; name: string; password: string; role?: "owner" | "staff" }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new AdminError("INVALID_INPUT", "이메일 형식이 올바르지 않습니다", 400);
  if (p.password.length < 10) throw new AdminError("INVALID_INPUT", "비밀번호는 10자 이상이어야 합니다", 400);
  if (!p.name.trim()) throw new AdminError("INVALID_INPUT", "이름을 입력해 주세요", 400);
  try {
    const r = await pool.query(
      `insert into admin_users (email, password_hash, name, role) values ($1, $2, $3, $4) returning id`,
      [p.email.trim().toLowerCase(), hashPassword(p.password), p.name.trim(), p.role ?? "owner"]);
    return r.rows[0].id as number;
  } catch (e: any) {
    if (e?.code === "23505") throw new AdminError("CONFLICT", "이미 등록된 이메일입니다", 409);
    throw e;
  }
}
