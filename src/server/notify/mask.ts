export const maskPhone = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 8 ? `${d.slice(0, 3)}****${d.slice(-4)}` : "***"; };
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");
export const maskRecipient = (r: string) => (r.includes("@") ? maskEmail(r) : maskPhone(r));
