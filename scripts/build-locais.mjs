// Baixa o conjunto "Eleitorado — locais de votação" do TSE e gera public/locais/<uf>/<município>.json
// (nome da escola, endereço, bairro, coordenadas e seções de cada local de votação).
// Usado pela aba "Urnas" no modo ao vivo. É opcional: sem ele a tela mostra o número do local.
//
//   npm run locais                       baixa da URL padrão (LOCAIS_URL para trocar)
//   node scripts/build-locais.mjs --optional   não falha o build se o download não der certo
//   LOCAIS_FILE=caminho.zip|csv          usa um arquivo local
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { agruparLocais } from './locais-lib.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'locais');
const URL_PADRAO = 'https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip';
const optional = process.argv.includes('--optional');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 RadarEleicoes/1.0';

async function obter() {
  if (process.env.LOCAIS_FILE) return new Uint8Array(await readFile(process.env.LOCAIS_FILE));
  const url = process.env.LOCAIS_URL ?? URL_PADRAO;
  console.log(`locais: baixando ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(Number(process.env.LOCAIS_TIMEOUT_MS ?? 180_000)) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

try {
  if (process.env.RADAR_LOCAIS === '0') { console.log('locais: desativado (RADAR_LOCAIS=0)'); process.exit(0); }
  const bytes = await obter();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let text;
  if (isZip) {
    // um CSV nacional (…BRASIL.csv) ou um por UF — neste caso, junta todos com um único cabeçalho
    const csvs = Object.entries(unzipSync(bytes, { filter: (f) => /\.csv$/i.test(f.name) }));
    if (!csvs.length) throw new Error('nenhum CSV encontrado no arquivo');
    const brasil = csvs.find(([n]) => /brasil/i.test(n));
    const partes = (brasil ? [brasil] : csvs).map(([, b]) => new TextDecoder('latin1').decode(b));
    text = partes.map((t, i) => (i === 0 ? t : t.slice(t.indexOf('\n') + 1))).join('\n');
  } else text = new TextDecoder('latin1').decode(bytes);
  const porMunicipio = agruparLocais(text);
  await rm(OUT, { recursive: true, force: true });
  let n = 0, locais = 0;
  for (const [key, lista] of porMunicipio) {
    const [uf, mu] = key.split(':');
    await mkdir(path.join(OUT, uf), { recursive: true });
    await writeFile(path.join(OUT, uf, `${mu}.json`), JSON.stringify(lista));
    n++; locais += lista.length;
  }
  console.log(`locais: ${locais} locais de votação em ${n} municípios → public/locais/`);
} catch (e) {
  const msg = `locais: não foi possível gerar os locais de votação (${e.message}).`;
  if (optional) { console.warn(`${msg} Seguindo sem nomes de escolas.`); process.exit(0); }
  console.error(msg); process.exit(1);
}
