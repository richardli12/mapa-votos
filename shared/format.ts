const int = new Intl.NumberFormat('pt-BR');
const pctFmt = [0, 1, 2].map((d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (n: number) => int.format(Math.round(n));
export const fmtPct = (n: number, digits = 2) => `${pctFmt[Math.max(0, Math.min(2, digits))].format(n)}%`;
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

// Siglas comuns em nomes de locais de votação e partidos, mantidas em maiúsculas.
const SIGLAS = new Set(['EMEF', 'EMEI', 'EMEB', 'EMEIEF', 'EE', 'EEF', 'EEFM', 'EEEFM', 'EEEM', 'EEM', 'EM', 'CE', 'CEM', 'CED', 'CEF', 'CEU', 'CIEP', 'CAIC', 'CMEI', 'CEI', 'CEMEI',
  'ETEC', 'FATEC', 'IF', 'IFSP', 'IFRJ', 'IFMG', 'IFBA', 'IFCE', 'IFPE', 'IFRS', 'IFSC', 'IFPR', 'SESI', 'SENAI', 'SESC', 'SENAC', 'PUC', 'USP', 'UNESP', 'UNICAMP', 'UFRJ', 'UFMG',
  'UFBA', 'UFPE', 'UFRGS', 'UFSC', 'UFPR', 'UFC', 'UNB', 'UNIP', 'UERJ', 'UEL', 'UEM', 'APAE', 'CRAS', 'CREAS', 'UBS', 'SP', 'RJ', 'MG', 'BA', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII']);

export function titleCase(s: string): string {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);
  return s.toLowerCase().split(/\s+/).map((w, i) => {
    const bare = w.replace(/[^\p{L}.]/gu, '');
    if (/^(\p{L}\.)+\p{L}?\.?$/u.test(bare) && bare.length <= 8) return w.toUpperCase(); // E.E., U.F.
    if (SIGLAS.has(bare.toUpperCase())) return w.toUpperCase();
    return i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
