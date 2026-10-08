/**
 * 자동 알림 스위치 (환경변수 NOTIFY_MODE)
 *   all   : 손님 + 사장님 (기본값. 설정하지 않으면 all)
 *   owner : 사장님에게만 (새 예약·취소·환불 실패). 손님에게는 보내지 않는다
 *   off   : 자동 알림 전부 끔
 * 알 수 없는 값(오타)은 손님에게 잘못 발송되지 않도록 off 로 처리한다.
 */
export type NotifyMode = "all" | "owner" | "off";

export function notifyMode(env: Record<string, string | undefined> = process.env): NotifyMode {
  const v = (env.NOTIFY_MODE ?? "all").trim().toLowerCase();
  if (v === "" || v === "all" || v === "on" || v === "true") return "all";
  if (v === "owner") return "owner";
  return "off";
}

export function describeMode(mode: NotifyMode): string {
  return mode === "all" ? "손님·사장님 모두 발송" : mode === "owner" ? "사장님에게만 발송 (손님 알림 꺼짐)" : "자동 알림 꺼짐";
}
