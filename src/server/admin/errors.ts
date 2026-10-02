export type AdminErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "LOGIN_FAILED" | "RATE_LIMITED" | "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND";

export class AdminError extends Error {
  constructor(public code: AdminErrorCode, message: string, public status: number, public detail?: unknown) {
    super(message);
    this.name = "AdminError";
  }
}
