import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveProvider } from '../server/tse/live.ts';

// Fonte falsa com a mesma árvore de arquivos da divulgação oficial (conteúdo sintético).
const cfg = {
  f: 'o', dg: '04/10/2026', hg: '18:00:00',
  arq: [
    { tp: 'ft', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>' },
    { tp: 'cm', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/config' },
    { tp: 'ab', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>' },
    { tp: 'u', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>' },
  ],
  pl: [
    { cd: '452', c: 'ele2024', dt: '06/10/2024', e: [{ cd: '619', t: '1', tp: '3', abr: [{ cd: 'br', cp: [{ cd: '11' }] }] }] },
    { cd: '700', c: 'ele2026', dt: '04/10/2026', e: [
      { cd: '6257', t: '1', tp: '2', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
      { cd: '6259', t: '1', tp: '2', abr: [{ cd: 'sc', cp: [{ cd: '3' }, { cd: '5' }, { cd: '6' }, { cd: '7' }] }, { cd: 'df', cp: [{ cd: '3' }, { cd: '8' }] }] },
    ] },
  ],
};
const cm = { f: 'o', abr: [{ cd: 'sc', mu: [{ cd: '80098', cdi: '4200051', nm: 'ÁGUAS DE CHAPECÓ', c: 'n' }, { cd: '81051', cdi: '4205407', nm: 'FLORIANÓPOLIS', c: 's' }] }] };
const result = (tpabr: string, cdabr: string, cd: string, ele: string) => ({
  ele, t: '1', f: 'o', tpabr, cdabr, dg: '04/10/2026', hg: '20:00:00', dt: '04/10/2026', ht: '19:59:00', dv: 's', tf: 'n', and: 'p',
  s: { ts: '100', st: '40', pst: '40,00', pstn: '40' }, e: { te: '1000', c: '320', pcn: '80', a: '80', pan: '20' },
  v: { tv: '320', vv: '300', vnom: '300', vb: '10', pvbn: '3,125', tvn: '10', ptvnn: '3,125' },
  carg: [{ cd, nmn: cd === '1' ? 'Presidente' : 'Governador', nv: '1', agr: [
    { n: '1', nm: 'A', tp: 'i', par: [{ n: '22', sg: 'PL', nm: 'PARTIDO LIBERAL', cand: [{ n: '22', sqcand: '1001', nm: 'FULANO', nmu: 'FULANO', seq: '1', e: 'n', st: '', vap: '200', pvap: '66,67', pvapn: '66,666' }] }] },
    { n: '2', nm: 'B', tp: 'i', par: [{ n: '13', sg: 'PT', nm: 'PARTIDO DOS TRABALHADORES', cand: [{ n: '13', sqcand: '1002', nm: 'BELTRANO', nmu: 'BELTRANO', seq: '2', e: 'n', st: '', vap: '100', pvap: '33,33', pvapn: '33,333' }] }] },
  ] }],
});
const files: Record<string, unknown> = {
  '/oficial/comum/config/ele-c.json': cfg,
  '/oficial/ele2026/6259/config/mun-e006259-cm.json': cm,
  '/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json': result('br', 'br', '1', '6257'),
  '/oficial/ele2026/6257/dados/sc/sc-c0001-e006257-u.json': result('uf', 'sc', '1', '6257'),
  '/oficial/ele2026/6259/dados/sc/sc-c0003-e006259-u.json': result('uf', 'sc', '3', '6259'),
  '/oficial/ele2026/6259/dados/sc/sc80098-c0003-e006259-u.json': result('mu', '80098', '3', '6259'),
};

let server: Server;
let hits: string[] = [];
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url!);
    const body = files[req.url!];
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('provedor ao vivo', () => {
  it('cai para a segunda fonte quando a primeira não responde', async () => {
    const p = new LiveProvider({ BP_API_URL: 'http://127.0.0.1:9', TSE_URL: base } as NodeJS.ProcessEnv);
    const r = await p.result('presidente', { level: 'br' }, 1);
    expect(r.source).toBe('tse');
    expect(r.candidates[0]).toMatchObject({ name: 'FULANO', votes: 200, party: 'PL' });
    expect(r.candidates[0].photo).toContain(encodeURIComponent('/oficial/ele2026/6257/fotos/br/1001.jpeg'));
    expect(r.totals.pctCounted).toBe(40);
  });

  it('encontra a eleição estadual certa, município e nomes', async () => {
    hits = [];
    const p = new LiveProvider({ AGORA_SOURCES: 'tse', TSE_URL: base } as NodeJS.ProcessEnv);
    const uf = await p.result('governador', { level: 'uf', uf: 'sc' }, 1);
    expect(uf.cargo).toBe('governador');
    const mu = await p.result('governador', { level: 'mu', uf: 'sc', mu: '80098' }, 1);
    expect(mu.scopeName).toBe('ÁGUAS DE CHAPECÓ (SC)');
    expect(hits).toContain('/oficial/ele2026/6259/dados/sc/sc80098-c0003-e006259-u.jws');
    const munis = await p.municipalities();
    expect(munis.find((m) => m.code === '81051')).toMatchObject({ capital: true, ibge: '4205407' });
  });

  it('mapa carrega as áreas aos poucos e não fica pendente para sempre', async () => {
    const p = new LiveProvider({ AGORA_SOURCES: 'tse', TSE_URL: base } as NodeJS.ProcessEnv);
    await p.map('governador', { level: 'uf', uf: 'sc' }, [], 1);
    await new Promise((r) => setTimeout(r, 300));
    const m = await p.map('governador', { level: 'uf', uf: 'sc' }, [], 1);
    expect(m.total).toBe(2);
    expect(m.pending).toBe(0);
    expect(m.areas.map((a) => a.code)).toEqual(['80098']);
  });

  it('cargo fora da disputa gera erro claro', async () => {
    const p = new LiveProvider({ AGORA_SOURCES: 'tse', TSE_URL: base } as NodeJS.ProcessEnv);
    await expect(p.result('senador', { level: 'uf', uf: 'df' }, 1)).rejects.toThrow(/não está em disputa/);
  });
});
