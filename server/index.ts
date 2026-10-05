// Servidor ÁGORA 26 para rodar em máquina própria/container: API (/api/*) + arquivos estáticos do build.
// Na Vercel, a mesma API roda como funções serverless (server/vercel.ts, scripts/build-vercel.mjs).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { handleApi, HttpError, MODE, send } from './api.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(process.cwd(), 'dist');

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
    // assets/ têm hash no nome; geo/ não, então expira em um dia
    'Cache-Control': u.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : u.pathname.startsWith('/geo/') ? 'public, max-age=86400' : 'no-cache',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(gz ? gzipSync(body) : body);
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  if (u.pathname.startsWith('/api/')) return handleApi(req, res, u);
  try {
    await staticFile(req, res, u);
  } catch (e) {
    if (!res.headersSent) send(req, res, e instanceof HttpError ? e.status : 500, { erro: (e as Error).message });
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`ÁGORA 26 · http://localhost:${PORT} · modo ${MODE}`);
});
