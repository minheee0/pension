// 간단한 메모리 기반 요청 제한. 서버 인스턴스 하나 기준이라 "가벼운 1차 방어"용이다.
// (서버리스로 여러 인스턴스가 뜨면 인스턴스별로 따로 센다. 운영에서는 Redis/Upstash 등으로 교체 권장)
const g = globalThis as unknown as { __rateLimit?: Map<string, number[]> };
const store = (g.__rateLimit ??= new Map<string, number[]>());

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return { ok: false as const, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  store.set(key, hits);
  if (store.size > 5000) {
    for (const [k, v] of store) if (v.every((t) => now - t >= windowMs)) store.delete(k);
  }
  return { ok: true as const, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
