"use client";

import { usePathname } from "next/navigation";

/** /admin 아래에서는 손님용 머리글·바닥글을 보여주지 않는다 */
export default function ChromeGate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return path.startsWith("/admin") ? null : <>{children}</>;
}
