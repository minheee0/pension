import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/db";
import { loginAdmin, SESSION_COOKIE, SESSION_TTL_MS } from "@/server/admin/auth";
import { AdminError } from "@/server/admin/errors";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`admin-login:${ip}`, 20, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    const origin = req.headers.get("origin");
    if (!origin || origin !== new URL(req.url).origin) return jsonError("FORBIDDEN", "허용되지 않은 요청입니다", 403);
    if (!req.headers.get("content-type")?.includes("application/json")) return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
    const input = body.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return jsonError("INVALID_INPUT", "이메일과 비밀번호를 입력해 주세요", 400);

    const { admin, token } = await loginAdmin(pool, input.data.email, input.data.password, ip);
    const res = NextResponse.json({ ok: true, name: admin.name, role: admin.role }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (e) {
    if (e instanceof AdminError) return jsonError(e.code, e.message, e.status);
    return apiError(e);
  }
}
