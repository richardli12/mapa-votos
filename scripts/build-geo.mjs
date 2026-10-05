// Gera as malhas do mapa (TopoJSON simplificado) e o índice de municípios TSE ↔ IBGE.
// Fontes públicas (IBGE via tbrugz/geodata-br; códigos TSE via betafcc/Municipios-Brasileiros-TSE).
// Uso: npm run geo   (baixa as fontes para .geo-cache/ na primeira execução)
import fs from 'node:fs/promises';
import path from 'node:path';
import mapshaper from 'mapshaper';
import { geoCentroid } from 'd3-geo';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.geo-cache');
const OUT_GEO = path.join(ROOT, 'public', 'geo');
const OUT_DATA = path.join(ROOT, 'shared', 'data');
const GEO_URL = (c) => `https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${c}-mun.json`;
const TSE_CSV = 'https://raw.githubusercontent.com/betafcc/Municipios-Brasileiros-TSE/master/municipios_brasileiros_tse.csv';

const UF_IBGE = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };

async function cached(name, url) {
  const file = path.join(CACHE, name);
  try { return await fs.readFile(file, 'utf8'); } catch {}
  process.stdout.write(`baixando ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const text = await res.text();
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(file, text);
  return text;
}

async function run(cmd, input) {
  const out = await mapshaper.applyCommands(cmd, input);
  return JSON.parse(Object.values(out)[0].toString());
}

const csv = (await cached('municipios_tse.csv', TSE_CSV)).trim().split('\n').slice(1).map((l) => l.split(','));
const byIbge = new Map(csv.map(([tse, uf, nome, capital, ibge]) => [ibge, { tse: tse.padStart(5, '0'), uf, nome, capital: capital === '1' }]));

await fs.mkdir(path.join(OUT_GEO, 'mun'), { recursive: true });
await fs.mkdir(OUT_DATA, { recursive: true });
const index = [];
const allMun = [];
const ufFeatures = [];

for (const [uf, code] of Object.entries(UF_IBGE)) {
  const raw = JSON.parse(await cached(`mun-${code}.json`, GEO_URL(code)));
  for (const f of raw.features) {
    const info = byIbge.get(String(f.properties.id));
    f.properties = { ibge: String(f.properties.id), tse: info?.tse ?? '', name: f.properties.name };
  }
  // Municípios do estado: simplificação ponderada, preservando todas as formas.
  const muni = await run(`-i in.json -simplify weighted 7% keep-shapes -o out.json format=topojson quantization=40000 precision=0.0001`, { 'in.json': raw });
  await fs.writeFile(path.join(OUT_GEO, 'mun', `${uf.toLowerCase()}.json`), JSON.stringify(muni));
  // Contorno do estado obtido pela dissolução dos municípios (bordas coincidentes).
  const state = await run(`-i in.json -dissolve -simplify weighted 4% keep-shapes -o out.json format=geojson precision=0.0001`, { 'in.json': raw });
  for (const f of state.features ?? state.geometries ?? []) {
    ufFeatures.push({ type: 'Feature', properties: { uf, ibge: String(code) }, geometry: f.geometry ?? f });
  }
  for (const f of raw.features) {
    const c = geoCentroid(f);
    const info = byIbge.get(f.properties.ibge);
    if (info) index.push([info.tse, f.properties.ibge, info.nome, uf, info.capital ? 1 : 0, +c[0].toFixed(3), +c[1].toFixed(3)]);
    allMun.push(f);
  }
  process.stdout.write(`${uf}: ${raw.features.length} municípios\n`);
}

// Municípios sem polígono na malha de 2010 continuam pesquisáveis (sem centróide próprio).
const seen = new Set(index.map((r) => r[0]));
for (const [ibge, info] of byIbge) {
  if (!seen.has(info.tse)) index.push([info.tse, ibge, info.nome, info.uf, info.capital ? 1 : 0, null, null]);
}
index.sort((a, b) => a[3].localeCompare(b[3]) || a[2].localeCompare(b[2], 'pt-BR'));

const states = await run(`-i in.json -o out.json format=topojson quantization=40000`, { 'in.json': { type: 'FeatureCollection', features: ufFeatures } });
await fs.writeFile(path.join(OUT_GEO, 'uf.json'), JSON.stringify(states));
// Brasil inteiro por município (mais leve, para a visão nacional municipal).
const br = await run(`-i in.json -simplify weighted 2.2% keep-shapes -o out.json format=topojson quantization=30000`, { 'in.json': { type: 'FeatureCollection', features: allMun } });
await fs.writeFile(path.join(OUT_GEO, 'br-mun.json'), JSON.stringify(br));
await fs.writeFile(path.join(OUT_DATA, 'municipios.json'), JSON.stringify(index));
process.stdout.write(`ok: ${index.length} municípios no índice\n`);
