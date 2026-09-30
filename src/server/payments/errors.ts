export type PaymentErrorCode = "NOT_FOUND" | "AMOUNT_MISMATCH" | "INVALID_STATE" | "UNVERIFIED";

export class PaymentError extends Error {
  constructor(public code: PaymentErrorCode, message: string, public status: number) {
    super(message);
    this.name = "PaymentError";
  }
}
