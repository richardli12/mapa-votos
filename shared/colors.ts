// Identidade de cor: a cor segue o partido/candidato, nunca a posição no ranking.
// Paleta categórica validada (8 posições, ordem fixa) — ver src/styles/tokens.css.

export const SLOT_COUNT = 8;
// 0 azul · 1 laranja · 2 água · 3 amarelo · 4 magenta · 5 verde · 6 violeta · 7 vermelho
const PREFERRED: Record<string, number[]> = {
  PT: [7], PL: [0], PSD: [2], MDB: [5], 'UNIÃO': [6], PP: [0, 2], REPUBLICANOS: [2, 0], PSDB: [0, 2],
  NOVO: [1], PSB: [3, 1], PDT: [1, 7], PSOL: [3, 4], 'PC do B': [7], PCDOB: [7], PV: [5], REDE: [5, 2],
  PODE: [5, 2], AVANTE: [1], 'MISSÃO': [4], DC: [4], PRD: [6], SOLIDARIEDADE: [1], CIDADANIA: [4],
  PMB: [4], AGIR: [3], PRTB: [5], MOBILIZA: [6], PCB: [7], PSTU: [7], PCO: [7], UP: [7],
};
// Prioridade fixa (tamanho histórico) para resolver disputas pela mesma cor.
const PRIORITY = ['PT', 'PL', 'PSD', 'MDB', 'UNIÃO', 'PP', 'REPUBLICANOS', 'PSDB', 'NOVO', 'PSB', 'PDT', 'PSOL',
  'PODE', 'PV', 'PC do B', 'PCDOB', 'REDE', 'AVANTE', 'SOLIDARIEDADE', 'CIDADANIA', 'PRD', 'MISSÃO', 'DC', 'AGIR', 'PMB',
  'PRTB', 'MOBILIZA', 'PCB', 'PSTU', 'PCO', 'UP'];

const rank = (p: string) => { const i = PRIORITY.indexOf(p); return i < 0 ? 999 : i; };

/**
 * Atribui posições de cor a uma lista de chaves (ex.: ids de candidatos) dado o partido de cada uma.
 * Determinístico: depende só dos partidos e dos ids, não dos votos — a cor não muda durante a apuração.
 */
export function assignColors<T>(items: T[], party: (t: T) => string, key: (t: T) => string, max = SLOT_COUNT): Map<string, number> {
  const order = [...items].sort((a, b) => rank(party(a)) - rank(party(b)) || key(a).localeCompare(key(b)));
  const used = new Set<number>();
  const out = new Map<string, number>();
  // Em ordem de peso histórico: cor preferida se livre; senão a primeira livre; acabou a paleta → "outros".
  for (const it of order) {
    let slot = (PREFERRED[party(it)] ?? []).find((s) => !used.has(s)) ?? -1;
    if (slot < 0) for (let s = 0; s < SLOT_COUNT; s++) if (!used.has(s)) { slot = s; break; }
    if (used.size >= max) slot = -1;
    if (slot >= 0) used.add(slot);
    out.set(key(it), slot);
  }
  return out;
}
