import { useState } from 'react';
import { cargoLabel } from '../../shared/cargos';
import { ufName } from '../../shared/ufs';
import { linhasCsv, nomeArquivo, type ContextoRel, type Relatorio } from '../lib/relatorio';
import { useApp } from '../state';
import { downloadCsv } from './ui';

/** Cargo, local, apuração e fonte do que está na tela — vão no cabeçalho e no rodapé do PDF. */
export function useContextoRel(local?: string): ContextoRel {
  const { route, result, meta, isDemo } = useApp();
  const r = result.data;
  return {
    cargo: cargoLabel(route.cargo, route.uf),
    local: local ?? r?.scopeName ?? (route.uf ? ufName(route.uf) : 'Brasil'),
    turno: route.turno,
    apurado: r?.totals.pctCounted ?? null,
    atualizado: r?.updatedAt ?? null,
    fonte: meta?.sourceLabel ?? 'TSE',
    demo: isDemo,
  };
}

/** Botões de exportação: planilha (CSV) e relatório para imprimir ou enviar (PDF). */
export function Exportar({ montar, local }: { montar: () => Relatorio; local?: string }) {
  const ctx = useContextoRel(local);
  const [gerando, setGerando] = useState(false);
  const pdf = async () => {
    setGerando(true);
    try {
      const { baixarPdf } = await import('../lib/pdf');
      await baixarPdf(montar(), ctx);
    } catch (e) {
      window.alert(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setGerando(false);
    }
  };
  return (
    <span className="export-btns">
      <button className="ghost-btn" onClick={() => { const r = montar(); downloadCsv(`${nomeArquivo(r.arquivo)}.csv`, linhasCsv(r)); }} title="Planilha (Excel)">⭳ CSV</button>
      <button className="ghost-btn" onClick={pdf} disabled={gerando} title="Relatório em PDF">{gerando ? <><span className="spinner" /> PDF</> : '⭳ PDF'}</button>
    </span>
  );
}
