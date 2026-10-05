// Servidor ÁGORA 26: API normalizada (/api/*) + arquivos estáticos do build.
// Modo de dados: AGORA_MODE=live (BP → TSE) | demo (simulação) | auto (ao vivo, com simulação se a fonte falhar).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CARGOS } from '../shared/cargos.ts';
import { UFS } from '../shared/ufs.ts';
import type { CargoId, Scope } from '../shared/types.ts';
import { DemoProvider } from './demo/demo.ts';
import type { Provider } from './provider.ts';
import { LiveProvider } from './tse/live.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MODE = (process.env.AGORA_MODE ?? 'auto') as 'live' | 'demo' | 'auto';
const DIST = join(process.cwd(), 'dist');

const demo = new DemoProvider();
const live = MODE === 'demo' ? null : new LiveProvider();

/** No modo auto, testa a fonte ao vivo e cai para a simulação se ela não responder. */
let liveOk: { ok: boolean; at: number } = { ok: false, at: 0 };
async function provider(req: URL): Promise<Provider> {
  const forced = req.searchParams.get('fonte');
  if (forced === 'demo' || MODE === 'demo' || !live) return demo;
  if (forced === 'live' || MODE === 'live') return live;
  if (Date.now() - liveOk.at > 60_000) {
    try { await live.progress(1); liveOk = { ok: true, at: Date.now() }; } catch { liveOk = { ok: false, at: Date.now() }; }
  }
  return liveOk.ok ? live : demo;
}

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

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

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, maxAge = 0) {
  const json = Buffer.from(JSON.stringify(body));
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && json.length > 1024;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(gzip ? gzipSync(json) : json);
}

async function api(req: IncomingMessage, res: ServerResponse, u: URL) {
  const p = await provider(u);
  const round = parseRound(u), t = parseT(u);
  switch (u.pathname) {
    case '/api/meta': {
      const meta = await p.meta(round);
      if (p === demo && live && MODE === 'auto') meta.warnings.push('Fonte ao vivo indisponível — exibindo a simulação. Os dados reais aparecem automaticamente quando a fonte responder.');
      return send(req, res, 200, meta);
    }
    case '/api/municipios': return send(req, res, 200, await p.municipalities(), 3600);
    case '/api/resultado': return send(req, res, 200, await p.result(parseCargo(u.searchParams.get('cargo')), parseScope(u), round, t));
    case '/api/mapa': {
      const focus = (u.searchParams.get('foco') ?? '').split(',').filter((x) => /^\d+$/.test(x)).slice(0, 8);
      return send(req, res, 200, await p.map(parseCargo(u.searchParams.get('cargo')), parseScope(u), focus, round, t));
    }
    case '/api/progresso': return send(req, res, 200, await p.progress(round, t));
    case '/api/foto': {
      const path = u.searchParams.get('p') ?? '';
      const img = live?.photo ? await live.photo(path) : null;
      if (!img) { res.writeHead(404, { 'Cache-Control': 'public, max-age=600' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400' });
      return res.end(img.body);
    }
    case '/api/saude': return send(req, res, 200, { ok: true, mode: MODE, provider: p === demo ? 'demo' : 'live' });
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
async function staticFile(req: IncomingMessage, res: ServerResponse, u: URL) {
  let file = normalize(join(DIST, decodeURIComponent(u.pathname)));
  if (!file.startsWith(DIST)) throw new HttpError(403, 'Proibido.');
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(DIST, 'index.html'); }
  const body = await readFile(file);
  const ext = extname(file);
  const gz = ['.js', '.css', '.json', '.html', '.svg'].includes(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': u.pathname.startsWith('/assets/') || u.pathname.startsWith('/geo/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(gz ? gzipSync(body) : body);
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (u.pathname.startsWith('/api/')) await api(req, res, u);
    else await staticFile(req, res, u);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    if (!res.headersSent) send(req, res, status, { erro: (e as Error).message });
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`ÁGORA 26 · http://localhost:${PORT} · modo ${MODE}`);
});
