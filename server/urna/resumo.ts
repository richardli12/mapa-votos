// Converte um boletim de urna (decodificado do .bu oficial ou gerado pela simulação)
// no resumo por cargo usado pelo mapa/tabelas e no boletim completo exibido na tela.
import { cargoCode, cargoFromCode, cargoLabel } from '../../shared/cargos.ts';
import type { CargoId, Result, SourceKind } from '../../shared/types.ts';
import type { BoletimCargo, BoletimSecao, SecaoResumo, SecaoStatus } from '../../shared/urnas.ts';
import type { BoletimUrna, CargoBU } from './bu.ts';

export interface CargoNaUrna { cargo: CargoBU; aptos: number }

export function cargoNoBoletim(bu: BoletimUrna, codigo: number): CargoNaUrna | null {
  for (const e of bu.eleicoes) for (const c of e.cargos) if (!c.livre && c.codigo === codigo) return { cargo: c, aptos: e.aptos };
  return null;
}

/** Aptos/comparecimento da seção: o maior entre as eleições (todas usam o mesmo caderno). */
export function aptosDoBoletim(bu: BoletimUrna): { aptos: number; comp: number } {
  let aptos = 0, comp = 0;
  for (const e of bu.eleicoes) {
    aptos = Math.max(aptos, e.aptos);
    for (const c of e.cargos) comp = Math.max(comp, c.comparecimento);
  }
  return { aptos, comp };
}

export function resumir(bu: BoletimUrna | null, z: number, s: number, cargo: CargoId, uf: string, focus: Set<string>, st: SecaoStatus = 'totalizada', local: number | null = null): SecaoResumo {
  const vazio: SecaoResumo = { z, s, l: bu?.local ?? local, st: bu ? st : st === 'totalizada' ? 'aguardando' : st, apt: 0, comp: 0, nom: 0, leg: 0, bra: 0, nul: 0, v: {} };
  if (!bu) return vazio;
  const { aptos, comp } = aptosDoBoletim(bu);
  const found = cargoNoBoletim(bu, cargoCode(cargo, uf));
  const r: SecaoResumo = { ...vazio, apt: aptos, comp: found?.cargo.comparecimento ?? comp };
  if (!found) return r;
  const nominais: [number, number][] = [];
  const partidos: Record<string, number> = {};
  for (const v of found.cargo.votos) {
    if (v.tipo === 'nominal' && v.numero !== undefined) { r.nom += v.qtd; nominais.push([v.numero, v.qtd]); }
    else if (v.tipo === 'legenda') r.leg += v.qtd;
    else if (v.tipo === 'branco') r.bra += v.qtd;
    else if (v.tipo === 'nulo') r.nul += v.qtd;
    if ((v.tipo === 'nominal' || v.tipo === 'legenda') && v.partido !== undefined) partidos[v.partido] = (partidos[v.partido] ?? 0) + v.qtd;
  }
  nominais.sort((a, b) => b[1] - a[1]);
  const keep = nominais.length <= 30 ? nominais : nominais.filter(([n], i) => i < 10 || focus.has(String(n)));
  r.v = Object.fromEntries(keep.map(([n, q]) => [String(n), q]));
  if (found.cargo.tipo === 'proporcional') r.p = partidos;
  return r;
}

export interface NomeVotavel { nome: string; sigla: string; id: string; cor: number; foto: string | null }
/** cargo (código TSE) → número → candidato, a partir dos resultados do município. */
export type Nomes = Map<number, { cands: Map<number, NomeVotavel>; partidos: Map<number, { sigla: string; cor: number }> }>;

export function nomesDosResultados(results: Result[], uf: string): Nomes {
  const out: Nomes = new Map();
  for (const r of results) {
    const cands = new Map<number, NomeVotavel>();
    const partidos = new Map<number, { sigla: string; cor: number }>();
    for (const c of r.candidates) {
      cands.set(Number(c.number), { nome: c.name, sigla: c.party, id: c.id, cor: c.color, foto: c.photo });
      const pn = Number(c.number.slice(0, 2));
      if (!partidos.has(pn)) partidos.set(pn, { sigla: c.party, cor: c.color });
    }
    out.set(cargoCode(r.cargo, uf), { cands, partidos });
  }
  return out;
}

export function boletimCompleto(bu: BoletimUrna, uf: string, mu: string, z: number, s: number, source: SourceKind, nomes: Nomes, extra: { hash?: string; arquivo?: string } = {}): BoletimSecao {
  const { aptos, comp } = aptosDoBoletim(bu);
  const cargos: BoletimCargo[] = [];
  for (const e of bu.eleicoes) {
    for (const c of e.cargos) {
      const id = c.livre ? null : cargoFromCode(c.codigo) ?? null;
      const n = nomes.get(c.codigo);
      const bc: BoletimCargo = {
        cargo: id, codigo: c.codigo, label: id ? cargoLabel(id, uf) : `Consulta ${c.codigo}`, tipo: c.tipo,
        aptos: e.aptos, comparecimento: c.comparecimento, nominal: 0, legenda: 0, brancos: 0, nulos: 0, votos: [],
      };
      for (const v of c.votos) {
        if (v.tipo === 'branco') bc.brancos += v.qtd;
        else if (v.tipo === 'nulo') bc.nulos += v.qtd;
        else if ((v.tipo === 'nominal' || v.tipo === 'legenda') && v.numero !== undefined) {
          if (v.tipo === 'nominal') bc.nominal += v.qtd; else bc.legenda += v.qtd;
          const cand = v.tipo === 'nominal' ? n?.cands.get(v.numero) : undefined;
          const part = n?.partidos.get(v.partido ?? -1);
          bc.votos.push({
            tipo: v.tipo, numero: v.numero, partido: v.partido ?? 0, qtd: v.qtd,
            nome: cand?.nome ?? (v.tipo === 'legenda' ? `Legenda ${part?.sigla ?? v.numero}` : undefined),
            sigla: cand?.sigla ?? part?.sigla, id: cand?.id, cor: cand?.cor ?? part?.cor ?? -1, foto: cand?.foto ?? null,
          });
        }
      }
      bc.votos.sort((a, b) => b.qtd - a.qtd || a.numero - b.numero);
      cargos.push(bc);
    }
  }
  // ordem natural da apuração: presidente, governador, senador, deputados
  const ordem = [1, 3, 5, 6, 7, 8];
  cargos.sort((a, b) => (ordem.indexOf(a.codigo) + 99) % 99 - (ordem.indexOf(b.codigo) + 99) % 99);
  return {
    uf, mu, zona: z, secao: s, local: bu.local || null, status: 'totalizada', fase: bu.fase, aptos, comparecimento: comp,
    emissao: bu.emissao, abertura: bu.abertura, encerramento: bu.encerramento,
    urna: { tipo: bu.tipoUrna, versao: bu.versao, numeroInterno: bu.numeroInterno, codigoCarga: bu.codigoCarga, serieFlash: bu.serieFlash },
    biometria: bu.biometria, liberadosCodigo: bu.liberadosCodigo, apuracaoSA: bu.apuracaoSA, ...extra, cargos, source,
  };
}
