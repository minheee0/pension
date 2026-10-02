// 서버 컴포넌트(페이지)에서 현재 관리자를 확인한다. (변경 작업은 항상 /api/admin/* 에서 다시 확인한다)
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "@/server/db";
import { getAdminByToken, SESSION_COOKIE } from "./auth";
import type { AdminCtx } from "./audit";

export async function currentAdmin(): Promise<AdminCtx | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getAdminByToken(pool, token);
}

export async function requireAdminPage(): Promise<AdminCtx> {
  const a = await currentAdmin();
  if (!a) redirect("/admin/login");
  return a;
}
