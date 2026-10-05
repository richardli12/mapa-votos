// Roteador da API do Radar Eleições (/api/*), compartilhado pelo servidor local (server/index.ts)
// e pela função serverless da Vercel (server/vercel.ts).
// Modo de dados: AGORA_MODE=live (BP → TSE) | demo (simulação) | auto (ao vivo, com simulação se a fonte falhar).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { CARGOS } from '../shared/cargos.ts';
import { UFS } from '../shared/ufs.ts';
import type { CargoId, Scope } from '../shared/types.ts';
import { DemoProvider } from './demo/demo.ts';
import type { Provider } from './provider.ts';
import { LiveProvider } from './tse/live.ts';
import { DemoUrnas } from './urna/demo.ts';
import { LiveUrnas } from './urna/live.ts';
import type { UrnasProvider } from './urna/provider.ts';
import { nomesDosResultados } from './urna/resumo.ts';

export const MODE = (process.env.AGORA_MODE ?? 'auto') as 'live' | 'demo' | 'auto';

const demo = new DemoProvider();
const live = MODE === 'demo' ? null : new LiveProvider();
const demoUrnas = new DemoUrnas(demo);
const liveUrnas = live ? new LiveUrnas(live) : null;

/** No modo auto, testa a fonte ao vivo (com prazo curto) e cai para a simulação se ela não responder. */
let liveOk: { ok: boolean; at: number } = { ok: false, at: 0 };
async function provider(req: URL): Promise<Provider> {
  const forced = req.searchParams.get('fonte');
  if (forced === 'demo' || MODE === 'demo' || !live) return demo;
  if (forced === 'live' || MODE === 'live') return live;
  if (Date.now() - liveOk.at > 60_000) {
    const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('prazo')), 6_000).unref?.());
    try { await Promise.race([live.progress(1), deadline]); liveOk = { ok: true, at: Date.now() }; } catch { liveOk = { ok: false, at: Date.now() }; }
  }
  return liveOk.ok ? live : demo;
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function parseCargo(v: string | null): CargoId {
  if (v && CARGOS.some((c) => c.id === v)) return v as CargoId;
  throw new HttpError(400, 'Cargo inválido.');
}
function parseScope(u: URL): Scope {
  const uf = u.searchParams.get('uf')?.toLowerCase() || undefined;
  const mu = u.searchParams.get('mu') || undefined;
  if (uf && !UFS.some((x) => x.uf === uf)) throw new HttpError(400, 'UF inválida.');
  if (mu && (!uf || !/^\d{5}$/.test(mu))) throw new HttpError(400, 'Município inválido.');
  return mu ? { level: 'mu', uf, mu } : uf ? { level: 'uf', uf } : { level: 'br' };
}
const parseT = (u: URL) => { const t = u.searchParams.get('t'); return t === null ? undefined : Number(t); };
function parseMunicipio(u: URL): { uf: string; mu: string } {
  const uf = u.searchParams.get('uf')?.toLowerCase() ?? '';
  const mu = u.searchParams.get('mu') ?? '';
  if (!UFS.some((x) => x.uf === uf) || !/^\d{5}$/.test(mu)) throw new HttpError(400, 'Informe a UF e o município (código TSE).');
  return { uf, mu };
}
function parseNum(u: URL, k: string, required: boolean): number | null {
  const v = u.searchParams.get(k);
  if (v === null || v === '') { if (required) throw new HttpError(400, `Parâmetro ${k} obrigatório.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new HttpError(400, `Parâmetro ${k} inválido.`);
  return n;
}
const parseRound = (u: URL) => (u.searchParams.get('turno') === '2' ? 2 : 1);

/**
 * Cache em duas camadas: o navegador sempre revalida (max-age=0), mas a CDN (Vercel ou outra)
 * guarda a resposta por `cdn` segundos e serve a anterior enquanto atualiza — numa noite de
 * eleição, milhares de visitantes viram poucas chamadas à função e à fonte oficial.
 */
function cacheHeader(cdn: number): string {
  return cdn > 0 ? `public, max-age=0, s-maxage=${cdn}, stale-while-revalidate=${Math.max(30, cdn * 3)}` : 'no-store';
}

export function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, cdn = 0) {
  const json = Buffer.from(JSON.stringify(body));
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && json.length > 1024;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheHeader(status === 200 ? cdn : 0),
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(gzip ? gzipSync(json) : json);
}

/** Atende uma requisição /api/*; erros viram JSON { erro }. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  try {
    await route(req, res, u);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    if (!res.headersSent) send(req, res, status, { erro: (e as Error).message });
    else res.end();
  }
}

function urnas(p: Provider): UrnasProvider {
  if (p === demo) return demoUrnas;
  if (!liveUrnas) throw new HttpError(503, 'Fonte de urnas indisponível.');
  return liveUrnas;
}

async function route(req: IncomingMessage, res: ServerResponse, u: URL) {
  const p = await provider(u);
  const round = parseRound(u), t = parseT(u);
  const isDemo = p === demo;
  // Simulação: o relógio anda a cada segundo; com a máquina do tempo (t) a resposta nunca muda.
  const fresh = t !== undefined ? 3600 : isDemo ? 3 : 10;
  switch (u.pathname) {
    case '/api/meta': {
      const meta = await p.meta(round);
      if (isDemo && live && MODE === 'auto') meta.warnings.push('Fonte ao vivo indisponível — exibindo a simulação. Os dados reais aparecem automaticamente quando a fonte responder.');
      return send(req, res, 200, meta, isDemo && MODE === 'auto' ? 10 : 30);
    }
    case '/api/municipios': return send(req, res, 200, await p.municipalities(), 3600);
    case '/api/resultado': return send(req, res, 200, await p.result(parseCargo(u.searchParams.get('cargo')), parseScope(u), round, t), fresh);
    case '/api/mapa': {
      const focus = (u.searchParams.get('foco') ?? '').split(',').filter((x) => /^\d+$/.test(x)).slice(0, 8);
      const cargo = parseCargo(u.searchParams.get('cargo'));
      const scope = parseScope(u);
      if (scope.level === 'br' && u.searchParams.get('detalhe') === 'mu') {
        // Brasil inteiro por município: junta os mapas das 27 UFs.
        const parts = await Promise.all(UFS.map((x) => p.map(cargo, { level: 'uf', uf: x.uf }, focus, round, t)));
        const head = cargo === 'presidente' ? await p.map(cargo, { level: 'br' }, focus, round, t) : null;
        const cands = new Map((head?.candidates ?? parts.flatMap((m) => m.candidates)).map((c) => [c.id, c]));
        const pending = parts.reduce((s, m) => s + m.pending, 0);
        return send(req, res, 200, {
          cargo, parent: { level: 'br' }, areas: parts.flatMap((m) => m.areas), candidates: [...cands.values()],
          pending, total: parts.reduce((s, m) => s + m.total, 0),
          updatedAt: head?.updatedAt ?? parts[0]?.updatedAt ?? null, source: parts[0]?.source ?? 'demo',
        }, pending ? 2 : fresh);
      }
      const m = await p.map(cargo, scope, focus, round, t);
      return send(req, res, 200, m, m.pending ? 2 : fresh);
    }
    case '/api/progresso': return send(req, res, 200, await p.progress(round, t), fresh);
    case '/api/foto': {
      const path = u.searchParams.get('p') ?? '';
      const img = live?.photo ? await live.photo(path) : null;
      if (!img) { res.writeHead(404, { 'Cache-Control': 'public, max-age=600, s-maxage=600' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' });
      return res.end(img.body);
    }
    case '/api/urnas/estrutura': {
      const { uf, mu } = parseMunicipio(u);
      return send(req, res, 200, await urnas(p).estrutura(uf, mu, round, t), isDemo ? 3600 : 1800);
    }
    case '/api/urnas/secoes': {
      const { uf, mu } = parseMunicipio(u);
      const focus = (u.searchParams.get('foco') ?? '').split(',').filter((x) => /^\d{1,5}$/.test(x)).slice(0, 8);
      const zona = parseNum(u, 'zona', false);
      if (zona === null) {
        const est = await urnas(p).estrutura(uf, mu, round, t);
        if (!est.municipioInteiro) throw new HttpError(400, `Este município tem ${est.totalSecoes} seções — escolha uma zona eleitoral.`);
      }
      const out = await urnas(p).secoes(parseCargo(u.searchParams.get('cargo')), uf, mu, zona, focus, round, t);
      return send(req, res, 200, out, out.pending ? 2 : out.falhas ? 5 : fresh);
    }
    case '/api/urnas/locais': {
      const { uf, mu } = parseMunicipio(u);
      const focus = (u.searchParams.get('foco') ?? '').split(',').filter((x) => /^\d{1,5}$/.test(x)).slice(0, 4);
      const zona = parseNum(u, 'zona', false);
      if (zona === null && !isDemo) {
        const est = await urnas(p).estrutura(uf, mu, round, t);
        if (!est.municipioInteiro) throw new HttpError(400, `Este município tem ${est.totalSecoes} seções — escolha uma zona eleitoral.`);
      }
      const out = await urnas(p).locais(parseCargo(u.searchParams.get('cargo')), uf, mu, zona, focus, round, t);
      return send(req, res, 200, out, out.pending ? 2 : out.falhas ? 5 : fresh);
    }
    case '/api/urnas/diagnostico': {
      // Passo a passo de uma seção nas fontes ao vivo (sem cache), para investigar boletins que não aparecem.
      const { uf, mu } = parseMunicipio(u);
      if (!liveUrnas) throw new HttpError(400, 'Diagnóstico disponível só no modo ao vivo.');
      const zona = parseNum(u, 'zona', false), secao = parseNum(u, 'secao', false);
      let z = zona, s = secao;
      if (z === null || s === null) {
        const est = await liveUrnas.estrutura(uf, mu, round);
        const zz = est.zonas.find((x) => z === null || x.zona === z) ?? est.zonas[0];
        z = zz.zona; s = s ?? zz.secoes[0].s;
      }
      return send(req, res, 200, await liveUrnas.diagnostico(uf, mu, z, s!, round), 0);
    }
    case '/api/urnas/boletim': {
      const { uf, mu } = parseMunicipio(u);
      const b = await urnas(p).boletim(uf, mu, parseNum(u, 'zona', true)!, parseNum(u, 'secao', true)!, round, t);
      if (b.cargos.length) {
        // nomes, partidos, cores e fotos vêm dos resultados oficiais do município
        const results = await Promise.all(CARGOS.map((c) => p.result(c.id, { level: 'mu', uf, mu }, round, t).catch(() => null)));
        const nomes = nomesDosResultados(results.filter((r): r is NonNullable<typeof r> => !!r), uf);
        for (const cargo of b.cargos) {
          const n = nomes.get(cargo.codigo);
          for (const v of cargo.votos) {
            const c = v.tipo === 'nominal' ? n?.cands.get(v.numero) : undefined;
            const part = n?.partidos.get(v.partido);
            if (c) Object.assign(v, { nome: c.nome, sigla: c.sigla, id: c.id, cor: c.cor, foto: c.foto });
            else if (v.tipo === 'legenda') Object.assign(v, { nome: `Legenda ${part?.sigla ?? v.numero}`, sigla: part?.sigla, cor: part?.cor ?? -1 });
          }
        }
      }
      // boletim totalizado não muda mais
      return send(req, res, 200, b, b.status === 'totalizada' && !isDemo ? 86_400 : fresh);
    }
    case '/api/saude': return send(req, res, 200, { ok: true, mode: MODE, provider: isDemo ? 'demo' : 'live' });
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

/** Rotas expostas — o build da Vercel cria uma função para cada uma. */
export const API_ROUTES = ['meta', 'municipios', 'resultado', 'mapa', 'progresso', 'foto', 'saude', 'urnas/estrutura', 'urnas/secoes', 'urnas/locais', 'urnas/boletim', 'urnas/diagnostico'];
