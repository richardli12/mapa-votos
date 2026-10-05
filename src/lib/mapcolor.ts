import { assignColors } from '../../shared/colors';
import { fmtPct, titleCase } from '../../shared/format';
import type { CandidateLite, MapArea, MapPayload } from '../../shared/types';
import type { MapMode } from '../hooks/useRoute';
import { diverging, mix, ramp, slotColor, type Palette } from './palette';

export interface LegendItem { color: string; label: string; count?: number; id?: string }
export interface Legend { kind: 'cat' | 'seq' | 'div'; title: string; note?: string; items: LegendItem[]; ends?: [string, string] }
export interface Coloring { fill: Map<string, string>; legend: Legend }

export const totalOf = (a: MapArea) => a.valid || Object.values(a.votes).reduce((s, v) => s + v, 0);

export function ranked(a: MapArea): [string, number][] {
  return Object.entries(a.votes).sort((x, y) => y[1] - x[1]);
}

/** Cores de partidos atribuídas só entre os partidos presentes (estáveis: dependem do conjunto, não dos votos). */
export function partySlots(parties: Iterable<string>): Map<string, number> {
  const list = [...new Set(parties)];
  return assignColors(list, (p) => p, (p) => p);
}

function quantileBreaks(values: number[], k: number): number[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < k; i++) out.push(v[Math.min(v.length - 1, Math.floor((i / k) * v.length))]);
  return [...new Set(out.map((x) => Math.round(x * 10) / 10))];
}
const binOf = (x: number, breaks: number[]) => { let i = 0; while (i < breaks.length && x >= breaks[i]) i++; return i; };
const intensity = (share: number) => (share < 0.35 ? 0.42 : share < 0.45 ? 0.58 : share < 0.55 ? 0.74 : share < 0.65 ? 0.88 : 1);

export interface ColorOpts {
  mode: MapMode;
  palette: Palette;
  cands: Map<string, CandidateLite>;
  /** pinta pelo partido do líder (Brasil com cargos estaduais) */
  byParty: boolean;
  forca?: string;
  /** escala comum para pequenos múltiplos (máximo em %) */
  forcaMax?: number;
  duel?: [string, string];
}

export function colorAreas(payload: MapPayload | null, o: ColorOpts): Coloring {
  const fill = new Map<string, string>();
  const p = o.palette;
  if (!payload) return { fill, legend: { kind: 'cat', title: '', items: [] } };
  const areas = payload.areas.filter((a) => totalOf(a) > 0 || o.mode === 'apuracao' || o.mode === 'comparecimento');

  const seqLegend = (title: string, values: (a: MapArea) => number | null, fmt: (x: number) => string, k = 5, note?: string, fixed?: number[]): Coloring => {
    const vals = areas.map(values).filter((x): x is number => x !== null);
    const breaks = fixed ?? quantileBreaks(vals, k);
    const colors = ramp(p, p.seq[4], breaks.length + 1);
    const counts = new Array(breaks.length + 1).fill(0);
    for (const a of areas) { const x = values(a); if (x === null) continue; const b = binOf(x, breaks); counts[b]++; fill.set(a.code, colors[b]); }
    const items = colors.map((color, i) => ({ color, count: counts[i], label: i === 0 ? `< ${fmt(breaks[0] ?? 0)}` : i === breaks.length ? `≥ ${fmt(breaks[i - 1])}` : `${fmt(breaks[i - 1])} – ${fmt(breaks[i])}` }));
    return { fill, legend: { kind: 'seq', title, note, items } };
  };

  switch (o.mode) {
    case 'partido': {
      const leaders = areas.map((a) => [a, Object.entries(a.partyVotes ?? {}).sort((x, y) => y[1] - x[1])[0]] as const).filter(([, l]) => l);
      const slots = partySlots(leaders.map(([, l]) => l![0]));
      const counts = new Map<string, number>();
      for (const [a, l] of leaders) {
        const share = l![1] / (Object.values(a.partyVotes ?? {}).reduce((s, v) => s + v, 0) || 1);
        fill.set(a.code, mix(p.surface, slotColor(p, slots.get(l![0]) ?? -1), Math.min(1, 0.35 + share * 1.6)));
        counts.set(l![0], (counts.get(l![0]) ?? 0) + 1);
      }
      const items = [...counts].sort((a, b) => b[1] - a[1]).map(([party, n]) => ({ color: slotColor(p, slots.get(party) ?? -1), label: party, count: n }));
      return { fill, legend: { kind: 'cat', title: 'Partido mais votado', note: 'Tom mais forte = partido com fatia maior dos votos', items } };
    }
    case 'forca': {
      const c = o.forca ? o.cands.get(o.forca) : undefined;
      if (!c) break;
      const pct = (a: MapArea) => (totalOf(a) ? ((a.votes[c.id] ?? 0) / totalOf(a)) * 100 : null);
      const vals = areas.map(pct).filter((x): x is number => x !== null);
      const max = o.forcaMax ?? Math.max(1, ...vals);
      const step = max > 40 ? 10 : max > 20 ? 5 : max > 8 ? 2 : max > 4 ? 1 : 0.5;
      const breaks: number[] = [];
      for (let x = step; x < max && breaks.length < 6; x += step) breaks.push(x);
      const colors = ramp(p, slotColor(p, c.color < 0 ? 0 : c.color), breaks.length + 1);
      const dg = step < 1 ? 1 : 0;
      const counts = new Array(breaks.length + 1).fill(0);
      for (const a of areas) { const x = pct(a); if (x === null) continue; const b = binOf(x, breaks); counts[b]++; fill.set(a.code, colors[b]); }
      return { fill, legend: { kind: 'seq', title: `Força de ${titleCase(c.name)}`, note: '% dos votos válidos em cada área', items: colors.map((color, i) => ({ color, count: counts[i], label: i === 0 ? `< ${fmtPct(breaks[0] ?? max, dg)}` : i === breaks.length ? `≥ ${fmtPct(breaks[i - 1], dg)}` : `${fmtPct(breaks[i - 1], dg)} – ${fmtPct(breaks[i], dg)}` })) } };
    }
    case 'duelo': {
      const [ia, ib] = o.duel ?? [];
      const A = ia ? o.cands.get(ia) : undefined, B = ib ? o.cands.get(ib) : undefined;
      if (!A || !B) break;
      const edges = [-0.4, -0.2, -0.07, 0.07, 0.2, 0.4];
      const ca = slotColor(p, A.color < 0 ? 0 : A.color), cb = slotColor(p, B.color === A.color || B.color < 0 ? ((A.color < 0 ? 0 : A.color) + 4) % 8 : B.color);
      const colors = diverging(p, ca, cb, 3);
      const counts = new Array(7).fill(0);
      for (const a of areas) {
        const va = a.votes[A.id] ?? 0, vb = a.votes[B.id] ?? 0;
        if (!va && !vb) continue;
        const d = (vb - va) / (va + vb);
        const b = binOf(d, edges);
        counts[b]++; fill.set(a.code, colors[b]);
      }
      const labels = ['+40', '+20', '+7', '±7', '+7', '+20', '+40'];
      return { fill, legend: { kind: 'div', title: `${titleCase(A.name)} × ${titleCase(B.name)}`, ends: [`← ${titleCase(A.name)}`, `${titleCase(B.name)} →`], note: 'Vantagem em pontos sobre a soma dos dois · faixa do meio (±7) = empate técnico', items: colors.map((color, i) => ({ color, label: labels[i], count: counts[i] })) } };
    }
    case 'margem':
      return seqLegend('Margem do líder', (a) => { const r = ranked(a); const t = totalOf(a); return t && r.length ? ((r[0][1] - (r[1]?.[1] ?? 0)) / t) * 100 : null; }, (x) => `${x.toFixed(0)} p.p.`, 5, 'Diferença entre 1º e 2º colocados — tons claros = disputa acirrada', [3, 8, 15, 25]);
    case 'comparecimento':
      return seqLegend('Comparecimento', (a) => (a.pctCounted > 0 ? a.turnoutPct : null), (x) => fmtPct(x, 1), 5, 'Eleitores que votaram, sobre o eleitorado das seções apuradas');
    case 'brancosnulos':
      return seqLegend('Brancos + nulos', (a) => (a.pctCounted > 0 ? a.blankPct + a.nullPct : null), (x) => fmtPct(x, 1), 5, '% do total de votos');
    case 'apuracao': {
      const colors = [p.empty, ...ramp(p, p.seq[4], 4)];
      const edges = [0.0001, 50, 90, 100];
      const counts = new Array(5).fill(0);
      for (const a of payload.areas) { const b = binOf(a.pctCounted, edges); counts[b]++; fill.set(a.code, colors[b]); }
      return { fill, legend: { kind: 'seq', title: 'Seções totalizadas', items: ['Aguardando', 'até 50%', '50% – 90%', '90% – 99,9%', '100%'].map((label, i) => ({ color: colors[i], label, count: counts[i] })) } };
    }
    default: break;
  }

  // Líder (padrão)
  const counts = new Map<string, number>();
  const partyOf = (id: string) => o.cands.get(id)?.party ?? '?';
  const slots = o.byParty ? partySlots(areas.map((a) => ranked(a)[0]?.[0]).filter(Boolean).map(partyOf)) : null;
  for (const a of areas) {
    const r = ranked(a);
    if (!r.length || !r[0][1]) continue;
    const id = r[0][0];
    const key = o.byParty ? partyOf(id) : id;
    const slot = o.byParty ? slots!.get(key) ?? -1 : o.cands.get(id)?.color ?? -1;
    fill.set(a.code, mix(p.surface, slotColor(p, slot), intensity(r[0][1] / totalOf(a))));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const items = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => o.byParty
    ? { color: slotColor(p, slots!.get(k) ?? -1), label: k, count: n }
    : { color: slotColor(p, o.cands.get(k)?.color ?? -1), label: `${titleCase(o.cands.get(k)?.name ?? k)} (${o.cands.get(k)?.party ?? ''})`, count: n, id: k });
  return { fill, legend: { kind: 'cat', title: o.byParty ? 'Partido do líder em cada estado' : 'Quem lidera', note: 'Tom mais forte = vantagem maior', items } };
}
