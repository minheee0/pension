import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { StayError, type StayErrorCode } from "@/server/booking/hold";
import { PaymentError } from "@/server/payments/errors";

const STATUS: Record<StayErrorCode, number> = {
  INVALID_INPUT: 400,
  OUT_OF_RANGE: 400,
  OPTION_INVALID: 400,
  MIN_NIGHTS: 422,
  UNAVAILABLE: 409,
  PRICE_MISMATCH: 409,
  INVALID_STATE: 409,
  NOT_FOUND: 404,
};

export function jsonError(code: string, message: string, status: number, extra?: object) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export function tooMany(retryAfterSec: number) {
  const res = jsonError("RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

/** 모든 API 라우트의 catch 에서 사용. 내부 오류 내용은 사용자에게 노출하지 않는다. */
export function apiError(e: unknown) {
  if (e instanceof ZodError) {
    return jsonError("INVALID_INPUT", e.issues[0]?.message ?? "입력값이 올바르지 않습니다", 400, {
      issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (e instanceof StayError) {
    return jsonError(e.code, e.message, STATUS[e.code], e.detail ? { detail: e.detail } : undefined);
  }
  if (e instanceof PaymentError) return jsonError(e.code, e.message, e.status);
  console.error("[api] unexpected error", e);
  return jsonError("INTERNAL", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
}
