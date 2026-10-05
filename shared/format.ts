const int = new Intl.NumberFormat('pt-BR');
const pct2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (n: number) => int.format(Math.round(n));
export const fmtPct = (n: number, digits = 2) => `${(digits === 1 ? pct1 : pct2).format(n)}%`;
export const fmtCompact = (n: number) => compact.format(n);

/** Converte números do TSE ("1.234", "12,34", 12) para number. */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string' || v.trim() === '') return 0;
  const t = v.trim();
  const s = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function titleCase(s: string): string {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
