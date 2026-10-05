// Gera a saída no formato Build Output API v3 da Vercel (.vercel/output):
//   static/            interface (build do Vite)
//   functions/api/*.func  uma função Node.js por rota da API, todas com o mesmo pacote
//   config.json        cabeçalhos de cache dos estáticos
// Uso: npm run build:vercel  (é o buildCommand definido em vercel.json)
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '.vercel', 'output');
const ROUTES = ['meta', 'municipios', 'resultado', 'mapa', 'progresso', 'foto', 'saude'];
const RUNTIME = process.env.AGORA_VERCEL_RUNTIME ?? 'nodejs22.x';

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'functions', 'api'), { recursive: true });
await cp(path.join(ROOT, 'dist'), path.join(OUT, 'static'), { recursive: true });

// Um único pacote ESM autocontido (inclui o índice de municípios).
const bundle = path.join(ROOT, '.vercel', 'agora-api.mjs');
await build({
  entryPoints: [path.join(ROOT, 'server', 'vercel.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: bundle,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

for (const name of ROUTES) {
  const dir = path.join(OUT, 'functions', 'api', `${name}.func`);
  await mkdir(dir, { recursive: true });
  await cp(bundle, path.join(dir, 'index.mjs'));
  await writeFile(path.join(dir, '.vc-config.json'), JSON.stringify({
    runtime: RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30,
  }, null, 2));
}

await writeFile(path.join(OUT, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/geo/(.*)$', headers: { 'cache-control': 'public, max-age=86400' }, continue: true },
    { src: '^/(index\\.html)?$', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api/(.*)$', status: 404, dest: '/404.json' },
  ],
}, null, 2));
await writeFile(path.join(OUT, 'static', '404.json'), JSON.stringify({ erro: 'Rota não encontrada.' }));
await rm(bundle);
console.log(`Vercel: .vercel/output pronto (${ROUTES.length} funções, ${RUNTIME})`);
