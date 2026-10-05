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
import { agregarPorLocal, resumir } from '../server/urna/resumo.ts';

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

  it('locais de votação somam as seções e posicionam o candidato em foco', async () => {
    const sec = await urnas.secoes('presidente', muni.uf, muni.code, null, [], 1, 1);
    const r = await demo.result('presidente', { level: 'mu', uf: muni.uf, mu: muni.code }, 1, 1);
    const foco = r.candidates[2].number;
    const loc = await urnas.locais('presidente', muni.uf, muni.code, null, [foco], 1, 1);
    expect(loc.locais.reduce((s, l) => s + l.secoes, 0)).toBe(sec.secoes.length);
    expect(loc.locais.reduce((s, l) => s + l.nom, 0)).toBe(sec.secoes.reduce((s, x) => s + x.nom, 0));
    expect(loc.locais.reduce((s, l) => s + (l.v[foco] ?? 0), 0)).toBe(sec.secoes.reduce((s, x) => s + (x.v[foco] ?? 0), 0));
    for (const l of loc.locais) {
      const ord = Object.values(l.v).sort((a, b) => b - a);
      if (l.v[foco]) expect(ord.indexOf(l.v[foco]) + 1).toBeLessThanOrEqual(l.pos!);
    }
  });
});

describe('agregação por local', () => {
  const s = (z: number, l: number | null, v: Record<string, number>, st: 'totalizada' | 'aguardando' | 'agregada' = 'totalizada') =>
    ({ z, s: 1, l, st, apt: 10, comp: 8, nom: Object.values(v).reduce((a, b) => a + b, 0), leg: 0, bra: 1, nul: 1, v });
  it('soma totalizadas, ignora agregadas e conta pendentes', () => {
    const out = agregarPorLocal([
      s(1, 5, { 13: 3, 22: 2 }), s(1, 5, { 13: 1, 22: 4 }), s(1, 5, {}, 'aguardando'), s(1, 6, { 22: 5 }), s(1, 6, { 13: 9 }, 'agregada'), s(1, null, { 13: 1 }),
    ], ['13']);
    expect(out.map((l) => l.id)).toEqual(['1-5', '1-6']);
    expect(out[0]).toMatchObject({ secoes: 3, totalizadas: 2, apt: 20, v: { 13: 4, 22: 6 }, pos: 2 });
    expect(out[1]).toMatchObject({ secoes: 1, v: { 22: 5 } });
    expect(out[1].pos).toBeUndefined();
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

  it('ignora espelho que responde 200 com conteúdo que não é o arquivo e vai ao TSE', async () => {
    const espelho = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>não encontrado</html>'); });
    const lixo = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"message":"not found"}'); });
    await Promise.all([espelho, lixo].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))));
    try {
      for (const bp of [espelho, lixo]) {
        const live = new LiveProvider({ AGORA_SOURCES: 'bp,tse', BP_API_URL: `http://127.0.0.1:${(bp.address() as AddressInfo).port}`, TSE_URL: base } as NodeJS.ProcessEnv);
        // força o espelho na frente também para os arquivos de urna
        const u = new LiveUrnas(live, { URNA_SOURCES: 'bp,tse' } as NodeJS.ProcessEnv);
        const sec = await u.secoes('governador', 'ac', '01120', null, [], 1);
        expect(sec.secoes.find((s) => s.s === 1)).toMatchObject({ st: 'totalizada', v: { 92: 2 } });
        expect(sec.falhas).toBeUndefined();
      }
    } finally { espelho.close(); lixo.close(); }
  });

  it('acesso recusado pelo TSE vira falha com motivo, não seção zerada em silêncio', async () => {
    const bloqueio = createServer((req, res) => {
      if (req.url!.includes('/dados/')) { res.writeHead(403); res.end(); return; }
      const body = req.url!.endsWith('ele-c.json') ? cfg : req.url!.endsWith('-cs.json') ? cs : null;
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(body ? JSON.stringify(body) : '');
    });
    await new Promise<void>((r) => bloqueio.listen(0, '127.0.0.1', r));
    try {
      const live = new LiveProvider({ AGORA_SOURCES: 'tse', TSE_URL: `http://127.0.0.1:${(bloqueio.address() as AddressInfo).port}` } as NodeJS.ProcessEnv);
      const u = new LiveUrnas(live, {} as NodeJS.ProcessEnv);
      const sec = await u.secoes('governador', 'ac', '01120', null, [], 1);
      expect(sec.falhas).toBe(2);
      expect(sec.aviso).toMatch(/403/);
      const loc = await u.locais('governador', 'ac', '01120', null, [], 1);
      expect(loc.falhas).toBe(2);
      const d = await u.diagnostico('ac', '01120', 8, 1, 1);
      expect(d.ok).toBe(false);
      expect(d.passos.some((p) => p.status === 403)).toBe(true);
    } finally { bloqueio.close(); }
  });
});
