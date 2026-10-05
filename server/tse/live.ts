// Provedor ao vivo: lê a configuração oficial (EA11), a lista de municípios (EA12),
// o acompanhamento (EA14) e os resultados (EA20) — via API BP com fallback ao TSE.
import { CARGOS, cargoCode, cargoLabel } from '../../shared/cargos.ts';
import { num } from '../../shared/format.ts';
import { ufName, UFS } from '../../shared/ufs.ts';
import type { CargoId, CandidateLite, MapArea, MapPayload, MetaPayload, Municipality, ProgressRow, Result, Scope, SourceKind } from '../../shared/types.ts';
import { MUN_BY_CODE } from '../geo-index.ts';
import { areaFromResult, type Provider } from '../provider.ts';
import { normalizeProgress, normalizeResult } from './normalize.ts';
import { BROWSER_UA, Upstream, sourcesFromEnv, type Fetched } from './upstream.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;
const pad = (s: string | number, n: number) => String(s).padStart(n, '0');

export interface RoundCtx { round: number; pleito: string; date: string; elections: Raw[] }
export interface Ctx { cycle: string; dirs: Record<string, string>; rounds: RoundCtx[]; munis: Municipality[]; munByCode: Map<string, Municipality> }

interface Stored { area: MapArea; top: Result['candidates']; many: boolean; updatedAt: string | null; source: SourceKind }
interface Loader { items: string[]; done: Map<string, Stored>; tried: Set<string>; running: boolean; startedAt: number; touched: number; run?: Promise<void> }

export class LiveProvider implements Provider {
  readonly up: Upstream;
  private ctx: { value: Ctx; at: number } | null = null;
  private ctxTask: Promise<Ctx> | null = null;
  private loaders = new Map<string, Loader>();
  private cycle: string;
  private refresh: number;
  private mapWait: number;

  constructor(env = process.env) {
    this.up = new Upstream(sourcesFromEnv(env), Number(env.AGORA_CONCURRENCY ?? 6));
    this.cycle = env.AGORA_CYCLE ?? 'ele2026';
    this.refresh = Number(env.AGORA_REFRESH ?? 30);
    this.mapWait = Number(env.AGORA_MAP_WAIT_MS ?? 4000);
  }

  /** Primeiro caminho que responder; `validate` recusa respostas 200 que não são o arquivo esperado. */
  async getAny(paths: string[], ttl: number, validate?: (v: Raw) => boolean): Promise<Fetched> {
    let err: unknown;
    const ok = validate && ((v: unknown) => !!v && typeof v === 'object' && validate(v as Raw));
    for (const p of paths) {
      try { return await this.up.get(p, ttl, ok); } catch (e) { err = e; }
    }
    throw err;
  }

  async context(): Promise<Ctx> {
    if (this.ctx && Date.now() - this.ctx.at < 300_000) return this.ctx.value;
    if (!this.ctxTask) {
      this.ctxTask = this.loadContext().then((v) => { this.ctx = { value: v, at: Date.now() }; return v; })
        .finally(() => { this.ctxTask = null; });
    }
    try { return await this.ctxTask; } catch (e) { if (this.ctx) return this.ctx.value; throw e; }
  }

  private async loadContext(): Promise<Ctx> {
    const cfg = (await this.getAny(['/oficial/comum/config/ele-c.jws', '/oficial/comum/config/ele-c.json'], 300_000, (v) => Array.isArray(v.pl))).value as Raw;
    const dirs: Record<string, string> = Object.fromEntries((cfg.arq ?? []).map((a: Raw) => [a.tp, String(a.dir)]));
    const pleitos = (cfg.pl ?? []).filter((p: Raw) => p.c === this.cycle);
    if (!pleitos.length) throw new Error(`Ciclo ${this.cycle} não encontrado na configuração oficial.`);
    const rounds: RoundCtx[] = [];
    for (const p of pleitos) {
      const ordinary = (p.e ?? []).filter((e: Raw) => (e.abr ?? []).some((a: Raw) => (a.cp ?? []).some((c: Raw) => [1, 3, 5, 6, 7, 8].includes(num(c.cd)))));
      if (!ordinary.length) continue;
      const round = num(ordinary[0].t) || 1;
      rounds.push({ round, pleito: String(p.cd), date: String(p.dt), elections: ordinary });
    }
    rounds.sort((a, b) => a.round - b.round);
    const ctx: Ctx = { cycle: this.cycle, dirs, rounds, munis: [], munByCode: new Map() };
    // Lista oficial de municípios (EA12) da eleição estadual do 1º turno.
    const first = rounds[0];
    const stateEle = first && this.electionFor(first, 'governador');
    if (stateEle) {
      try {
        const cmBase = `${this.dir(ctx, 'cm', stateEle, 'br', first.pleito)}/mun-e${pad(stateEle, 6)}-cm`;
        const cm = (await this.getAny([`${cmBase}.jws`, `${cmBase}.json`], 3_600_000, (v) => Array.isArray(v.abr))).value as Raw;
        for (const a of cm.abr ?? []) {
          for (const m of a.mu ?? []) {
            const code = pad(m.cd, 5), known = MUN_BY_CODE.get(code);
            ctx.munis.push({ code, ibge: String(m.cdi ?? known?.ibge ?? ''), name: String(m.nm), uf: String(a.cd).toLowerCase(), capital: m.c === 's', lon: known?.lon ?? null, lat: known?.lat ?? null });
          }
        }
      } catch { /* usa o índice local */ }
    }
    if (!ctx.munis.length) ctx.munis = [...MUN_BY_CODE.values()];
    ctx.munis = ctx.munis.filter((m) => UFS.some((u) => u.uf === m.uf)); // exterior (ZZ) fica fora do mapa
    ctx.munByCode = new Map(ctx.munis.map((m) => [m.code, m]));
    return ctx;
  }

  roundCtx(ctx: Ctx, round: number): RoundCtx {
    const r = ctx.rounds.find((x) => x.round === round) ?? ctx.rounds[0];
    if (!r) throw new Error('Nenhum turno disponível na configuração oficial.');
    return r;
  }

  private electionFor(r: RoundCtx, cargo: CargoId, uf?: string): string | null {
    const code = cargoCode(cargo, uf);
    const e = r.elections.find((el) => (el.abr ?? []).some((a: Raw) => (cargo === 'presidente' || !uf || ['br', uf].includes(String(a.cd).toLowerCase())) && (a.cp ?? []).some((c: Raw) => num(c.cd) === code)));
    return e ? String(e.cd) : null;
  }

  dir(ctx: Ctx, tp: string, ele: string, uf: string, pleito: string, extra: Record<string, string> = {}): string {
    const DEFAULTS: Record<string, string> = {
      ft: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>', cm: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/config',
      cs: '<base>/<ambiente>/<ciclo>/arquivo-urna/<cd_pleito>/config/<uf>', aux: '<base>/<ambiente>/<ciclo>/arquivo-urna/<cd_pleito>/dados/<uf>/<municipio>/<zona>/<secao>',
    };
    const tpl = ctx.dirs[tp] ?? DEFAULTS[tp] ?? '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>';
    const rep: Record<string, string> = { base: '', ambiente: 'oficial', ciclo: ctx.cycle, cd_eleicao: ele, cd_pleito: pleito, uf, ...extra };
    return tpl.replace(/<([^>]+)>/g, (_, k) => rep[k] ?? '').replace(/\/$/, '');
  }

  private scopeName(ctx: Ctx, scope: Scope): string {
    if (scope.level === 'br') return 'Brasil';
    if (scope.level === 'uf') return ufName(scope.uf!);
    const m = ctx.munByCode.get(scope.mu!);
    return m ? `${m.name} (${m.uf.toUpperCase()})` : scope.mu!;
  }

  async meta(round: number): Promise<MetaPayload> {
    const warnings: string[] = [];
    let rounds = [1], date = '04/10/2026';
    try {
      const ctx = await this.context();
      rounds = ctx.rounds.map((r) => r.round);
      date = this.roundCtx(ctx, round).date;
    } catch (e) {
      warnings.push(`Fonte ao vivo indisponível no momento: ${(e as Error).message}`);
    }
    const s = this.up.sources[0];
    return {
      name: 'Radar Eleições - Triad3', source: s.kind, sourceLabel: this.up.sources.map((x) => x.label).join(' → '), sourceUrl: s.base,
      round, rounds, electionDate: date, warnings, refreshSeconds: this.refresh,
      cargos: CARGOS.map((c) => ({ id: c.id, label: c.label, levels: c.national ? ['br', 'uf', 'mu'] : ['uf', 'mu'] })),
    };
  }

  async municipalities(): Promise<Municipality[]> {
    try { return (await this.context()).munis; } catch { return [...MUN_BY_CODE.values()]; }
  }

  async result(cargo: CargoId, scope: Scope, round: number): Promise<Result> {
    const ctx = await this.context();
    const r = this.roundCtx(ctx, round);
    const uf = scope.level === 'br' ? undefined : scope.uf!;
    if (cargo !== 'presidente' && !uf) throw new Error('Este cargo é disputado por estado — escolha uma UF.');
    const ele = this.electionFor(r, cargo, uf);
    if (!ele) throw new Error(`${cargoLabel(cargo, uf)} não está em disputa neste turno${uf ? ` em ${uf.toUpperCase()}` : ''}.`);
    const dirUf = uf ?? 'br';
    const file = `${dirUf}${scope.level === 'mu' ? scope.mu : ''}-c${pad(cargoCode(cargo, uf), 4)}-e${pad(ele, 6)}-u`;
    const base = this.dir(ctx, 'u', ele, dirUf, r.pleito);
    const ttl = scope.level === 'mu' ? 45_000 : 15_000;
    const got = await this.getAny([`${base}/${file}.jws`, `${base}/${file}.json`], ttl, (v) => Array.isArray(v.carg));
    const photoDir = this.dir(ctx, 'ft', ele, cargo === 'presidente' ? 'br' : dirUf, r.pleito);
    return normalizeResult(got.value as Raw, {
      scope, scopeName: this.scopeName(ctx, scope), source: got.source as SourceKind, verified: got.verified, round: r.round,
      photo: (id) => `/api/foto?p=${encodeURIComponent(`${photoDir}/${id}.jpeg`)}`,
    });
  }

  /** Carregamento progressivo das áreas do mapa (municípios chegam aos poucos, respeitando limites da fonte). */
  private loader(key: string, items: string[], fetchOne: (code: string) => Promise<Result>): Loader {
    let l = this.loaders.get(key);
    if (!l) { l = { items, done: new Map(), tried: new Set(), running: false, startedAt: 0, touched: Date.now() }; this.loaders.set(key, l); }
    l.touched = Date.now();
    const stale = Date.now() - l.startedAt > this.refresh * 1000;
    if (!l.running && stale) {
      l.running = true; l.startedAt = Date.now();
      const loader = l;
      loader.run = (async () => {
        let next = 0;
        const worker = async () => {
          while (next < loader.items.length) {
            const code = loader.items[next++];
            try {
              const r = await fetchOne(code);
              // Guarda só o essencial (votos não nulos) — economiza memória em proporcionais com ~1000 candidatos.
              const area = areaFromResult(code, r, []);
              area.votes = Object.fromEntries(r.candidates.filter((c) => c.votes > 0).map((c) => [c.id, c.votes]));
              loader.done.set(code, { area, top: r.candidates.slice(0, 6), many: r.candidates.length > 30, updatedAt: r.updatedAt, source: r.source });
            } catch { /* mantém o anterior; arquivo ainda não publicado pela fonte */ }
            loader.tried.add(code);
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
      })().finally(() => { loader.running = false; loader.run = undefined; });
    }
    // descarta carregadores sem uso
    for (const [k, v] of this.loaders) if (Date.now() - v.touched > 600_000) this.loaders.delete(k);
    return l;
  }

  async map(cargo: CargoId, parent: Scope, focus: string[], round: number): Promise<MapPayload> {
    const ctx = await this.context();
    let items: string[], fetchOne: (code: string) => Promise<Result>;
    let header: Result | null = null;
    if (parent.level === 'br') {
      items = UFS.map((u) => u.uf);
      fetchOne = (uf) => this.result(cargo, { level: 'uf', uf }, round);
      if (cargo === 'presidente') header = await this.result(cargo, { level: 'br' }, round).catch(() => null);
    } else {
      const uf = parent.uf!;
      items = ctx.munis.filter((m) => m.uf === uf).map((m) => m.code);
      fetchOne = (mu) => this.result(cargo, { level: 'mu', uf, mu }, round);
      header = await this.result(cargo, { level: 'uf', uf }, round).catch(() => null);
    }
    const l = this.loader(`${round}:${cargo}:${parent.level}:${parent.uf ?? ''}`, items, fetchOne);
    // Em ambientes serverless (Vercel) o trabalho só roda garantidamente dentro da requisição:
    // na primeira carga, espera avançar alguns segundos (as atualizações seguintes não bloqueiam a resposta).
    if (l.run && this.mapWait > 0 && l.tried.size < l.items.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([l.run, new Promise<void>((r) => { timer = setTimeout(r, this.mapWait); })]);
      clearTimeout(timer);
    }
    const areas: MapArea[] = [];
    const cands = new Map<string, CandidateLite>();
    const addCand = (c: Result['candidates'][number]) => { if (!cands.has(c.id)) cands.set(c.id, { id: c.id, name: c.name, number: c.number, party: c.party, color: c.color, photo: c.photo }); };
    for (const s of l.done.values()) {
      let votes = s.area.votes;
      if (s.many) {
        const keep = new Set([...s.top.map((c) => c.id), ...focus]);
        votes = Object.fromEntries(Object.entries(votes).filter(([id]) => keep.has(id)));
      }
      areas.push({ ...s.area, votes });
      if (!header) s.top.forEach(addCand);
    }
    if (header) header.candidates.forEach(addCand);
    const updated = [...l.done.values()].map((s) => s.updatedAt).filter(Boolean).sort().at(-1) ?? header?.updatedAt ?? null;
    const src = [...l.done.values()][0]?.source ?? header?.source ?? this.up.sources[0].kind;
    // pendentes = ainda não consultados nesta carga (falhas contam como consultadas, para não girar para sempre)
    return { cargo, parent, areas, candidates: [...cands.values()], pending: items.filter((c) => !l.tried.has(c)).length, total: items.length, updatedAt: updated, source: src };
  }

  async progress(round: number): Promise<ProgressRow[]> {
    const ctx = await this.context();
    const r = this.roundCtx(ctx, round);
    const ele = this.electionFor(r, 'presidente');
    if (!ele) return [];
    const base = this.dir(ctx, 'ab', ele, 'br', r.pleito);
    const got = await this.getAny([`${base}/br-e${pad(ele, 6)}-ab.jws`, `${base}/br-e${pad(ele, 6)}-ab.json`], 15_000, (v) => Array.isArray(v.abr));
    return normalizeProgress(got.value as Raw);
  }

  private photos = new Map<string, { body: Buffer; type: string } | null>();
  async photo(path: string) {
    if (!/^\/oficial\/[\w/.-]+\.jpe?g$/.test(path)) return null;
    if (this.photos.has(path)) return this.photos.get(path)!;
    let out: { body: Buffer; type: string } | null = null;
    for (const s of this.up.sources) {
      try {
        const res = await fetch(s.base + path, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8_000) });
        if (res.ok) { out = { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/jpeg' }; break; }
      } catch { /* próxima fonte */ }
    }
    if (this.photos.size > 3000) this.photos.delete(this.photos.keys().next().value!);
    this.photos.set(path, out);
    return out;
  }
}
