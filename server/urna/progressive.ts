// Carga progressiva de muitos arquivos pequenos (ex.: um boletim por seção), com concorrência limitada.
// Cada consulta espera a carga avançar por até `waitMs` (funciona em serverless) e devolve o que já chegou;
// na Vercel a carga continua depois da resposta (waitUntil), dentro do tempo máximo da função.
import { emSegundoPlano } from '../runtime.ts';
interface Run<T> { items: string[]; done: Map<string, T>; tried: Set<string>; running: boolean; startedAt: number; touched: number; run?: Promise<void> }

export class Progressive<T> {
  private runs = new Map<string, Run<T>>();
  constructor(private concurrency = 6, private refreshMs = 45_000, private waitMs = 4_000) {}

  async get(key: string, items: string[], fetchOne: (item: string) => Promise<T>): Promise<{ done: Map<string, T>; pending: number }> {
    let r = this.runs.get(key);
    if (!r || r.items.length !== items.length) { r = { items, done: new Map(), tried: new Set(), running: false, startedAt: 0, touched: 0 }; this.runs.set(key, r); }
    r.touched = Date.now();
    if (!r.running && Date.now() - r.startedAt > this.refreshMs) {
      const run = r;
      run.running = true; run.startedAt = Date.now();
      let next = 0;
      const worker = async () => {
        while (next < run.items.length) {
          const item = run.items[next++];
          try { run.done.set(item, await fetchOne(item)); } catch { /* fica para a próxima rodada */ }
          run.tried.add(item);
        }
      };
      run.run = Promise.all(Array.from({ length: this.concurrency }, worker)).then(() => undefined).finally(() => { run.running = false; run.run = undefined; });
      emSegundoPlano(run.run);
    }
    if (r.run && this.waitMs > 0 && r.tried.size < r.items.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([r.run, new Promise<void>((res) => { timer = setTimeout(res, this.waitMs); })]);
      clearTimeout(timer);
    }
    for (const [k, v] of this.runs) if (Date.now() - v.touched > 900_000) this.runs.delete(k);
    return { done: r.done, pending: r.items.filter((i) => !r!.tried.has(i)).length };
  }
}
