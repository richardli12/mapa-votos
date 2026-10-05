// Distribuição de cadeiras nas eleições proporcionais (Código Eleitoral, arts. 106–109, Lei 14.211/2021):
// quociente eleitoral, quociente partidário (com cláusula de 10% do QE) e sobras pelas maiores médias
// (agremiações com ≥ 80% do QE e candidatos com ≥ 20% do QE; depois, todas as agremiações).

export interface SeatGroup { id: string; legend: number; cands: { id: string; votes: number }[] }
export interface SeatOutcome {
  quotient: number;
  seatsByGroup: Map<string, number>;
  elected: Map<string, 'QP' | 'média'>;
}

export function electoralQuotient(valid: number, seats: number): number {
  if (seats <= 0) return 0;
  const q = valid / seats;
  return q - Math.floor(q) > 0.5 ? Math.ceil(q) : Math.floor(q);
}

export function allocateSeats(groups: SeatGroup[], seats: number): SeatOutcome {
  const totals = new Map(groups.map((g) => [g.id, g.legend + g.cands.reduce((s, c) => s + c.votes, 0)]));
  const valid = [...totals.values()].reduce((s, v) => s + v, 0);
  const qe = electoralQuotient(valid, seats);
  const seatsByGroup = new Map(groups.map((g) => [g.id, 0]));
  const elected = new Map<string, 'QP' | 'média'>();
  if (!valid || !qe) return { quotient: qe, seatsByGroup, elected };

  const ranked = new Map(groups.map((g) => [g.id, [...g.cands].sort((a, b) => b.votes - a.votes)]));
  let left = seats;
  const elect = (gid: string, cid: string, how: 'QP' | 'média') => {
    elected.set(cid, how); seatsByGroup.set(gid, seatsByGroup.get(gid)! + 1); left--;
  };

  // 1) Quociente partidário: só candidatos com votação ≥ 10% do QE.
  for (const g of groups) {
    const qp = Math.floor(totals.get(g.id)! / qe);
    const eligible = ranked.get(g.id)!.filter((c) => c.votes >= 0.1 * qe);
    for (const c of eligible.slice(0, Math.min(qp, eligible.length))) if (left > 0) elect(g.id, c.id, 'QP');
  }

  const nextCand = (gid: string, min: number) => ranked.get(gid)!.find((c) => !elected.has(c.id) && c.votes >= min && c.votes > 0);
  const round = (groupOk: (gid: string) => boolean, min: number): boolean => {
    let best: { gid: string; avg: number } | null = null;
    for (const g of groups) {
      if (!groupOk(g.id) || !nextCand(g.id, min)) continue;
      const avg = totals.get(g.id)! / (seatsByGroup.get(g.id)! + 1);
      if (!best || avg > best.avg) best = { gid: g.id, avg };
    }
    if (!best) return false;
    elect(best.gid, nextCand(best.gid, min)!.id, 'média');
    return true;
  };
  // 2) Sobras: agremiações com ≥ 80% do QE e candidatos com ≥ 20% do QE.
  while (left > 0 && round((gid) => totals.get(gid)! >= 0.8 * qe, 0.2 * qe));
  // 3) Sobras restantes: todas as agremiações, pelas maiores médias.
  while (left > 0 && round(() => true, 0));
  return { quotient: qe, seatsByGroup, elected };
}
