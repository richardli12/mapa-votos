import type { CandidateLite } from '../../shared/types';
import type { SecaoResumo, UrnaEstrutura, UrnaLocal } from '../../shared/urnas';

export interface Soma {
  secoes: number; totalizadas: number; aguardando: number;
  apt: number; comp: number; nom: number; leg: number; bra: number; nul: number;
  v: Record<string, number>; p: Record<string, number>;
}

export function somar(list: Iterable<SecaoResumo>): Soma {
  const s: Soma = { secoes: 0, totalizadas: 0, aguardando: 0, apt: 0, comp: 0, nom: 0, leg: 0, bra: 0, nul: 0, v: {}, p: {} };
  for (const x of list) {
    if (x.st === 'agregada') continue;
    s.secoes++;
    if (x.st !== 'totalizada') { s.aguardando++; continue; }
    s.totalizadas++;
    s.apt += x.apt; s.comp += x.comp; s.nom += x.nom; s.leg += x.leg; s.bra += x.bra; s.nul += x.nul;
    for (const k in x.v) s.v[k] = (s.v[k] ?? 0) + x.v[k];
    if (x.p) for (const k in x.p) s.p[k] = (s.p[k] ?? 0) + x.p[k];
  }
  return s;
}

export const validos = (s: Pick<Soma, 'nom' | 'leg'>) => s.nom + s.leg;

export function ranking(s: Soma): [string, number][] {
  return Object.entries(s.v).sort((a, b) => b[1] - a[1]);
}

export interface LocalView extends UrnaLocal { semNome: boolean }

/** Locais de votação: da simulação, do arquivo estático do TSE ou, sem eles, deduzidos dos boletins. */
export function montarLocais(est: UrnaEstrutura | null, estaticos: UrnaLocal[] | null, secoes: SecaoResumo[]): LocalView[] {
  const base = est?.locais ?? estaticos;
  if (base?.length) return base.map((l) => ({ ...l, semNome: false }));
  const m = new Map<string, LocalView>();
  for (const s of secoes) {
    if (s.l === null) continue;
    const id = `${s.z}-${s.l}`;
    let l = m.get(id);
    if (!l) { l = { id, zona: s.z, local: s.l, nome: `Local de votação ${s.l}`, secoes: [], eleitores: 0, lat: null, lon: null, semNome: true }; m.set(id, l); }
    l.secoes.push(s.s);
    l.eleitores = (l.eleitores ?? 0) + s.apt;
  }
  return [...m.values()].sort((a, b) => a.zona - b.zona || a.local - b.local);
}

/** número do candidato → candidato; número do partido → sigla/cor (pelo prefixo do número). */
export function indiceCandidatos(cands: CandidateLite[]) {
  const porNumero = new Map(cands.map((c) => [c.number, c]));
  const partidos = new Map<string, { sigla: string; cor: number }>();
  for (const c of cands) { const pn = String(Number(c.number.slice(0, 2))); if (!partidos.has(pn)) partidos.set(pn, { sigla: c.party, cor: c.color }); }
  return { porNumero, partidos };
}

export const pad4 = (n: number) => String(n).padStart(4, '0');
