// Roteador da API ÁGORA (/api/*), compartilhado pelo servidor local (server/index.ts)
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

export const MODE = (process.env.AGORA_MODE ?? 'auto') as 'live' | 'demo' | 'auto';

const demo = new DemoProvider();
const live = MODE === 'demo' ? null : new LiveProvider();

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
    case '/api/saude': return send(req, res, 200, { ok: true, mode: MODE, provider: isDemo ? 'demo' : 'live' });
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

/** Rotas expostas — o build da Vercel cria uma função para cada uma. */
export const API_ROUTES = ['meta', 'municipios', 'resultado', 'mapa', 'progresso', 'foto', 'saude'];
