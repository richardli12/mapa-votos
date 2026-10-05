// Provedor de SIMULAÇÃO — candidatos e votos 100% fictícios, para demonstrar o sistema
// sem depender da fonte ao vivo. A apuração avança com o relógio (ou pela "máquina do tempo", parâmetro t):
// as regiões totalizam em ritmos diferentes, o que produz viradas como numa noite de eleição real.
import { assignColors } from '../../shared/colors.ts';
import { CARGOS, cargoCode, cargoLabel } from '../../shared/cargos.ts';
import { allocateSeats, type SeatGroup } from '../../shared/seats.ts';
import { UFS, ufInfo, ufName, type Region } from '../../shared/ufs.ts';
import type { CargoId, Candidate, CandidateLite, CountStatus, MapArea, MapPayload, MetaPayload, Municipality, PartyResult, ProgressRow, Result, Running, Scope, Totals } from '../../shared/types.ts';
import { MUNICIPALITIES } from '../geo-index.ts';
import { areaFromResult, type Provider } from '../provider.ts';
import { FIRST_F, FIRST_M, LAST, TITLES_F, TITLES_M } from './names.ts';
import { field, gauss, pick, rand, shuffle } from './random.ts';

// ——— Parâmetros do "país" simulado ———
const ELECTORATE_K: Record<string, number> = { sp: 34900, mg: 16600, rj: 13000, ba: 11500, rs: 8700, pr: 8700, pe: 7200, ce: 7000, pa: 6300, sc: 5800, ma: 5300, go: 5000, pb: 3200, es: 3000, am: 2800, pi: 2700, rn: 2600, mt: 2600, al: 2400, df: 2300, ms: 2050, se: 1700, ro: 1250, to: 1150, ac: 620, ap: 580, rr: 400 };
const FED_SEATS: Record<string, number> = { sp: 70, mg: 53, rj: 46, ba: 39, rs: 31, pr: 30, pe: 25, ce: 22, ma: 18, go: 17, pa: 17, sc: 16, pb: 12, es: 10, pi: 10, al: 9, am: 8, df: 8, ms: 8, mt: 8, rn: 8, ac: 8, ap: 8, ro: 8, rr: 8, se: 8, to: 8 };
const stateSeats = (uf: string) => (uf === 'df' ? 24 : FED_SEATS[uf] <= 12 ? FED_SEATS[uf] * 3 : 36 + FED_SEATS[uf] - 12);

interface PartyDef { sg: string; name: string; n: number; fed?: string; strength: number; region?: Partial<Record<Region, number>> }
const PARTIES: PartyDef[] = [
  { sg: 'PL', name: 'Partido Liberal', n: 22, strength: 0.9, region: { Sul: 0.35, 'Centro-Oeste': 0.4, Nordeste: -0.35 } },
  { sg: 'PT', name: 'Partido dos Trabalhadores', n: 13, fed: 'FE BRASIL', strength: 0.85, region: { Nordeste: 0.55, Sul: -0.25, 'Centro-Oeste': -0.3 } },
  { sg: 'PSD', name: 'Partido Social Democrático', n: 55, strength: 0.55 },
  { sg: 'UNIÃO', name: 'União Brasil', n: 44, fed: 'UNIÃO PROGRESSISTA', strength: 0.5 },
  { sg: 'MDB', name: 'Movimento Democrático Brasileiro', n: 15, strength: 0.45, region: { Norte: 0.2 } },
  { sg: 'PP', name: 'Progressistas', n: 11, fed: 'UNIÃO PROGRESSISTA', strength: 0.45, region: { Sul: 0.2 } },
  { sg: 'REPUBLICANOS', name: 'Republicanos', n: 10, strength: 0.45, region: { Sudeste: 0.15 } },
  { sg: 'PSB', name: 'Partido Socialista Brasileiro', n: 40, strength: 0.2, region: { Nordeste: 0.3 } },
  { sg: 'PSDB', name: 'Partido da Social Democracia Brasileira', n: 45, fed: 'PSDB CIDADANIA', strength: 0.0, region: { Sudeste: 0.15 } },
  { sg: 'PDT', name: 'Partido Democrático Trabalhista', n: 12, strength: -0.1, region: { Nordeste: 0.2 } },
  { sg: 'PSOL', name: 'Partido Socialismo e Liberdade', n: 50, fed: 'PSOL REDE', strength: 0.0, region: { Sudeste: 0.2 } },
  { sg: 'PODE', name: 'Podemos', n: 20, strength: -0.1 },
  { sg: 'NOVO', name: 'Partido Novo', n: 30, strength: -0.1, region: { Sul: 0.3, Sudeste: 0.2, Nordeste: -0.5 } },
  { sg: 'AVANTE', name: 'Avante', n: 70, strength: -0.4 },
  { sg: 'SOLIDARIEDADE', name: 'Solidariedade', n: 77, fed: 'RENOVAÇÃO SOLIDÁRIA', strength: -0.5 },
  { sg: 'PC do B', name: 'Partido Comunista do Brasil', n: 65, fed: 'FE BRASIL', strength: -0.6, region: { Nordeste: 0.2 } },
  { sg: 'PV', name: 'Partido Verde', n: 43, fed: 'FE BRASIL', strength: -0.6 },
  { sg: 'CIDADANIA', name: 'Cidadania', n: 23, fed: 'PSDB CIDADANIA', strength: -0.7 },
  { sg: 'REDE', name: 'Rede Sustentabilidade', n: 18, fed: 'PSOL REDE', strength: -0.8 },
  { sg: 'PRD', name: 'Partido Renovação Democrática', n: 25, fed: 'RENOVAÇÃO SOLIDÁRIA', strength: -0.5 },
  { sg: 'MISSÃO', name: 'Partido Missão', n: 14, strength: -0.7, region: { Sudeste: 0.2, Sul: 0.2 } },
  { sg: 'DC', name: 'Democracia Cristã', n: 27, strength: -1.4 },
  { sg: 'AGIR', name: 'Agir', n: 36, strength: -1.4 },
  { sg: 'MOBILIZA', name: 'Mobiliza', n: 33, strength: -1.5 },
  { sg: 'PMB', name: 'Partido da Mulher Brasileira', n: 35, strength: -1.6 },
  { sg: 'PRTB', name: 'Partido Renovador Trabalhista Brasileiro', n: 28, strength: -1.6 },
];
const PARTY = new Map(PARTIES.map((p) => [p.sg, p]));
const FED_LABEL: Record<string, string> = { 'FE BRASIL': 'PT/PC do B/PV', 'UNIÃO PROGRESSISTA': 'UNIÃO/PP', 'PSDB CIDADANIA': 'PSDB/CIDADANIA', 'PSOL REDE': 'PSOL/REDE', 'RENOVAÇÃO SOLIDÁRIA': 'PRD/SOLIDARIEDADE' };

// ——— Municípios: eleitorado, seções, ritmo de totalização ———
interface MuniStat {
  m: Municipality; region: Region; lon: number; lat: number;
  electorate: number; sections: number; turnout: number; blank: number; nul: number;
  start: number; dur: number;
}
const REGION_START: Record<Region, [number, number]> = { Sul: [0.0, 0.22], Sudeste: [0.02, 0.3], 'Centro-Oeste': [0.06, 0.32], Nordeste: [0.14, 0.42], Norte: [0.2, 0.46] };

// Eleitorado aproximado (milhares) das maiores cidades, para a simulação ficar crível.
const BIG_CITIES: Record<string, number> = Object.fromEntries(Object.entries({
  'sp:SÃO PAULO': 9300, 'rj:RIO DE JANEIRO': 5000, 'mg:BELO HORIZONTE': 1950, 'ba:SALVADOR': 1980, 'ce:FORTALEZA': 1790, 'am:MANAUS': 1500,
  'pr:CURITIBA': 1330, 'pe:RECIFE': 1180, 'go:GOIÂNIA': 1070, 'pa:BELÉM': 1060, 'rs:PORTO ALEGRE': 1080, 'sp:GUARULHOS': 870, 'sp:CAMPINAS': 840,
  'ma:SÃO LUÍS': 720, 'rj:SÃO GONÇALO': 680, 'al:MACEIÓ': 620, 'rj:DUQUE DE CAXIAS': 630, 'rn:NATAL': 560, 'pi:TERESINA': 580, 'ms:CAMPO GRANDE': 640,
  'rj:NOVA IGUAÇU': 580, 'sp:SÃO BERNARDO DO CAMPO': 620, 'pb:JOÃO PESSOA': 550, 'sp:SANTO ANDRÉ': 550, 'sp:OSASCO': 540, 'pe:JABOATÃO DOS GUARARAPES': 500,
  'sp:RIBEIRÃO PRETO': 530, 'mg:UBERLÂNDIA': 500, 'mg:CONTAGEM': 470, 'sp:SOROCABA': 510, 'se:ARACAJU': 450, 'ba:FEIRA DE SANTANA': 430, 'mt:CUIABÁ': 430,
  'sc:JOINVILLE': 450, 'mg:JUIZ DE FORA': 430, 'pr:LONDRINA': 420, 'go:APARECIDA DE GOIÂNIA': 400, 'rj:NITERÓI': 400, 'ro:PORTO VELHO': 330,
  'sc:FLORIANÓPOLIS': 380, 'es:VILA VELHA': 370, 'es:SERRA': 360, 'rs:CAXIAS DO SUL': 360, 'ap:MACAPÁ': 300, 'sp:SÃO JOSÉ DOS CAMPOS': 500,
  'sp:SANTOS': 360, 'es:VITÓRIA': 260, 'rr:BOA VISTA': 270, 'to:PALMAS': 220, 'ac:RIO BRANCO': 270, 'pr:MARINGÁ': 300, 'mg:BETIM': 300,
}).map(([k, v]) => [k, v * 1000]));

function buildMunis(): MuniStat[] {
  const out: MuniStat[] = [];
  for (const u of UFS) {
    const list = MUNICIPALITIES.filter((m) => m.uf === u.uf);
    const withPos = list.filter((m) => m.lon !== null);
    const cLon = withPos.reduce((s, m) => s + m.lon!, 0) / Math.max(1, withPos.length);
    const cLat = withPos.reduce((s, m) => s + m.lat!, 0) / Math.max(1, withPos.length);
    const capShare = u.uf === 'df' ? 1 : list.length < 30 ? 0.42 : 0.12 + 2.2 / Math.sqrt(list.length);
    const total = ELECTORATE_K[u.uf] * 1000;
    // grandes cidades com eleitorado aproximado; o restante da UF é repartido entre os demais municípios
    const known = list.map((m) => BIG_CITIES[`${u.uf}:${m.name}`] ?? (m.capital && u.uf !== 'df' && !BIG_CITIES[`${u.uf}:${m.name}`] ? total * capShare : 0));
    const knownSum = known.reduce((s, k) => s + k, 0);
    const weights = list.map((m, i) => (known[i] ? 0 : Math.exp(1.15 * gauss(`el:${m.code}`))));
    const wsum = weights.reduce((s, w) => s + w, 0) || 1;
    list.forEach((m, i) => {
      const electorate = Math.max(1200, Math.round(u.uf === 'df' ? total : known[i] || ((total - knownSum) * weights[i]) / wsum));
      const [a, b] = REGION_START[u.region];
      const start = a + (b - a) * rand(`st:${m.code}`) + (m.capital ? -0.03 : 0.02 * rand(`st2:${m.code}`));
      const dur = Math.min(0.12 + 0.35 * rand(`du:${m.code}`) + (m.capital ? 0.22 : 0) + Math.log10(electorate) * 0.02, 0.98 - Math.max(0, start));
      out.push({
        m, region: u.region, lon: m.lon ?? cLon, lat: m.lat ?? cLat, electorate,
        sections: Math.max(3, Math.round(electorate / (m.capital ? 360 : 310))),
        turnout: Math.min(0.92, Math.max(0.66, 0.795 + 0.035 * field('turn', m.lon ?? cLon, m.lat ?? cLat) + 0.02 * gauss(`tu:${m.code}`) + (m.capital ? 0.01 : 0))),
        blank: Math.max(0.008, 0.022 + 0.008 * gauss(`bl:${m.code}`)),
        nul: Math.max(0.01, 0.034 + 0.01 * gauss(`nu:${m.code}`)),
        start: Math.max(0, start), dur: Math.max(0.05, dur),
      });
    });
  }
  return out;
}

// ——— Candidatos fictícios ———
interface DemoCand { id: string; number: string; name: string; fullName: string; party: string; mates: Running[]; birth: string }

function personName(seed: string, titled = 0.18): { name: string; fullName: string } {
  const female = rand(`${seed}:g`) < 0.42;
  const first = pick(female ? FIRST_F : FIRST_M, `${seed}:f`);
  const l1 = pick(LAST, `${seed}:l1`), l2 = pick(LAST, `${seed}:l2`);
  const fullName = `${first} ${l1 === l2 ? '' : l1 + ' '}${l2}`.toUpperCase();
  const r = rand(`${seed}:t`);
  const name = (r < titled ? `${pick(female ? TITLES_F : TITLES_M, `${seed}:tt`)} ${first}` : r < titled + 0.25 ? `${first} ${l2}` : `${first} ${l1 === l2 ? l2 : pick([l1, l2], `${seed}:x`)}`).toUpperCase();
  return { name, fullName };
}
const birth = (seed: string) => `${String(1 + Math.floor(rand(seed + 'd') * 28)).padStart(2, '0')}/${String(1 + Math.floor(rand(seed + 'm') * 12)).padStart(2, '0')}/${1950 + Math.floor(rand(seed + 'y') * 45)}`;

interface Race {
  key: string; cargo: CargoId; uf: string | null; seats: number; label: string;
  cands: DemoCand[]; munis: MuniStat[]; muniIndex: Map<string, number>;
  final: Float64Array; eps: Float32Array; legendFinal: Float64Array; partyOf: Int32Array; parties: string[];
  voteMult: number; blankMult: number; nullMult: number; colors: Map<string, number>; partyColors: Map<string, number>;
  coalition: Map<string, { name: string; parties: string }>;
}

const softmax = (xs: number[]) => { const m = Math.max(...xs); const e = xs.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
const distKm = (a: MuniStat, lon: number, lat: number) => Math.hypot((a.lon - lon) * 111 * Math.cos((a.lat * Math.PI) / 180), (a.lat - lat) * 111);

/** Dados de uma disputa no município, para a simulação de boletins de urna. */
export interface DemoUrnaRace {
  cargo: CargoId; code: number; eleicao: number; tipo: 'majoritario' | 'proporcional';
  cands: { numero: number; partido: number }[]; final: number[]; legend: { partido: number; votos: number }[];
  voteMult: number; blank: number; nul: number;
}
export interface DemoUrnaBase {
  name: string; capital: boolean; lon: number; lat: number; electorate: number; sections: number; turnout: number;
  /** fração das seções do município já totalizadas no momento pedido */
  frac: number; races: DemoUrnaRace[];
}

export class DemoProvider implements Provider {
  private munis = buildMunis();
  private muniByCode = new Map(this.munis.map((m) => [m.m.code, m]));
  private races = new Map<string, Race>();
  private cache = new Map<string, unknown>();
  private epoch: number;
  private cycleMs: number;

  constructor(env = process.env) {
    this.cycleMs = Number(env.DEMO_CYCLE_MINUTES ?? 18) * 60_000;
    this.epoch = Number(env.DEMO_EPOCH ?? 0);
  }

  /** Progresso global da apuração (0–1). 88% do ciclo apurando, o resto com resultado final. */
  private clock(t?: number): number {
    if (t !== undefined && Number.isFinite(t)) return Math.min(1, Math.max(0, t));
    const phase = (((Date.now() - this.epoch) % this.cycleMs) + this.cycleMs) % this.cycleMs / this.cycleMs;
    return Math.min(1, phase / 0.88);
  }

  private muniFrac(ms: MuniStat, g: number): number {
    if (g >= 1) return 1;
    const p = Math.min(1, Math.max(0, (g - ms.start) / ms.dur));
    return Math.floor(ms.sections * p) / ms.sections;
  }

  /** Base para simular zonas, locais de votação e seções de um município. */
  urnaBase(uf: string, mu: string, t?: number): DemoUrnaBase | null {
    const ms = this.muniByCode.get(mu);
    if (!ms || ms.m.uf !== uf) return null;
    const g = this.clock(t);
    const races = (['presidente', 'governador', 'senador', 'depfederal', 'depestadual'] as CargoId[]).map((cargo) => {
      const race = this.race(cargo, cargo === 'presidente' ? null : uf);
      const mi = race.muniIndex.get(mu)!;
      const nc = race.cands.length, np = race.parties.length;
      const prop = CARGOS.find((c) => c.id === cargo)!.proportional;
      return {
        cargo, code: cargoCode(cargo, uf), eleicao: cargo === 'presidente' ? 6257 : 6259, tipo: prop ? 'proporcional' : 'majoritario',
        cands: race.cands.map((c) => ({ numero: Number(c.number), partido: PARTY.get(c.party)?.n ?? Number(c.number.slice(0, 2)) })),
        final: Array.from(race.final.subarray(mi * nc, mi * nc + nc)),
        legend: race.legendFinal.length ? race.parties.map((p, pi) => ({ partido: PARTY.get(p)?.n ?? 0, votos: race.legendFinal[mi * np + pi] })) : [],
        voteMult: race.voteMult, blank: ms.blank * race.blankMult, nul: ms.nul * race.nullMult,
      } satisfies DemoUrnaRace;
    });
    return { name: ms.m.name, capital: ms.m.capital, lon: ms.lon, lat: ms.lat, electorate: ms.electorate, sections: ms.sections, turnout: ms.turnout, frac: this.muniFrac(ms, g), races };
  }

  // ——— Construção das disputas ———
  private race(cargo: CargoId, uf: string | null): Race {
    const key = `${cargo}:${uf ?? 'br'}`;
    let r = this.races.get(key);
    if (!r) { r = cargo === 'presidente' ? this.buildPresident() : CARGOS.find((c) => c.id === cargo)!.proportional ? this.buildProportional(cargo, uf!) : this.buildMajoritarian(cargo, uf!); this.races.set(key, r); }
    return r;
  }

  private finishRace(base: Omit<Race, 'colors' | 'partyColors' | 'muniIndex' | 'eps'>): Race {
    const eps = new Float32Array(base.final.length);
    for (let i = 0; i < eps.length; i++) eps[i] = 0.09 * gauss(`${base.key}:e${i}`);
    const partyColors = assignColors(base.parties, (p) => p, (p) => p);
    return {
      ...base, eps, muniIndex: new Map(base.munis.map((m, i) => [m.m.code, i])),
      colors: new Map(base.cands.map((c) => [c.id, partyColors.get(c.party) ?? -1])), partyColors,
    };
  }

  private buildPresident(): Race {
    const profiles: { party: string; base: number; reg: Partial<Record<Region, number>>; urban: number; amp: number; homeUf?: string }[] = [
      { party: 'PT', base: 0.0, reg: { Norte: 0.2, Nordeste: 0.78, 'Centro-Oeste': -0.35, Sudeste: 0.0, Sul: -0.35 }, urban: -0.05, amp: 0.3 },
      { party: 'PL', base: 0.07, reg: { Norte: 0.28, Nordeste: -0.5, 'Centro-Oeste': 0.5, Sudeste: 0.12, Sul: 0.45 }, urban: -0.1, amp: 0.3 },
      { party: 'PSD', base: -1.75, reg: { Sudeste: 0.15, 'Centro-Oeste': 0.2 }, urban: 0.15, amp: 0.4, homeUf: 'go' },
      { party: 'NOVO', base: -2.7, reg: { Sul: 0.35, Sudeste: 0.3, Nordeste: -0.5 }, urban: 0.7, amp: 0.3, homeUf: 'mg' },
      { party: 'PSOL', base: -3.0, reg: { Sudeste: 0.2 }, urban: 0.9, amp: 0.25 },
      { party: 'MDB', base: -2.9, reg: { Norte: 0.3 }, urban: 0, amp: 0.4, homeUf: 'pa' },
      { party: 'PDT', base: -3.3, reg: { Nordeste: 0.3 }, urban: 0.2, amp: 0.3, homeUf: 'ce' },
      { party: 'MISSÃO', base: -3.5, reg: { Sudeste: 0.25, Sul: 0.2 }, urban: 0.6, amp: 0.3 },
      { party: 'DC', base: -4.6, reg: {}, urban: 0, amp: 0.3 },
    ];
    const cands: DemoCand[] = profiles.map((p, i) => {
      const nm = personName(`pres:${i}`, 0.1);
      const vice = personName(`pres:v${i}`, 0.1);
      const part = PARTY.get(p.party)!;
      return { id: `9900${String(i + 1).padStart(4, '0')}`, number: String(part.n), name: nm.name, fullName: nm.fullName, party: p.party, birth: birth(`pres:${i}`), mates: [{ name: vice.name, party: i === 0 ? 'PSB' : p.party, role: 'v' }] };
    });
    const munis = this.munis;
    const nc = cands.length;
    const final = new Float64Array(munis.length * nc);
    munis.forEach((ms, mi) => {
      const logits = profiles.map((p, ci) => p.base + (p.reg[ms.region] ?? 0) + p.amp * field(`pres:${ci}`, ms.lon, ms.lat, 1.4)
        + (ms.m.capital || ms.electorate > 250_000 ? p.urban : 0) + 0.22 * gauss(`pres:${ci}:${ms.m.code}`)
        + (p.homeUf === ms.m.uf ? 1.1 : 0));
      const valid = ms.electorate * ms.turnout * (1 - ms.blank - ms.nul);
      softmax(logits).forEach((s, ci) => { final[mi * nc + ci] = valid * s; });
    });
    return this.finishRace({ key: 'presidente:br', cargo: 'presidente', uf: null, seats: 1, label: 'Presidente', cands, munis, final, legendFinal: new Float64Array(0), partyOf: new Int32Array(0), parties: [...new Set(cands.map((c) => c.party))], voteMult: 1, blankMult: 1, nullMult: 1, coalition: new Map([[cands[0].id, { name: 'Brasil de Todos', parties: 'PT / PC do B / PV / PSB' }], [cands[1].id, { name: 'Brasil Livre e Forte', parties: 'PL / REPUBLICANOS / PP' }]]) });
  }

  private buildMajoritarian(cargo: CargoId, uf: string): Race {
    const munis = this.munis.filter((m) => m.m.uf === uf);
    const region = ufInfo(uf)!.region;
    const senate = cargo === 'senador';
    const n = (senate ? 5 : 4) + Math.floor(rand(`${cargo}:${uf}:n`) * 3);
    const top = shuffle(['PT', 'PL', 'PSD', 'MDB', 'UNIÃO', 'REPUBLICANOS', 'PSB', 'PP', 'PSDB'], `${cargo}:${uf}:top`);
    const rest = shuffle(['NOVO', 'PSOL', 'PDT', 'PODE', 'AVANTE', 'MISSÃO', 'DC', 'PRTB', 'AGIR', 'PMB'], `${cargo}:${uf}:rest`);
    const parties = [...top.slice(0, 3), ...rest].slice(0, n);
    const gap = senate ? [0, -0.1, -0.35, -1.0, -1.8, -2.4, -3.0] : [0, -0.05 - 0.45 * rand(`${cargo}:${uf}:gap`), -1.1, -1.9, -2.5, -3.1];
    const capital = munis.find((m) => m.m.capital) ?? munis[0];
    const bigInterior = [...munis].filter((m) => !m.m.capital).sort((a, b) => b.electorate - a.electorate)[0] ?? capital;
    const cands: DemoCand[] = parties.map((party, i) => {
      const seed = `${cargo}:${uf}:${i}`;
      const nm = personName(seed);
      const part = PARTY.get(party)!;
      const number = senate ? `${part.n}${1 + Math.floor(rand(seed + 'n') * 9)}` : String(part.n);
      const mates: Running[] = senate
        ? [{ name: personName(seed + 's1').name, party, role: 's1' }, { name: personName(seed + 's2').name, party, role: 's2' }]
        : [{ name: personName(seed + 'v').name, party: pick(top, seed + 'vp'), role: 'v' }];
      return { id: `${senate ? 95 : 93}${String(UFS.findIndex((u) => u.uf === uf)).padStart(2, '0')}${String(i + 1).padStart(4, '0')}`, number, name: nm.name, fullName: nm.fullName, party, mates, birth: birth(seed) };
    });
    const nc = cands.length;
    const final = new Float64Array(munis.length * nc);
    const homes = cands.map((_, i) => (i === 0 ? capital : i === 1 ? bigInterior : munis[Math.floor(rand(`${cargo}:${uf}:h${i}`) * munis.length)]));
    munis.forEach((ms, mi) => {
      const logits = cands.map((c, ci) => (gap[ci] ?? -3.5) + (PARTY.get(c.party)?.region?.[region] ?? 0) * 0.6
        + 0.5 * field(`${cargo}:${uf}:${ci}`, ms.lon, ms.lat, 3) + 0.2 * gauss(`${cargo}:${uf}:${ci}:${ms.m.code}`)
        + 0.7 * Math.exp(-distKm(ms, homes[ci].lon, homes[ci].lat) / 90));
      const valid = ms.electorate * ms.turnout * (1 - ms.blank * 1.5 - ms.nul * 1.2) * (senate ? 2 : 1);
      softmax(logits).forEach((s, ci) => { final[mi * nc + ci] = valid * s; });
    });
    const names = [`Juntos por ${ufName(uf)}`, `${ufName(uf)} Pra Frente`, `Renova ${ufName(uf)}`, `Coragem para Mudar`, `Unidos por ${ufName(uf)}`];
    const coalition = new Map(cands.slice(0, 2).map((c, i) => [c.id, { name: pick(names, `${cargo}:${uf}:co${i}`), parties: [c.party, ...shuffle(top.filter((p) => p !== c.party), `${cargo}:${uf}:cp${i}`).slice(0, 2)].join(' / ') }]));
    return this.finishRace({ key: `${cargo}:${uf}`, cargo, uf, seats: senate ? 2 : 1, label: cargoLabel(cargo, uf), cands, munis, final, legendFinal: new Float64Array(0), partyOf: new Int32Array(0), parties: [...new Set(parties)], voteMult: senate ? 2 : 1, blankMult: 1.5, nullMult: 1.2, coalition });
  }

  private buildProportional(cargo: CargoId, uf: string): Race {
    const munis = this.munis.filter((m) => m.m.uf === uf);
    const region = ufInfo(uf)!.region;
    const seats = cargo === 'depfederal' ? FED_SEATS[uf] : stateSeats(uf);
    const total = Math.min(seats * 2 + (cargo === 'depfederal' ? 18 : 22), cargo === 'depfederal' ? 150 : 170);
    const strength = PARTIES.map((p) => p.strength + (p.region?.[region] ?? 0) + 0.2 * gauss(`${cargo}:${uf}:ps:${p.sg}`));
    const share = softmax(strength.map((s) => s * 1.4));
    const parties = PARTIES.map((p) => p.sg);
    const perParty = share.map((s) => Math.max(1, Math.round(s * total)));
    const cands: DemoCand[] = [];
    const pulls: number[] = [], homes: MuniStat[] = [], partyOfArr: number[] = [];
    const used = new Set<string>();
    const weighted = (seed: string) => { let x = rand(seed) * munis.reduce((s, m) => s + Math.sqrt(m.electorate), 0); for (const m of munis) { x -= Math.sqrt(m.electorate); if (x <= 0) return m; } return munis[0]; };
    PARTIES.forEach((p, pi) => {
      for (let k = 0; k < perParty[pi]; k++) {
        const seed = `${cargo}:${uf}:${p.sg}:${k}`;
        let num = '';
        for (let tries = 0; tries < 50 && (!num || used.has(num)); tries++) num = `${p.n}${String(Math.floor(rand(seed + 'n' + tries) * (cargo === 'depfederal' ? 100 : 1000))).padStart(cargo === 'depfederal' ? 2 : 3, '0')}`;
        used.add(num);
        const nm = personName(seed, 0.22);
        cands.push({ id: `${cargo === 'depfederal' ? 96 : 97}${String(UFS.findIndex((u) => u.uf === uf)).padStart(2, '0')}${String(cands.length + 1).padStart(4, '0')}`, number: num, name: nm.name, fullName: nm.fullName, party: p.sg, mates: [], birth: birth(seed) });
        pulls.push(Math.exp(1.15 * gauss(seed + 'pull') + (k === 0 ? 1.1 : k === 1 ? 0.5 : 0)));
        homes.push(weighted(seed + 'home'));
        partyOfArr.push(pi);
      }
    });
    const nc = cands.length, np = parties.length;
    const final = new Float64Array(munis.length * nc);
    const legendFinal = new Float64Array(munis.length * np);
    const legendRate = parties.map((p) => 0.025 + 0.07 * rand(`${cargo}:${uf}:lg:${p}`) + (p === 'PT' || p === 'PSOL' || p === 'NOVO' ? 0.05 : 0));
    munis.forEach((ms, mi) => {
      const valid = ms.electorate * ms.turnout * (1 - ms.blank * 1.9 - ms.nul * 1.3);
      const ps = softmax(strength.map((s, pi) => s * 1.4 + 0.5 * field(`${cargo}:${uf}:pf:${parties[pi]}`, ms.lon, ms.lat, 3) + 0.15 * gauss(`${cargo}:${ms.m.code}:${pi}`)));
      const weights = cands.map((_, ci) => pulls[ci] * (0.12 + 4 * Math.exp(-distKm(ms, homes[ci].lon, homes[ci].lat) / 70)));
      const byParty = new Float64Array(np);
      weights.forEach((w, ci) => { byParty[partyOfArr[ci]] += w; });
      for (let pi = 0; pi < np; pi++) legendFinal[mi * np + pi] = valid * ps[pi] * legendRate[pi];
      weights.forEach((w, ci) => {
        const pi = partyOfArr[ci];
        final[mi * nc + ci] = byParty[pi] ? valid * ps[pi] * (1 - legendRate[pi]) * (w / byParty[pi]) : 0;
      });
    });
    return this.finishRace({ key: `${cargo}:${uf}`, cargo, uf, seats, label: cargoLabel(cargo, uf), cands, munis, final, legendFinal, partyOf: Int32Array.from(partyOfArr), parties, voteMult: 1, blankMult: 1.9, nullMult: 1.3, coalition: new Map() });
  }

  // ——— Agregação por escopo e momento da apuração ———
  private aggregate(race: Race, idx: number[], g: number) {
    const nc = race.cands.length, np = race.parties.length;
    const votes = new Float64Array(nc), legend = new Float64Array(np);
    let sections = 0, counted = 0, electorate = 0, estCounted = 0, turnout = 0, blank = 0, nul = 0;
    for (const mi of idx) {
      const ms = race.munis[mi];
      const f = this.muniFrac(ms, g);
      sections += ms.sections; counted += Math.round(ms.sections * f); electorate += ms.electorate;
      if (f <= 0) continue;
      const est = ms.electorate * f, c = est * ms.turnout;
      estCounted += est; turnout += c;
      blank += c * race.voteMult * ms.blank * race.blankMult; nul += c * race.voteMult * ms.nul * race.nullMult;
      const drift = 1 - f;
      for (let ci = 0; ci < nc; ci++) votes[ci] += Math.round(race.final[mi * nc + ci] * f * (1 + race.eps[mi * nc + ci] * drift));
      if (race.legendFinal.length) for (let pi = 0; pi < np; pi++) legend[pi] += Math.round(race.legendFinal[mi * np + pi] * f);
    }
    return { votes, legend, sections, counted, electorate, estCounted: Math.round(estCounted), turnout: Math.round(turnout), blank: Math.round(blank), nul: Math.round(nul) };
  }

  private statusOf(pct: number): CountStatus { return pct >= 100 ? 'encerrada' : pct > 0 ? 'apurando' : 'aguardando'; }

  /** Situação de cada candidato calculada sobre a disputa inteira (Brasil ou UF), como faz o TSE. */
  private raceOutcome(race: Race, g: number) {
    const key = `outcome:${race.key}:${Math.round(g * 4000)}`;
    const hit = this.cache.get(key) as ReturnType<DemoProvider['computeOutcome']> | undefined;
    if (hit) return hit;
    const out = this.computeOutcome(race, g);
    this.cacheSet(key, out);
    return out;
  }

  private computeOutcome(race: Race, g: number) {
    const all = race.munis.map((_, i) => i);
    const agg = this.aggregate(race, all, g);
    const final = g >= 1;
    const status = new Map<string, { elected: boolean; projected: boolean; status: string }>();
    const seatsByParty = new Map<string, number>();
    let quotient: number | undefined;
    if (CARGOS.find((c) => c.id === race.cargo)!.proportional) {
      const groups = new Map<string, SeatGroup>();
      race.cands.forEach((c, ci) => {
        const gid = PARTY.get(c.party)?.fed ?? c.party;
        if (!groups.has(gid)) groups.set(gid, { id: gid, legend: 0, cands: [] });
        groups.get(gid)!.cands.push({ id: c.id, votes: agg.votes[ci] });
      });
      race.parties.forEach((p, pi) => { const gid = PARTY.get(p)?.fed ?? p; if (groups.has(gid)) groups.get(gid)!.legend += agg.legend[pi]; });
      const res = allocateSeats([...groups.values()], race.seats);
      quotient = res.quotient;
      race.cands.forEach((c) => {
        const how = res.elected.get(c.id);
        const gid = PARTY.get(c.party)?.fed ?? c.party;
        if (how) seatsByParty.set(c.party, (seatsByParty.get(c.party) ?? 0) + 1);
        status.set(c.id, final
          ? { elected: !!how, projected: false, status: how ? `Eleito por ${how}` : (res.seatsByGroup.get(gid) ? 'Suplente' : 'Não eleito') }
          : { elected: false, projected: !!how, status: '' });
      });
    } else if (final) {
      const order = race.cands.map((c, ci) => ({ c, v: agg.votes[ci] })).sort((a, b) => b.v - a.v);
      const valid = order.reduce((s, x) => s + x.v, 0);
      if (race.cargo === 'senador') order.forEach((x, i) => status.set(x.c.id, { elected: i < race.seats, projected: false, status: i < race.seats ? 'Eleito' : 'Não eleito' }));
      else if (order[0].v > valid / 2) order.forEach((x, i) => status.set(x.c.id, { elected: i === 0, projected: false, status: i === 0 ? 'Eleito' : 'Não eleito' }));
      else order.forEach((x, i) => status.set(x.c.id, { elected: false, projected: false, status: i < 2 ? '2º turno' : 'Não eleito' }));
    }
    return { status, seatsByParty, quotient };
  }

  private cacheSet(key: string, v: unknown) {
    if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, v);
  }

  private buildResult(race: Race, scope: Scope, idx: number[], g: number): Result {
    const agg = this.aggregate(race, idx, g);
    const outcome = this.raceOutcome(race, g);
    const nominal = agg.votes.reduce((s, v) => s + v, 0);
    const legendTotal = agg.legend.reduce((s, v) => s + v, 0);
    const valid = nominal + legendTotal;
    const tv = valid + agg.blank + agg.nul;
    const pctCounted = agg.sections ? (agg.counted / agg.sections) * 100 : 0;
    const totals: Totals = {
      sections: agg.sections, sectionsCounted: agg.counted, pctCounted,
      electorate: agg.electorate, turnout: agg.turnout, turnoutPct: agg.estCounted ? (agg.turnout / agg.estCounted) * 100 : 0,
      abstention: agg.estCounted - agg.turnout, abstentionPct: agg.estCounted ? ((agg.estCounted - agg.turnout) / agg.estCounted) * 100 : 0,
      totalVotes: tv, valid, nominal, legend: legendTotal, blank: agg.blank, blankPct: tv ? (agg.blank / tv) * 100 : 0, nulls: agg.nul, nullPct: tv ? (agg.nul / tv) * 100 : 0,
    };
    const candidates: Candidate[] = race.cands.map((c, ci) => {
      const st = outcome.status.get(c.id);
      const part = PARTY.get(c.party)!;
      const co = race.coalition.get(c.id);
      return {
        id: c.id, number: c.number, name: c.name, fullName: c.fullName, party: c.party, partyName: part?.name ?? c.party,
        federation: part?.fed ? FED_LABEL[part.fed] : undefined, coalition: co?.name ?? (part?.fed ? `Federação ${part.fed}` : undefined), coalitionParties: co?.parties,
        votes: agg.votes[ci], pct: valid ? (agg.votes[ci] / valid) * 100 : 0, elected: st?.elected ?? false, projected: st?.projected || undefined,
        status: st?.status ?? '', valid: true, runningMates: c.mates, birth: c.birth, photo: null, color: race.colors.get(c.id) ?? -1,
      };
    }).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    const parties: PartyResult[] = race.parties.map((p, pi) => {
      const mine = candidates.filter((c) => c.party === p);
      const votes = mine.reduce((s, c) => s + c.votes, 0) + (agg.legend[pi] ?? 0);
      const part = PARTY.get(p);
      return {
        party: p, name: part?.name ?? p, federation: part?.fed ? FED_LABEL[part.fed] : undefined, votes, legend: agg.legend[pi] ?? 0,
        pct: valid ? (votes / valid) * 100 : 0, candidates: mine.length, elected: mine.filter((c) => c.elected).length,
        seats: outcome.seatsByParty.get(p), color: race.partyColors.get(p) ?? -1,
      };
    }).filter((p) => p.candidates > 0).sort((a, b) => b.votes - a.votes);
    const status = this.statusOf(pctCounted);
    let scopeName = 'Brasil';
    if (scope.level === 'uf') scopeName = ufName(scope.uf!);
    if (scope.level === 'mu') { const m = race.munis[race.muniIndex.get(scope.mu!)!]?.m; scopeName = m ? `${m.name} (${m.uf.toUpperCase()})` : scope.mu!; }
    return {
      cargo: race.cargo, cargoLabel: race.label, scope, scopeName, seats: race.seats, quotient: outcome.quotient,
      status, mathDefined: g >= 1, updatedAt: new Date(Date.now() - (1 - g) * 1000).toISOString(),
      totals, candidates, parties, source: 'demo', verified: null, round: 1,
    };
  }

  private indicesFor(race: Race, scope: Scope): number[] {
    if (scope.level === 'mu') { const i = race.muniIndex.get(scope.mu!); if (i === undefined) throw new Error('Município não encontrado.'); return [i]; }
    if (scope.level === 'uf' && race.uf === null) return race.munis.flatMap((m, i) => (m.m.uf === scope.uf ? [i] : []));
    return race.munis.map((_, i) => i);
  }

  // ——— API do provedor ———
  async meta(round: number): Promise<MetaPayload> {
    return {
      name: 'Radar Eleições - Triad3', source: 'demo', sourceLabel: 'Simulação Radar Eleições — candidatos e votos fictícios', sourceUrl: '',
      round, rounds: [1], electionDate: '04/10/2026', warnings: [], refreshSeconds: 5,
      cargos: CARGOS.map((c) => ({ id: c.id, label: c.label, levels: c.national ? ['br', 'uf', 'mu'] : ['uf', 'mu'] })),
    };
  }

  async municipalities(): Promise<Municipality[]> { return MUNICIPALITIES; }

  async result(cargo: CargoId, scope: Scope, _round: number, t?: number): Promise<Result> {
    const g = this.clock(t);
    const uf = scope.level === 'br' ? null : scope.uf!;
    if (cargo !== 'presidente' && !uf) throw new Error('Este cargo é disputado por estado — escolha uma UF.');
    const key = `res:${cargo}:${scope.level}:${scope.uf ?? ''}:${scope.mu ?? ''}:${Math.round(g * 4000)}`;
    const hit = this.cache.get(key) as Result | undefined;
    if (hit) return hit;
    const race = this.race(cargo, cargo === 'presidente' ? null : uf);
    const r = this.buildResult(race, scope, this.indicesFor(race, scope), g);
    this.cacheSet(key, r);
    return r;
  }

  async map(cargo: CargoId, parent: Scope, focus: string[], round: number, t?: number): Promise<MapPayload> {
    const areas: MapArea[] = [];
    const cands = new Map<string, CandidateLite>();
    const add = (r: Result, n: number) => r.candidates.slice(0, n).forEach((c) => { if (!cands.has(c.id)) cands.set(c.id, { id: c.id, name: c.name, number: c.number, party: c.party, color: c.color, photo: c.photo }); });
    let updatedAt: string | null = null;
    if (parent.level === 'br') {
      for (const u of UFS) {
        const r = await this.result(cargo, { level: 'uf', uf: u.uf }, round, t);
        areas.push(areaFromResult(u.uf, r, focus));
        if (cargo !== 'presidente') add(r, 6);
        updatedAt = r.updatedAt;
      }
      if (cargo === 'presidente') add(await this.result(cargo, { level: 'br' }, round, t), 99);
    } else {
      const uf = parent.uf!;
      const head = await this.result(cargo, { level: 'uf', uf }, round, t);
      add(head, 999);
      updatedAt = head.updatedAt;
      const g = this.clock(t);
      const race = this.race(cargo, cargo === 'presidente' ? null : uf);
      for (const ms of race.munis) {
        if (ms.m.uf !== uf) continue;
        const r = this.buildResult(race, { level: 'mu', uf, mu: ms.m.code }, [race.muniIndex.get(ms.m.code)!], g);
        areas.push(areaFromResult(ms.m.code, r, focus));
      }
    }
    return { cargo, parent, areas, candidates: [...cands.values()], pending: 0, total: areas.length, updatedAt, source: 'demo' };
  }

  async progress(_round: number, t?: number): Promise<ProgressRow[]> {
    const g = this.clock(t);
    const race = this.race('presidente', null);
    return UFS.map((u) => {
      const agg = this.aggregate(race, this.indicesFor(race, { level: 'uf', uf: u.uf }), g);
      const pct = agg.sections ? (agg.counted / agg.sections) * 100 : 0;
      return { uf: u.uf, pctCounted: pct, turnoutPct: agg.estCounted ? (agg.turnout / agg.estCounted) * 100 : 0, status: this.statusOf(pct), updatedAt: null };
    });
  }
}

