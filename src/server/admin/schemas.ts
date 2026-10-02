import { z } from "zod";
import { AdminError } from "./errors";
import type { AdminCtx } from "./audit";

/** 폼(문자열)·JSON(숫자) 모두 받는 정수. 빈 칸은 0이 아니라 오류로 처리한다. */
export const money = z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().trim().regex(/^\d{1,9}$/, "숫자만 입력해 주세요").transform(Number));
export const bool = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());   // 체크 안 한 칸은 아예 오지 않으므로 false
export const dateStr = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식은 YYYY-MM-DD 입니다");
export const bookingNo = z.string().trim().toUpperCase().regex(/^H[0-9A-Z]{10}$/, "예약번호 형식이 올바르지 않습니다");

export function needOwner(admin: AdminCtx) {
  if (admin.role !== "owner") throw new AdminError("FORBIDDEN", "소유자만 할 수 있는 작업입니다", 403);
}
