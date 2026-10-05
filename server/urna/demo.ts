// Simulação da apuração por urna: zonas eleitorais, locais de votação (nomes FICTÍCIOS) e seções,
// com boletins completos (todos os cargos) coerentes com os votos simulados do município.
import type { CargoId } from '../../shared/types.ts';
import type { BoletimSecao, LocaisPayload, SecaoResumo, UrnaEstrutura, UrnaLocal, UrnaZona } from '../../shared/urnas.ts';
import type { DemoProvider, DemoUrnaBase, DemoUrnaRace } from '../demo/demo.ts';
import { FIRST_F, FIRST_M, LAST } from '../demo/names.ts';
import { field, gauss, hash32, pick, rand } from '../demo/random.ts';
import type { BoletimUrna, CargoBU, VotoBU } from './bu.ts';
import type { UrnasProvider } from './provider.ts';
import { agregarPorLocal, boletimCompleto, resumir } from './resumo.ts';

const TIPOS = ['Escola Estadual', 'Escola Municipal', 'E.E.', 'EMEF', 'Colégio Estadual', 'Centro Educacional', 'Escola Técnica', 'Instituto Federal', 'Faculdade', 'Ginásio Municipal', 'Centro Comunitário', 'Escola Estadual de Ensino Médio'];
const BAIRROS = ['Centro', 'Vila Nova', 'Jardim América', 'São José', 'Santa Luzia', 'Boa Vista', 'Bela Vista', 'Jardim Primavera', 'Vila Operária', 'Distrito Industrial', 'Alto da Serra', 'Parque das Árvores', 'Santo Antônio', 'Aparecida', 'Vila Esperança', 'Jardim Europa', 'Morada do Sol', 'Cidade Nova', 'Vila Rica', 'Recanto Verde', 'Planalto', 'São Cristóvão', 'Jardim Paulista', 'Vila Mariana', 'Novo Horizonte', 'Jardim Botânico', 'Liberdade', 'Santa Cruz', 'Bom Jesus', 'Cohab', 'Parque Industrial', 'Vila Maria', 'Jardim Imperial', 'Monte Alegre', 'Santa Rita', 'Portal do Sol'];
const VIAS = ['Rua', 'Avenida', 'Travessa', 'Alameda', 'Praça'];

/** Ruído determinístico rápido (~normal, desvio ≈ 1) a partir de inteiros — milhões de chamadas sem custo de hash de texto. */
function ruido(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1) ^ Math.imul(d + 1, 0x7feb352d);
  const u = () => { h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
  return (u() + u() + u() - 1.5) * 2;
}

interface Sec { z: number; s: number; li: number; aptos: number; comp: number; rank: number }
interface Est { base: DemoUrnaBase; est: UrnaEstrutura; secs: Sec[]; bySec: Map<string, Sec>; bias: number[]; localAptos: number[]; aptosTotal: number }

export class DemoUrnas implements UrnasProvider {
  private cache = new Map<string, Est>();
  private prep = new Map<string, { aff: number[]; z: number[] }>();
  constructor(private demo: DemoProvider, private maxMunicipio = Number(process.env.URNA_MAX_SECOES ?? 1200)) {}

  private build(uf: string, mu: string, t?: number): Est {
    const base = this.demo.urnaBase(uf, mu, t);
    if (!base) throw new Error('Município não encontrado.');
    const hit = this.cache.get(mu);
    if (hit) { hit.base = base; return hit; }
    const seed = `urna:${mu}`;
    const S = Math.max(1, base.sections), E = base.electorate;
    const nz = Math.max(1, Math.min(60, Math.round(E / 150_000)));
    const zBase = 1 + (hash32(seed + 'z') % 380);
    const L = Math.max(1, Math.round(S / (5 + rand(seed + 'pl') * 4)));
    const R = Math.min(0.22, Math.max(0.012, 0.0042 * Math.sqrt(E / 1000)));
    const nb = Math.max(1, Math.min(36, Math.round(L / 5)));
    const bairros = Array.from({ length: nb }, (_, b) => {
      const a = rand(`${seed}:ba${b}`) * Math.PI * 2, r = b === 0 ? 0 : R * Math.sqrt(rand(`${seed}:br${b}`)) * 0.85;
      return { nome: b === 0 ? 'Centro' : BAIRROS[(hash32(`${seed}:bn${b}`) % (BAIRROS.length - 1)) + 1], lon: base.lon + r * Math.cos(a), lat: base.lat + r * Math.sin(a) * 0.92, ang: a };
    });
    const locais: (UrnaLocal & { b: number; n: number })[] = [];
    for (let i = 0; i < L; i++) {
      const b = rand(`${seed}:lb${i}`) < 0.18 ? 0 : Math.floor(rand(`${seed}:lb2${i}`) * nb);
      const spread = (R * 0.22) / Math.sqrt(nb);
      const tipo = pick(TIPOS, `${seed}:lt${i}`);
      const fem = rand(`${seed}:lg${i}`) < 0.5;
      const first = pick(fem ? FIRST_F : FIRST_M, `${seed}:lf${i}`), last = pick(LAST, `${seed}:ll${i}`);
      const r = rand(`${seed}:lh${i}`);
      const homenagem = r < 0.35 ? `${fem ? 'Professora' : 'Professor'} ${first} ${last}` : r < 0.55 ? `${first} ${pick(LAST, `${seed}:lm${i}`)} ${last}` : r < 0.7 ? `${fem ? 'Dona' : 'Doutor'} ${first} ${last}` : r < 0.85 ? `${pick(['Monteiro', 'Barão', 'Visconde', 'Marechal', 'Padre'], `${seed}:lx${i}`)} ${last}` : bairros[b].nome;
      locais.push({
        id: '', zona: 0, local: 0, nome: `${tipo} ${homenagem}`, b, n: 0,
        endereco: `${pick(VIAS, `${seed}:lv${i}`)} ${pick([...LAST, ...FIRST_M, ...FIRST_F], `${seed}:lr${i}`)}, ${10 + Math.floor(rand(`${seed}:ln${i}`) * 2400)}`,
        bairro: bairros[b].nome,
        lon: bairros[b].lon + gauss(`${seed}:lx${i}`) * spread, lat: bairros[b].lat + gauss(`${seed}:ly${i}`) * spread * 0.92,
        secoes: [],
      });
    }
    // seções por local (a soma bate com o total do município)
    const counts = locais.map((_, i) => 0.6 + 0.8 * rand(`${seed}:lc${i}`));
    const csum = counts.reduce((a, b) => a + b, 0);
    const per = counts.map((c) => Math.max(1, Math.round((c / csum) * S)));
    let diff = S - per.reduce((a, b) => a + b, 0);
    for (let i = 0; diff !== 0 && i < per.length * 4; i++) { const k = i % per.length; if (diff > 0) { per[k]++; diff--; } else if (per[k] > 1) { per[k]--; diff++; } }
    // numeração: zonas por setor geográfico; locais e seções numerados dentro da zona
    const zonas: UrnaZona[] = Array.from({ length: nz }, (_, k) => ({ zona: zBase + k, secoes: [] }));
    // zonas = setores geográficos com o mesmo número de locais (ângulo em torno do centro)
    const ang = (l: UrnaLocal) => (Math.atan2((l.lat ?? 0) - base.lat, (l.lon ?? 0) - base.lon) + Math.PI * 2) % (Math.PI * 2);
    const porAngulo = locais.map((l, i) => ({ l, i, a: ang(l) })).sort((a, b) => a.a - b.a);
    const zonaDoLocal = new Map(porAngulo.map((x, k) => [x.i, Math.min(nz - 1, Math.floor((k / porAngulo.length) * nz))]));
    const ordem = locais.map((l, i) => ({ l, i, z: zonaDoLocal.get(i)! })).sort((a, b) => a.z - b.z || (b.l.lat ?? 0) - (a.l.lat ?? 0) || a.i - b.i);
    const nextSec = new Array(nz).fill(1), nextLocal = new Array(nz).fill(0);
    const pesos: number[] = [];
    const secs: Sec[] = [];
    for (const { l, i, z } of ordem) {
      l.zona = zonas[z].zona; l.local = 1007 + 8 * nextLocal[z]++; l.id = `${l.zona}-${l.local}`;
      for (let k = 0; k < per[i]; k++) {
        const s = nextSec[z]++;
        l.secoes.push(s);
        const w = 0.8 + 0.4 * rand(`${seed}:sw${l.zona}:${s}`);
        pesos.push(w);
        secs.push({ z: l.zona, s, li: locais.indexOf(l), aptos: 0, comp: 0, rank: rand(`${seed}:rk${l.zona}:${s}`) });
      }
    }
    const psum = pesos.reduce((a, b) => a + b, 0);
    secs.forEach((sec, k) => {
      sec.aptos = Math.max(20, Math.round((pesos[k] / psum) * E));
      sec.comp = Math.min(sec.aptos, Math.round(sec.aptos * base.turnout * (1 + 0.05 * gauss(`${seed}:cp${sec.z}:${sec.s}`))));
      zonas.find((zz) => zz.zona === sec.z)!.secoes.push({ s: sec.s, local: locais[sec.li].local, aptos: sec.aptos });
    });
    const ranks = [...secs].sort((a, b) => a.rank - b.rank);
    ranks.forEach((s, k) => { s.rank = k; });
    const localAptos = locais.map(() => 0);
    secs.forEach((s) => { localAptos[s.li] += s.aptos; });
    locais.forEach((l, i) => { l.eleitores = localAptos[i]; });
    const bias = locais.map((l, i) => field(`${seed}:bias`, l.lon! * 40, l.lat! * 40) + 0.35 * gauss(`${seed}:bl${i}`));
    const outLocais: UrnaLocal[] = locais.map(({ b: _b, n: _n, ...rest }) => rest);
    const est: UrnaEstrutura = {
      uf, mu, nome: base.name, zonas: zonas.filter((z) => z.secoes.length).map((z) => ({ ...z, secoes: z.secoes.sort((a, b) => a.s - b.s) })),
      locais: outLocais, totalSecoes: secs.length, municipioInteiro: secs.length <= this.maxMunicipio, source: 'demo',
    };
    const out: Est = { base, est, secs, bySec: new Map(secs.map((s) => [`${s.z}:${s.s}`, s])), bias, localAptos, aptosTotal: secs.reduce((a, s) => a + s.aptos, 0) };
    this.cache.set(mu, out);
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  /** Afinidade de cada candidato com cada "bairro" — gera geografia de voto dentro da cidade. */
  private prepare(e: Est, race: DemoUrnaRace) {
    const key = `${e.est.mu}:${race.cargo}`;
    let p = this.prep.get(key);
    if (!p) {
      const aff = race.cands.map((c) => 0.9 * gauss(`aff:${e.est.mu}:${race.cargo}:${c.numero}`));
      const z = aff.map((a) => e.bias.reduce((s, b, li) => s + e.localAptos[li] * Math.exp(a * b), 0) || 1);
      p = { aff, z };
      this.prep.set(key, p);
      if (this.prep.size > 1500) this.prep.delete(this.prep.keys().next().value!);
    }
    return p;
  }

  private cargoBU(e: Est, race: DemoUrnaRace, sec: Sec): CargoBU {
    const { aff, z } = this.prepare(e, race);
    const b = e.bias[sec.li];
    // variação própria de cada urna (vizinhas no mesmo local não saem idênticas)
    const mu = Number(e.est.mu), rc = race.code;
    const raw = race.cands.map((c, ci) => (race.final[ci] * sec.aptos * Math.exp(aff[ci] * b + 0.16 * ruido(mu, sec.z * 10000 + sec.s, rc, c.numero))) / z[ci]);
    const leg = race.legend.map((l) => (l.votos * sec.aptos) / (e.aptosTotal || 1));
    const sum = raw.reduce((a, v) => a + v, 0) + leg.reduce((a, v) => a + v, 0) || 1;
    const totalVotos = sec.comp * race.voteMult;
    const brancos = Math.round(totalVotos * race.blank);
    const alvo = Math.max(0, totalVotos * (1 - race.blank - race.nul));
    const votos: VotoBU[] = [];
    let validos = 0;
    race.cands.forEach((c, ci) => { const q = Math.round((raw[ci] / sum) * alvo); if (q > 0) { votos.push({ tipo: 'nominal', qtd: q, partido: c.partido, numero: c.numero }); validos += q; } });
    race.legend.forEach((l, li) => { const q = Math.round((leg[li] / sum) * alvo); if (q > 0) { votos.push({ tipo: 'legenda', qtd: q, partido: l.partido, numero: l.partido }); validos += q; } });
    const nulos = Math.max(0, totalVotos - validos - brancos);
    if (brancos) votos.push({ tipo: 'branco', qtd: brancos });
    if (nulos) votos.push({ tipo: 'nulo', qtd: nulos });
    return { codigo: race.code, livre: false, tipo: race.tipo, comparecimento: sec.comp, ordem: 1, votos };
  }

  private boletimUrna(e: Est, sec: Sec, races: DemoUrnaRace[]): BoletimUrna {
    const seed = `bu:${e.est.mu}:${sec.z}:${sec.s}`;
    const min = 5 + Math.round((sec.rank / Math.max(1, e.secs.length)) * 150);
    const hh = String(17 + Math.floor(min / 60)).padStart(2, '0'), mm = String(min % 60).padStart(2, '0');
    const enc = String(Math.floor(rand(seed + 'en') * 4)).padStart(2, '0');
    const lib = Math.round(sec.comp * 0.025 * rand(seed + 'lib'));
    const porEleicao = (id: number) => races.filter((r) => r.eleicao === id).map((r) => this.cargoBU(e, r, sec));
    const eleicoes = [6259, 6257].map((id) => ({ idEleicao: id, aptos: sec.aptos, cargos: porEleicao(id) })).filter((x) => x.cargos.length);
    return {
      fase: 'simulado', municipio: Number(e.est.mu), zona: sec.z, local: e.est.locais![sec.li].local, secao: sec.s,
      emissao: `2026-10-04T${hh}:${mm}:${String(Math.floor(rand(seed + 'ss') * 60)).padStart(2, '0')}`,
      abertura: `2026-10-04T08:00:${String(1 + Math.floor(rand(seed + 'ab') * 50)).padStart(2, '0')}`,
      encerramento: `2026-10-04T17:${enc}:${String(Math.floor(rand(seed + 'es') * 60)).padStart(2, '0')}`,
      tipoUrna: 'seção', versao: 'Simulação Radar Eleições', numeroInterno: 2_000_000 + (hash32(seed + 'ni') % 3_000_000),
      codigoCarga: String(hash32(seed + 'c1')).padStart(10, '0') + String(hash32(seed + 'c2')).padStart(10, '0') + String(hash32(seed + 'c3') % 10_000).padStart(4, '0'),
      serieFlash: hash32(seed + 'fl').toString(16).padStart(8, '0'),
      apuracaoSA: false, liberadosCodigo: lib, biometria: sec.comp - lib, eleicoes,
    };
  }

  private totalizada(e: Est, sec: Sec) { return sec.rank < Math.floor(e.secs.length * e.base.frac); }

  async estrutura(uf: string, mu: string, _round: number, t?: number): Promise<UrnaEstrutura> {
    return this.build(uf, mu, t).est;
  }

  /** Resumo das seções (da zona ou do município inteiro) para um cargo, sem limite — a simulação é barata. */
  private resumos(e: Est, cargo: CargoId, uf: string, zona: number | null, focus: string[]): SecaoResumo[] {
    const race = e.base.races.find((r) => r.cargo === cargo)!;
    const fset = new Set(focus);
    return e.secs.filter((s) => zona === null || s.z === zona).map((sec) => {
      const local = e.est.locais![sec.li].local;
      if (!this.totalizada(e, sec)) return resumir(null, sec.z, sec.s, cargo, uf, fset, 'aguardando', local);
      const bu = { local, eleicoes: [{ idEleicao: race.eleicao, aptos: sec.aptos, cargos: [this.cargoBU(e, race, sec)] }] } as unknown as BoletimUrna;
      return resumir(bu, sec.z, sec.s, cargo, uf, fset);
    });
  }

  async secoes(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], _round: number, t?: number) {
    const e = this.build(uf, mu, t);
    if (zona === null && !e.est.municipioInteiro) throw new Error(`Este município tem ${e.est.totalSecoes} seções — escolha uma zona eleitoral.`);
    const secoes = this.resumos(e, cargo, uf, zona, focus);
    if (zona !== null && !secoes.length) throw new Error('Zona eleitoral não encontrada neste município.');
    return { cargo, uf, mu, zona, secoes, pending: 0, total: secoes.length, source: 'demo' as const };
  }

  private locaisCache = new Map<string, LocaisPayload>();
  async locais(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], _round: number, t?: number): Promise<LocaisPayload> {
    const e = this.build(uf, mu, t);
    const key = `${mu}:${cargo}:${zona}:${focus.join(',')}:${Math.floor(e.secs.length * e.base.frac)}`;
    const hit = this.locaisCache.get(key);
    if (hit) return hit;
    const secoes = this.resumos(e, cargo, uf, zona, focus);
    const out: LocaisPayload = { cargo, uf, mu, zona, locais: agregarPorLocal(secoes, focus), pending: 0, total: secoes.length, source: 'demo' };
    this.locaisCache.set(key, out);
    if (this.locaisCache.size > 200) this.locaisCache.delete(this.locaisCache.keys().next().value!);
    return out;
  }

  async boletim(uf: string, mu: string, zona: number, secao: number, _round: number, t?: number): Promise<BoletimSecao> {
    const e = this.build(uf, mu, t);
    const sec = e.bySec.get(`${zona}:${secao}`);
    if (!sec) throw new Error('Seção não encontrada.');
    if (!this.totalizada(e, sec)) {
      return { uf, mu, zona, secao, local: e.est.locais![sec.li].local, status: 'aguardando', fase: 'simulado', aptos: sec.aptos, comparecimento: 0, emissao: null, abertura: null, encerramento: null, urna: null, biometria: null, liberadosCodigo: null, apuracaoSA: false, cargos: [], source: 'demo' };
    }
    const bu = this.boletimUrna(e, sec, e.base.races);
    return boletimCompleto(bu, uf, mu, zona, secao, 'demo', new Map(), { hash: hash32(`h:${mu}:${zona}:${secao}`).toString(16).padStart(8, '0') + hash32(`h2:${mu}:${zona}:${secao}`).toString(16).padStart(8, '0'), arquivo: `o00${3220}-${mu}${String(zona).padStart(4, '0')}${String(secao).padStart(4, '0')}.bu` });
  }
}
