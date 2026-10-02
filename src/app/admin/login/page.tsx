import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/admin/LoginForm";
import { currentAdmin } from "@/server/admin/session";

export const metadata: Metadata = { title: "관리자 로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLogin() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <div className="mx-auto max-w-sm px-5 py-24">
      <h1 className="font-serif text-3xl font-bold text-wood">만복 관리자</h1>
      <p className="mt-1 text-sm text-giwa">관리자만 접근할 수 있습니다.</p>
      <LoginForm />
    </div>
  );
}
