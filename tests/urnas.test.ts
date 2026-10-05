import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemoProvider } from '../server/demo/demo.ts';
import { MUNICIPALITIES } from '../server/geo-index.ts';
import { LiveProvider } from '../server/tse/live.ts';
import { decodeBU } from '../server/urna/bu.ts';
import { DemoUrnas } from '../server/urna/demo.ts';
import { escolherUrna, LiveUrnas } from '../server/urna/live.ts';
import { resumir } from '../server/urna/resumo.ts';

const BU = readFileSync(new URL('./fixtures/bu/s02100-0112000080001.bu', import.meta.url));

describe('boletim de urna (ASN.1)', () => {
  it('decodifica identificação, horários e votos', () => {
    const bu = decodeBU(BU);
    expect(bu).toMatchObject({ fase: 'simulado', municipio: 1120, zona: 8, local: 1, secao: 1, abertura: '2022-10-02T17:08:43', encerramento: '2022-10-02T17:17:23' });
    expect(bu.eleicoes.map((e) => e.idEleicao)).toEqual([2102, 2101]);
    const gov = bu.eleicoes[0].cargos.find((c) => c.codigo === 3)!;
    expect(gov.tipo).toBe('majoritario');
    expect(gov.votos.filter((v) => v.tipo === 'nominal').map((v) => [v.numero, v.qtd])).toEqual([[91, 1], [92, 2], [93, 1]]);
  });
  it('lê também o boletim de treinamento de 2024 (prefeito e vereador)', () => {
    const bu = decodeBU(readFileSync(new URL('./fixtures/bu/t02410-0000200020008.bu', import.meta.url)));
    expect(bu.eleicoes[0].cargos.map((c) => c.codigo).sort()).toEqual([11, 13]);
  });
  it('rejeita arquivo que não é BU', () => {
    expect(() => decodeBU(new Uint8Array([1, 2, 3]))).toThrow();
  });
  it('resume a seção por cargo', () => {
    const r = resumir(decodeBU(BU), 8, 1, 'governador', 'ac', new Set());
    expect(r).toMatchObject({ st: 'totalizada', l: 1, v: { 91: 1, 92: 2, 93: 1 } });
    expect(r.apt).toBe(5);
  });
});

describe('índice da seção (aux)', () => {
  it('escolhe a urna válida mais recente com .bu', () => {
    expect(escolherUrna({ hashes: [
      { hash: 'aaa', st: 'Totalizado', arq: [{ nm: 'o1.bu' }] },
      { hash: 'bbb', st: 'Excluído', arq: [{ nm: 'o2.bu' }] },
      { hash: 'ccc', st: 'Recebido', nmarq: ['o3.logjez', 'o3.bu'] },
    ] })).toEqual({ hash: 'ccc', arquivo: 'o3.bu' });
    expect(escolherUrna({ hashes: [{ hash: '0' }] })).toBeNull();
  });
});

describe('simulação por urna', () => {
  const demo = new DemoProvider();
  const urnas = new DemoUrnas(demo);
  const muni = MUNICIPALITIES.find((m) => m.name === 'ÁGUAS DE CHAPECÓ')!;

  it('estrutura coerente: cada seção pertence a um local', async () => {
    const est = await urnas.estrutura(muni.uf, muni.code, 1, 1);
    const daZona = est.zonas.flatMap((z) => z.secoes.map((s) => `${z.zona}:${s.s}`));
    const dosLocais = est.locais!.flatMap((l) => l.secoes.map((s) => `${l.zona}:${s}`));
    expect(new Set(daZona).size).toBe(daZona.length);
    expect(dosLocais.sort()).toEqual([...daZona].sort());
    expect(est.locais!.every((l) => l.nome && l.lat && l.lon)).toBe(true);
  });

  it('soma das seções acompanha o resultado do município', async () => {
    const sec = await urnas.secoes('presidente', muni.uf, muni.code, null, [], 1, 1);
    const r = await demo.result('presidente', { level: 'mu', uf: muni.uf, mu: muni.code }, 1, 1);
    const total = (n: string) => sec.secoes.reduce((s, x) => s + (x.v[n] ?? 0), 0);
    const valid = sec.secoes.reduce((s, x) => s + x.nom, 0);
    for (const c of r.candidates.slice(0, 3)) expect(Math.abs((total(c.number) / valid) * 100 - c.pct)).toBeLessThan(1);
  });

  it('boletim tem todos os cargos e totaliza aos poucos', async () => {
    const est = await urnas.estrutura(muni.uf, muni.code, 1, 1);
    const z = est.zonas[0];
    const b = await urnas.boletim(muni.uf, muni.code, z.zona, z.secoes[0].s, 1, 1);
    expect(b.cargos.map((c) => c.cargo)).toEqual(['presidente', 'governador', 'senador', 'depfederal', 'depestadual']);
    for (const c of b.cargos.filter((x) => x.cargo !== 'senador')) expect(c.nominal + c.legenda + c.brancos + c.nulos).toBe(c.comparecimento);
    const cedo = await urnas.secoes('presidente', muni.uf, muni.code, null, [], 1, 0.1);
    const tarde = await urnas.secoes('presidente', muni.uf, muni.code, null, [], 1, 1);
    const tot = (x: typeof cedo) => x.secoes.filter((s) => s.st === 'totalizada').length;
    expect(tot(cedo)).toBeLessThan(tot(tarde));
    expect(tot(tarde)).toBe(tarde.secoes.length);
  });
});

describe('urnas ao vivo (fonte falsa com a árvore oficial)', () => {
  let server: Server; let base = '';
  const cfg = {
    arq: [], pl: [{ cd: '3220', c: 'ele2026', dt: '04/10/2026', e: [
      { cd: '6257', t: '1', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
      { cd: '6259', t: '1', abr: [{ cd: 'ac', cp: [{ cd: '3' }] }] },
    ] }],
  };
  const cs = { abr: [{ cd: 'AC', mu: [{ cd: '01120', nm: 'ACRELÂNDIA', zon: [{ cd: '0008', sec: [{ ns: '0001', nsp: '0001' }, { ns: '0002', nsp: '0001' }, { ns: '0003', nsp: '0003' }] }] }] }] };
  const aux = { hashes: [{ hash: 'abc123', st: 'Totalizado', arq: [{ nm: 'o03220-0112000080001.bu' }] }] };
  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = req.url!;
      const json = (b: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (u === '/oficial/comum/config/ele-c.json') return json(cfg);
      if (u === '/oficial/ele2026/arquivo-urna/3220/config/ac/ac-p003220-cs.json') return json(cs);
      if (u === '/oficial/ele2026/arquivo-urna/3220/dados/ac/01120/0008/0001/p003220-ac-m01120-z0008-s0001-aux.json') return json(aux);
      if (u === '/oficial/ele2026/arquivo-urna/3220/dados/ac/01120/0008/0001/abc123/o03220-0112000080001.bu') { res.end(BU); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('lê zonas e seções, marca agregadas e soma o que foi totalizado', async () => {
    const live = new LiveProvider({ AGORA_SOURCES: 'tse', TSE_URL: base } as NodeJS.ProcessEnv);
    const u = new LiveUrnas(live, {} as NodeJS.ProcessEnv);
    const est = await u.estrutura('ac', '01120', 1);
    expect(est.zonas).toEqual([{ zona: 8, secoes: [{ s: 1 }, { s: 2, principal: 1 }, { s: 3 }] }]);
    const sec = await u.secoes('governador', 'ac', '01120', null, [], 1);
    expect(sec.pending).toBe(0);
    const by = new Map(sec.secoes.map((s) => [s.s, s]));
    expect(by.get(1)).toMatchObject({ st: 'totalizada', l: 1, v: { 91: 1, 92: 2, 93: 1 } });
    expect(by.get(2)!.st).toBe('agregada');
    expect(by.get(3)!.st).toBe('aguardando');
    const b = await u.boletim('ac', '01120', 8, 1, 1);
    expect(b.status).toBe('totalizada');
    expect(b.hash).toBe('abc123');
    expect(b.cargos.find((c) => c.codigo === 3)!.votos[0]).toMatchObject({ numero: 92, qtd: 2 });
  });
});
