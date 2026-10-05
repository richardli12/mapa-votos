import type { CargoId, MapArea, MapPayload, MetaPayload, Municipality, ProgressRow, Result, Scope } from '../shared/types.ts';

export interface Provider {
  meta(round: number): Promise<MetaPayload>;
  municipalities(): Promise<Municipality[]>;
  /** `t` (0–1) só vale na simulação: posiciona a "máquina do tempo" da apuração */
  result(cargo: CargoId, scope: Scope, round: number, t?: number): Promise<Result>;
  map(cargo: CargoId, parent: Scope, focus: string[], round: number, t?: number): Promise<MapPayload>;
  progress(round: number, t?: number): Promise<ProgressRow[]>;
  photo?(path: string): Promise<{ body: Buffer; type: string } | null>;
}

/** Resume um resultado em uma área do mapa. Todos os candidatos quando ≤ 30; senão top 6 + foco. */
export function areaFromResult(code: string, r: Result, focus: string[]): MapArea {
  const votes: Record<string, number> = {};
  const list = r.candidates.length <= 30 ? r.candidates : r.candidates.slice(0, 6);
  for (const c of list) votes[c.id] = c.votes;
  for (const id of focus) {
    const c = r.candidates.find((x) => x.id === id);
    if (c) votes[c.id] = c.votes;
  }
  const area: MapArea = {
    code, pctCounted: r.totals.pctCounted, turnoutPct: r.totals.turnoutPct, abstentionPct: r.totals.abstentionPct,
    blankPct: r.totals.blankPct, nullPct: r.totals.nullPct, valid: r.totals.valid, electorate: r.totals.electorate,
    votes, status: r.status,
  };
  if (r.candidates.length > 30 || r.seats > 2) {
    area.partyVotes = Object.fromEntries(r.parties.map((p) => [p.party, p.votes]));
    const seats = r.parties.filter((p) => p.seats);
    if (seats.length) area.partySeats = Object.fromEntries(seats.map((p) => [p.party, p.seats!]));
  }
  const withStatus = r.candidates.filter((c) => c.status);
  if (withStatus.length && withStatus.length <= 40) area.statuses = Object.fromEntries(withStatus.filter((c) => c.status !== 'Não eleito' && c.status !== 'Suplente').map((c) => [c.id, c.status]));
  if (r.seats <= 2) {
    const winners = r.candidates.filter((c) => c.elected || c.projected).map((c) => c.id);
    if (winners.length) area.winners = winners;
  }
  return area;
}
