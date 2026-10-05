import { describe, expect, it } from 'vitest';
import { DemoProvider } from '../server/demo/demo.ts';

const d = new DemoProvider();

describe('simulação', () => {
  it('é determinística e consistente entre níveis', async () => {
    const br = await d.result('presidente', { level: 'br' }, 1, 0.5);
    const again = await new DemoProvider().result('presidente', { level: 'br' }, 1, 0.5);
    expect(again.candidates.map((c) => c.votes)).toEqual(br.candidates.map((c) => c.votes));
    const map = await d.map('presidente', { level: 'br' }, [], 1, 0.5);
    const sum = (id: string) => map.areas.reduce((s, a) => s + (a.votes[id] ?? 0), 0);
    for (const c of br.candidates) expect(sum(c.id)).toBe(c.votes);
  });

  it('apuração começa zerada e termina com todos os votos', async () => {
    const start = await d.result('governador', { level: 'uf', uf: 'mg' }, 1, 0);
    expect(start.status).toBe('aguardando');
    expect(start.totals.valid).toBe(0);
    const end = await d.result('governador', { level: 'uf', uf: 'mg' }, 1, 1);
    expect(end.status).toBe('encerrada');
    expect(end.totals.pctCounted).toBe(100);
    expect(end.candidates.some((c) => c.status)).toBe(true);
  });

  it('elege exatamente o número de vagas nas proporcionais', async () => {
    const r = await d.result('depestadual', { level: 'uf', uf: 'df' }, 1, 1);
    expect(r.cargoLabel).toBe('Deputado Distrital');
    expect(r.candidates.filter((c) => c.elected).length).toBe(24);
    const seats = r.parties.reduce((s, p) => s + (p.seats ?? 0), 0);
    expect(seats).toBe(24);
  });

  it('senado elege duas vagas', async () => {
    const r = await d.result('senador', { level: 'uf', uf: 'sp' }, 1, 1);
    expect(r.candidates.filter((c) => c.elected).length).toBe(2);
  });
});
