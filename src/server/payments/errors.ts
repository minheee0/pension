export type PaymentErrorCode =
  | "NOT_FOUND" | "AMOUNT_MISMATCH" | "INVALID_STATE" | "UNVERIFIED"
  | "LOOKUP_FAILED" | "RATE_LIMITED" | "NOT_CANCELLABLE" | "REFUND_CHANGED"
  | "REFUND_ACCOUNT_REQUIRED" | "INVALID_INPUT";

export class PaymentError extends Error {
  constructor(public code: PaymentErrorCode, message: string, public status: number, public detail?: unknown) {
    super(message);
    this.name = "PaymentError";
  }
}
