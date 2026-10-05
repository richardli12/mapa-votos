import { describe, expect, it } from 'vitest';
import { formatarCelula, linhasCsv, nomeArquivo, type Relatorio } from '../src/lib/relatorio';

describe('relatório exportável', () => {
  const rel: Relatorio = {
    arquivo: 'x', titulo: 'T',
    colunas: [{ titulo: 'Município' }, { titulo: 'Zona', tipo: 'cod' }, { titulo: 'Votos', tipo: 'int' }, { titulo: '%', tipo: 'pct' }],
    linhas: [['São Paulo', 1007, 123456, 12.3456], ['Vazio', null, 0, undefined]],
  };
  it('PDF: números no padrão brasileiro, códigos sem separador', () => {
    expect(rel.linhas[0].map((v, i) => formatarCelula(v, rel.colunas[i].tipo))).toEqual(['São Paulo', '1007', '123.456', '12,35%']);
  });
  it('CSV: valores crus com vírgula decimal, mesma ordem de colunas', () => {
    expect(linhasCsv(rel)).toEqual([['Município', 'Zona', 'Votos', '%'], ['São Paulo', '1007', 123456, '12,3456'], ['Vazio', '', 0, '']]);
  });
  it('nome de arquivo seguro', () => {
    expect(nomeArquivo('Seções da zona 0018')).toBe('secoes-da-zona-0018');
    expect(nomeArquivo('DELEGADO JONAS-depfederal-sp')).toBe('delegado-jonas-depfederal-sp');
  });
});
