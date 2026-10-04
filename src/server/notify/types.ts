/** 발송 업체(문자 대행사, 메일 서버) 어댑터 공통 형식 */
export class ProviderError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); this.name = "ProviderError"; }
}
export interface SmsProvider { name: string; send(m: { to: string; text: string; subject?: string }): Promise<{ id?: string }> }
export interface MailProvider { name: string; send(m: { to: string; subject: string; text: string }): Promise<{ id?: string }> }
export interface Providers { sms: SmsProvider | null; email: MailProvider | null }

export type Audience = "guest" | "owner";
export type Channel = "sms" | "email";
