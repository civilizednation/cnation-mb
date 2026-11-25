/** 초 → "m:ss.s" (decimals=1) 또는 "m:ss" (decimals=0) */
export function formatTime(sec: number, decimals = 1): string {
  if (!Number.isFinite(sec)) sec = 0;
  const neg = sec < 0;
  let s = Math.abs(sec);
  const f = Math.pow(10, decimals);
  s = Math.round(s * f) / f;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  let ss = decimals > 0 ? rest.toFixed(decimals) : String(Math.floor(rest));
  const intPart = ss.split('.')[0];
  if (intPart.length < 2) ss = '0' + ss;
  return `${neg ? '-' : ''}${m}:${ss}`;
}

/**
 * "mm:ss.s" / "m:ss" / "ss.s" / "1:02:03.5" 를 초로 파싱. 실패 시 null.
 */
export function parseTime(input: string): number | null {
  const t = input.trim().replace(/,/g, '.');
  if (!t) return null;
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  const parts = body.split(':');
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!/^\d*(\.\d*)?$/.test(p) || p === '' || p === '.') return null;
    const v = parseFloat(p);
    if (i < parts.length - 1 && p.includes('.')) return null;
    if (i > 0 && v >= 60) return null;
    total = total * 60 + v;
  }
  return neg ? -total : total;
}

export function formatDuration(sec: number): string {
  return formatTime(sec, 0);
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
