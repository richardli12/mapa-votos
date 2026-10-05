// Converte os arquivos oficiais de divulgação do TSE (EA20 "-u", EA14 "-ab") para o modelo normalizado.
import { assignColors } from '../../shared/colors.ts';
import { cargoFromCode, cargoInfo, cargoLabel } from '../../shared/cargos.ts';
import { allocateSeats, type SeatGroup } from '../../shared/seats.ts';
import { num, titleCase } from '../../shared/format.ts';
import type { Candidate, CountStatus, PartyResult, ProgressRow, Result, Scope, SourceKind, Totals } from '../../shared/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

export function officialTime(date?: string, time?: string): string | null {
  if (!date || !time || !/^\d{2}\/\d{2}\/\d{4}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;
  const [d, m, y] = date.split('/');
  const t = new Date(`${y}-${m}-${d}T${time}-03:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

export function countStatus(and: unknown, pctCounted: number): CountStatus {
  if (and === 'f' || pctCounted >= 100) return 'encerrada';
  if (and === 'p' || pctCounted > 0) return 'apurando';
  return 'aguardando';
}

export function totalsFrom(raw: Raw): Totals {
  const s = raw.s ?? {}, e = raw.e ?? {}, v = raw.v ?? {};
  const pctCounted = num(s.pstn ?? s.pst);
  return {
    sections: num(s.ts), sectionsCounted: num(s.st), pctCounted,
    electorate: num(e.te), turnout: num(e.c), turnoutPct: num(e.pcn ?? e.pc),
    abstention: num(e.a), abstentionPct: num(e.pan ?? e.pa),
    totalVotes: num(v.tv), valid: num(v.vv), nominal: num(v.vnom), legend: num(v.vl),
    blank: num(v.vb), blankPct: num(v.pvbn ?? v.pvb),
    nulls: num(v.tvn), nullPct: num(v.ptvnn ?? v.ptvn),
  };
}

export interface NormalizeOptions {
  scope: Scope;
  scopeName: string;
  source: SourceKind;
  verified: boolean | null;
  round: number;
  /** monta a URL pública da foto a partir do sqcand */
  photo: (sqcand: string) => string | null;
}

export function normalizeResult(raw: Raw, opt: NormalizeOptions): Result {
  const carg = raw.carg?.[0] ?? {};
  const code = num(carg.cd);
  const cargo = cargoFromCode(code) ?? 'presidente';
  const totals = totalsFrom(raw);
  const fedName = new Map<string, string>((carg.fed ?? []).map((f: Raw) => [String(f.n), String(f.sg)]));
  const candidates: Candidate[] = [];
  const parties = new Map<string, PartyResult>();
  const aggSeats: { id: string; seats: number; legend: number; cands: Candidate[] }[] = [];

  for (const agr of carg.agr ?? []) {
    const group: Candidate[] = [];
    let groupLegend = 0;
    for (const par of agr.par ?? []) {
      const sg = String(par.sg ?? '');
      const federation = par.nfed ? fedName.get(String(par.nfed)) : undefined;
      if (!parties.has(sg)) {
        parties.set(sg, {
          party: sg, name: titleCase(String(par.nm ?? sg)), federation,
          votes: 0, legend: 0, pct: 0, candidates: 0, elected: 0, color: -1,
        });
      }
      const p = parties.get(sg)!;
      p.legend += num(par.tvtl);
      groupLegend += num(par.tvtl);
      for (const c of par.cand ?? []) {
        const votes = num(c.vap);
        const cand: Candidate = {
          id: String(c.sqcand), number: String(c.n), name: String(c.nmu ?? c.nm), fullName: String(c.nm ?? c.nmu),
          party: sg, partyName: p.name, federation,
          coalition: agr.tp === 'i' ? undefined : titleCase(String(agr.nm ?? '')),
          coalitionParties: agr.com ? String(agr.com) : undefined,
          votes, pct: num(c.pvapn ?? c.pvap), elected: c.e === 's', status: String(c.st ?? ''),
          valid: !c.dvt || String(c.dvt).startsWith('Válido'),
          runningMates: (c.vs ?? []).map((r: Raw) => ({ name: String(r.nmu ?? r.nm), party: String(r.sgp ?? ''), role: String(r.tp ?? '') })),
          birth: c.dt ? String(c.dt) : undefined,
          photo: opt.photo(String(c.sqcand)), color: -1,
        };
        p.votes += votes; p.candidates += 1; if (cand.elected) p.elected += 1;
        candidates.push(cand); group.push(cand);
      }
    }
    aggSeats.push({ id: String(agr.n ?? aggSeats.length), seats: num(agr.vag), legend: groupLegend, cands: group });
  }

  // Proporcionais: cadeiras da agregação vão aos seus candidatos mais votados.
  const seatsByParty = new Map<string, number>();
  const proportional = cargoInfo(cargo).proportional;
  const officialSeats = aggSeats.some((a) => a.seats > 0);
  const counting = raw.and !== 'f' && !candidates.some((c) => c.elected);
  if (proportional && officialSeats) {
    for (const a of aggSeats) {
      if (!a.seats) continue;
      const top = [...a.cands].filter((c) => c.valid).sort((x, y) => y.votes - x.votes).slice(0, a.seats);
      for (const c of top) { seatsByParty.set(c.party, (seatsByParty.get(c.party) ?? 0) + 1); if (counting) c.projected = true; }
    }
  } else if (proportional && counting && opt.scope.level === 'uf' && totals.valid > 0) {
    // Sem projeção oficial: aplica as regras de distribuição sobre a contagem parcial.
    const groups: SeatGroup[] = aggSeats.map((a) => ({ id: a.id, legend: a.legend, cands: a.cands.filter((c) => c.valid).map((c) => ({ id: c.id, votes: c.votes })) }));
    const res = allocateSeats(groups, num(carg.nv));
    for (const c of candidates) if (res.elected.has(c.id)) { c.projected = true; seatsByParty.set(c.party, (seatsByParty.get(c.party) ?? 0) + 1); }
  }

  candidates.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const colors = assignColors(candidates, (c) => c.party, (c) => c.id);
  for (const c of candidates) c.color = colors.get(c.id) ?? -1;

  const partyList = [...parties.values()];
  for (const p of partyList) p.votes += p.legend;
  const partyTotal = partyList.reduce((s, p) => s + p.votes, 0) || 1;
  const partyColors = assignColors(partyList, (p) => p.party, (p) => p.party);
  for (const p of partyList) {
    p.pct = (p.votes / partyTotal) * 100;
    p.color = partyColors.get(p.party) ?? -1;
    const s = seatsByParty.get(p.party);
    if (s || p.elected) p.seats = Math.max(s ?? 0, p.elected);
  }
  partyList.sort((a, b) => b.votes - a.votes);

  return {
    cargo, cargoLabel: titleCase(String(carg.nmn ?? cargoLabel(cargo, opt.scope.uf))),
    scope: opt.scope, scopeName: opt.scopeName,
    seats: num(carg.nv) || 1, quotient: carg.qe ? num(carg.qe) : undefined,
    status: countStatus(raw.and, totals.pctCounted), mathDefined: raw.md === 'e',
    updatedAt: officialTime(raw.dt, raw.ht) ?? officialTime(raw.dg, raw.hg),
    totals, candidates, parties: partyList,
    source: opt.source, verified: opt.verified, round: num(raw.t) || opt.round,
  };
}

/** EA14 — acompanhamento por UF (arquivo "-ab"). */
export function normalizeProgress(raw: Raw): ProgressRow[] {
  return (raw.abr ?? []).filter((a: Raw) => a.tpabr === 'uf').map((a: Raw) => {
    const pct = num(a.s?.pstn ?? a.s?.pst);
    return {
      uf: String(a.cdabr).toLowerCase(), pctCounted: pct, turnoutPct: num(a.e?.pcn ?? a.e?.pc),
      status: countStatus(a.and, pct), updatedAt: officialTime(a.dt, a.ht),
    } satisfies ProgressRow;
  });
}
