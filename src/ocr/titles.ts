/** 제목 정규화: trim, 연속 공백 1개, 대소문자 무시 */
export function normalizeTitle(t: string): string {
  return t.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** OCR 결과 후처리: 앞뒤 공백·특수문자 정리 */
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const CJK_GAP = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'gu');

export function cleanOcrTitle(raw: string): string {
  return raw
    .replace(CJK_GAP, '$1')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[|_~`^<>{}\[\]\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})!?.'"]+$/gu, '')
    .trim();
}

/** 파일명에서 확장자 제거 */
export function titleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const i = base.lastIndexOf('.');
  return (i > 0 ? base.slice(0, i) : base).trim() || base;
}

/**
 * 중복 제목 규칙: 정규화 기준 같은 제목이 2개 이상이면 재생 순서대로 "제목 1", "제목 2".
 * 중복이 없으면 그대로. 빈 제목은 "곡 n"(n = 목록 순번).
 */
export function computeDisplayTitles(titles: string[]): string[] {
  const filled = titles.map((t, i) => (t && t.trim() ? t.trim().replace(/\s+/g, ' ') : `곡 ${i + 1}`));
  const counts = new Map<string, number>();
  for (const t of filled) counts.set(normalizeTitle(t), (counts.get(normalizeTitle(t)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return filled.map((t) => {
    const k = normalizeTitle(t);
    if ((counts.get(k) ?? 0) < 2) return t;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${t} ${n}`;
  });
}

/** 파일명 금지 문자 치환 */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120) || 'track';
}

/** 파일명 중복 시 " (2)" 부여 */
export function uniqueFileNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const dot = n.lastIndexOf('.');
    const base = dot > 0 ? n.slice(0, dot) : n;
    const ext = dot > 0 ? n.slice(dot) : '';
    let cand = n;
    let i = 2;
    while (used.has(cand.toLowerCase())) cand = `${base} (${i++})${ext}`;
    used.add(cand.toLowerCase());
    return cand;
  });
}
