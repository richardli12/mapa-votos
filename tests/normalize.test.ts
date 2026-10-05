import { describe, expect, it } from 'vitest';
import { normalizeProgress, normalizeResult, officialTime } from '../server/tse/normalize.ts';
import { decodePayload } from '../server/tse/upstream.ts';
import { num } from '../shared/format.ts';

// Arquivo sintético no formato EA20 ("-u") da divulgação 2026 — valores inventados.
const raw = {
  ele: '6259', t: '1', f: 'o', tpabr: 'uf', cdabr: 'sc', dg: '04/10/2026', hg: '19:10:00', dt: '04/10/2026', ht: '19:09:41',
  dv: 's', tf: 'n', and: 'p', md: 'n',
  s: { ts: '1000', st: '250', pst: '25,00', pstn: '25' },
  e: { te: '100000', est: '25000', c: '20000', pc: '80,00', pcn: '80', a: '5000', pa: '20,00', pan: '20' },
  v: { tv: '20000', vv: '18800', vnom: '18000', vl: '800', vb: '500', pvbn: '2,5', tvn: '700', ptvnn: '3,5' },
  carg: [{
    cd: '6', nmn: 'Deputado Federal', nv: '3', qe: '6267',
    fed: [{ n: '101', sg: 'PT/PC do B/PV', nm: 'FEDERAÇÃO BRASIL DA ESPERANÇA' }],
    agr: [
      { n: '1', nm: 'FEDERAÇÃO BRASIL DA ESPERANÇA', tp: 'f', com: 'PT / PCDOB / PV', vag: '0', par: [
        { n: '13', sg: 'PT', nm: 'PARTIDO DOS TRABALHADORES', nfed: '101', tvtl: '500', cand: [
          { n: '1301', sqcand: '11', nm: 'ANA TESTE', nmu: 'ANA', seq: '1', e: 'n', st: '', vap: '9000', pvap: '50,00', pvapn: '50', dvt: 'Válido' },
          { n: '1302', sqcand: '12', nm: 'BETO TESTE', nmu: 'BETO', seq: '3', e: 'n', st: '', vap: '1000', pvap: '5,56', pvapn: '5,555', dvt: 'Válido' },
        ] },
      ] },
      { n: '2', nm: 'PARTIDO LIBERAL', tp: 'i', com: 'PL', vag: '0', par: [
        { n: '22', sg: 'PL', nm: 'PARTIDO LIBERAL', nfed: '', tvtl: '300', cand: [
          { n: '2201', sqcand: '21', nm: 'CARLA TESTE', nmu: 'CARLA', seq: '2', e: 'n', st: '', vap: '8000', pvap: '44,44', pvapn: '44,444', dvt: 'Válido' },
        ] },
      ] },
    ],
  }],
};

describe('normalização EA20', () => {
  const r = normalizeResult(raw, { scope: { level: 'uf', uf: 'sc' }, scopeName: 'Santa Catarina', source: 'tse', verified: true, round: 1, photo: (id) => `/foto/${id}` });
  it('lê totais, progresso e cargo', () => {
    expect(r.cargo).toBe('depfederal');
    expect(r.seats).toBe(3);
    expect(r.quotient).toBe(6267);
    expect(r.status).toBe('apurando');
    expect(r.totals.pctCounted).toBe(25);
    expect(r.totals.turnoutPct).toBe(80);
    expect(r.totals.blankPct).toBe(2.5);
    expect(r.updatedAt).toBe('2026-10-04T22:09:41.000Z');
  });
  it('ordena candidatos e monta partidos com legenda e federação', () => {
    expect(r.candidates.map((c) => c.name)).toEqual(['ANA', 'CARLA', 'BETO']);
    expect(r.candidates[0].federation).toBe('PT/PC do B/PV');
    expect(r.candidates[0].photo).toBe('/foto/11');
    const pt = r.parties.find((p) => p.party === 'PT')!;
    expect(pt.votes).toBe(10500);
    expect(pt.legend).toBe(500);
  });
  it('projeta cadeiras durante a apuração quando não há projeção oficial', () => {
    expect(r.candidates.filter((c) => c.projected).map((c) => c.name).sort()).toEqual(['ANA', 'BETO', 'CARLA']);
    expect(r.candidates.every((c) => !c.elected)).toBe(true);
  });
  it('cores são estáveis por partido', () => {
    expect(r.candidates.find((c) => c.party === 'PT')!.color).toBe(7);
    expect(r.candidates.find((c) => c.party === 'PL')!.color).toBe(0);
  });
});

describe('utilitários', () => {
  it('converte números no padrão TSE', () => {
    expect(num('12,34')).toBe(12.34);
    expect(num('1.234')).toBe(1234);
    expect(num('34122892')).toBe(34122892);
    expect(num('')).toBe(0);
    expect(num(undefined)).toBe(0);
  });
  it('horário oficial é de Brasília', () => {
    expect(officialTime('04/10/2026', '17:00:00')).toBe('2026-10-04T20:00:00.000Z');
    expect(officialTime('', '')).toBeNull();
  });
  it('decodifica JSON puro e JWS', () => {
    expect(decodePayload('{"a":1}')).toEqual({ value: { a: 1 }, verified: null });
    const jws = `${Buffer.from('{"alg":"EdDSA","kid":"x"}').toString('base64url')}.${Buffer.from('{"b":2}').toString('base64url')}.c2ln`;
    expect(decodePayload(jws)).toEqual({ value: { b: 2 }, verified: false });
  });
  it('EA14 por UF', () => {
    const rows = normalizeProgress({ abr: [{ tpabr: 'uf', cdabr: 'AC', and: 'p', dt: '04/10/2026', ht: '15:32:53', s: { pst: '8,11', pstn: '8,105726872' }, e: { pcn: '79,3471' } }] });
    expect(rows[0]).toMatchObject({ uf: 'ac', status: 'apurando', pctCounted: 8.105726872 });
  });
});
