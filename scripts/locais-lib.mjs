// Leitura do CSV "Eleitorado — locais de votação" do TSE (dados abertos), separado por ';', em latin1.
// Colunas identificadas pelo nome do cabeçalho, para tolerar mudanças de ordem entre anos.

export function parseCsvLine(line, sep = ';') {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };
const coord = (v, min, max) => { const n = num(v); return n !== null && n !== 0 && n !== -1 && n >= min && n <= max ? n : null; };
const titulo = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/** Agrupa as linhas (uma por seção) em locais de votação por município: Map<"uf:mu", UrnaLocal[]>. */
export function agruparLocais(text) {
  const lines = text.split(/\r?\n/);
  const head = parseCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
  const col = (...names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const C = {
    uf: col('SG_UF'), mu: col('CD_MUNICIPIO'), zona: col('NR_ZONA'), secao: col('NR_SECAO'),
    local: col('NR_LOCAL_VOTACAO'), nome: col('NM_LOCAL_VOTACAO'), end: col('DS_ENDERECO', 'DS_ENDERECO_LOCAL_VOTACAO'),
    bairro: col('NM_BAIRRO'), lat: col('NR_LATITUDE'), lon: col('NR_LONGITUDE'),
    eleitores: col('QT_ELEITOR_SECAO', 'QT_ELEITOR', 'QT_ELEITOR_ELEICAO_FEDERAL'),
  };
  for (const k of ['uf', 'mu', 'zona', 'secao', 'local', 'nome']) if (C[k] < 0) throw new Error(`Coluna obrigatória ausente no CSV: ${k}`);
  const munis = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseCsvLine(lines[i]);
    const uf = String(r[C.uf]).trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(uf) || uf === 'zz') continue;
    const mu = String(r[C.mu]).trim().padStart(5, '0');
    const zona = num(r[C.zona]), local = num(r[C.local]), secao = num(r[C.secao]);
    if (!zona || !local || !secao) continue;
    const key = `${uf}:${mu}`;
    if (!munis.has(key)) munis.set(key, new Map());
    const locais = munis.get(key);
    const id = `${zona}-${local}`;
    let l = locais.get(id);
    if (!l) {
      l = {
        id, zona, local, nome: titulo(r[C.nome]),
        endereco: C.end >= 0 ? titulo(r[C.end]) || undefined : undefined,
        bairro: C.bairro >= 0 ? titulo(r[C.bairro]) || undefined : undefined,
        lat: C.lat >= 0 ? coord(r[C.lat], -35, 6) : null, lon: C.lon >= 0 ? coord(r[C.lon], -75, -28) : null,
        secoes: [], eleitores: 0,
      };
      locais.set(id, l);
    }
    if (!l.secoes.includes(secao)) {
      l.secoes.push(secao);
      if (C.eleitores >= 0) l.eleitores += num(r[C.eleitores]) ?? 0;
    }
  }
  const out = new Map();
  for (const [k, m] of munis) out.set(k, [...m.values()].map((l) => ({ ...l, secoes: l.secoes.sort((a, b) => a - b) })).sort((a, b) => a.zona - b.zona || a.local - b.local));
  return out;
}
