import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// 개인정보(전화번호) 보호용.
//  - PII_ENC_KEY  : 암호화(AES-256-GCM). 복호화가 필요할 때(알림 발송 등)만 사용
//  - PII_HASH_KEY : 조회용 HMAC. 예약번호+전화번호 일치 여부를 복호화 없이 비교
// 두 키는 서로 다른 값이어야 하며, 분실하면 기존 데이터를 읽을 수 없으니 별도로 백업할 것.

function key(name: "PII_ENC_KEY" | "PII_HASH_KEY"): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`환경변수 ${name} 가 없습니다 (.env.local 확인)`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} 는 base64로 인코딩된 32바이트여야 합니다`);
  return buf;
}

export function encryptText(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("PII_ENC_KEY"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptText(payload: string): string {
  const [ver, iv, tag, ct] = payload.split(":");
  if (ver !== "v1" || !iv || !tag || !ct) throw new Error("알 수 없는 암호문 형식");
  const d = createDecipheriv("aes-256-gcm", key("PII_ENC_KEY"), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export function hmacHex(value: string): string {
  return createHmac("sha256", key("PII_HASH_KEY")).update(value).digest("hex");
}

/** 국내 휴대폰 번호를 01012345678 형태로 정규화. 형식이 아니면 null */
export function normalizeKrMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const n = digits.startsWith("82") ? "0" + digits.slice(2) : digits;
  return /^01[016789]\d{7,8}$/.test(n) ? n : null;
}
