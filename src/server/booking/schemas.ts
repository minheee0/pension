import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식은 YYYY-MM-DD 입니다");

const optionReq = z.object({
  optionId: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().min(1).max(20),
  useDate: date.optional(),
  useTime: z.string().regex(/^\d{2}:\d{2}$/, "시간 형식은 HH:MM 입니다").optional(),
});

// GET /api/quote?checkIn=&checkOut=&guests=&options=[{"optionId":1,"qty":1,"useDate":"2026-10-10","useTime":"18:00"}]
const optionsParam = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return [];
    try {
      return z.array(optionReq).max(10).parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: "custom", message: "options 형식이 올바르지 않습니다" });
      return z.NEVER;
    }
  });

export const quoteQuerySchema = z.object({
  checkIn: date,
  checkOut: date,
  guests: z.coerce.number().int().min(1, "인원을 확인해 주세요").max(20, "인원을 확인해 주세요"),
  options: optionsParam,
});

export const calendarQuerySchema = z.object({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "month 형식은 YYYY-MM 입니다"),
});

export const holdBodySchema = z.object({
  checkIn: date,
  checkOut: date,
  guests: z.number().int().min(1, "인원을 확인해 주세요").max(20, "인원을 확인해 주세요"),
  options: z.array(optionReq).max(10).default([]),
  guest: z.object({
    name: z.string().trim().min(1, "예약자 이름을 입력해 주세요").max(50),
    phone: z.string().min(1, "휴대폰 번호를 입력해 주세요").max(30),
    email: z
      .string()
      .trim()
      .max(100)
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "이메일 형식이 올바르지 않습니다")
      .optional(),
  }),
  memo: z.string().trim().max(500).optional(),
  agreedTerms: z.boolean().refine((v) => v === true, "환불 규정에 동의해 주세요"),
  expectedTotal: z.number().int().min(0).optional(),
});
