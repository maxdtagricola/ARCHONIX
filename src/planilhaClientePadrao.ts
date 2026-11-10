import ExcelJS from 'exceljs'
import { LOGO_VENDAS_DANIEL_TRATORES_BASE64 } from './logoVendasDanielTratores'
import { MIME_XLSX, paginaDeImpressao, type PlanilhaAtualizada } from './planilhaCliente'
import { itensParaOVendedor } from './valoresEnviados'
import { abrirXlsx, renderizarAba } from './xlsxOriginal'
import type { ItemValorEnviado, QuoteItem } from './types'

// -----------------------------------------------------------------------
// Planilha do cliente gerada do zero, pra cotação que não veio de uma
// planilha importada. Reproduz o molde "cotação clientes" que as planilhas
// de verdade usam (lido célula a célula de uma delas): logo de vendas, bloco
// de dados do cliente, faixa ORÇAMENTO, tabela MARCA/ENTREGA/REFERENCIA/
// DESCRIÇÃO/QUANT/VLR UNT/VLR TOTAL, total e assinatura do vendedor. Mesmas
// larguras, alturas, mesclagens, fontes e bordas.
//
// Montada em código, como a do fornecedor (planilhaFornecedor.ts) e pelo mesmo
// motivo: não tem arquivo .xlsx de modelo pra versionar. O que o site não sabe
// (endereço, CPF/CNPJ, contato) fica em branco, pra preencher no Excel — o
// total é fórmula, então editar um valor lá recalcula a planilha.
// -----------------------------------------------------------------------

const NOME_ABA = 'cotação clientes'
const FORMATO_MOEDA = '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-'
const LARGURA_COLUNAS = [10.86, 10.86, 14.71, 47.14, 6.43, 10.57, 13.71]
const COR_PRETO = 'FF000000'
const COR_VERMELHO = 'FFFF0000'
const COR_FAIXA_OBS = 'FFD9D9D9'
const COR_FAIXA_ORCAMENTO = 'FFDDD9C3'

const ARIAL_9: Partial<ExcelJS.Font> = { name: 'Arial', size: 9, bold: true, color: { argb: COR_PRETO } }
const CALIBRI_9: Partial<ExcelJS.Font> = { name: 'Calibri', size: 9, bold: true, color: { argb: COR_PRETO } }
const ARIAL_11: Partial<ExcelJS.Font> = { name: 'Arial', size: 11, bold: true, color: { argb: COR_PRETO } }
const ARIAL_8: Partial<ExcelJS.Font> = { name: 'Arial', size: 8, bold: true, color: { argb: COR_PRETO } }
const CALIBRI_11: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, color: { argb: COR_PRETO } }

const A_ESQUERDA: Partial<ExcelJS.Alignment> = { horizontal: 'left', shrinkToFit: true }
const NO_CENTRO: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }
const NO_CENTRO_ENCOLHE: Partial<ExcelJS.Alignment> = { ...NO_CENTRO, wrapText: true, shrinkToFit: true }

const FINA: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: COR_PRETO } }
const GRADE: Partial<ExcelJS.Borders> = { top: FINA, left: FINA, bottom: FINA, right: FINA }

const COL = { marca: 1, entrega: 2, referencia: 3, descricao: 4, quant: 5, vlrUnt: 6, vlrTotal: 7 }
const LINHA_CABECALHO = 16
const PRIMEIRA_LINHA_ITEM = 17

export interface DadosPlanilhaPadrao {
  cliente: string
  maquina: string
  vendedor: string
}

/** "ORCAMENTO - ADEMIR DE PAULA TC5090.xlsx" (sem o que o Windows não aceita em nome de arquivo). */
export function nomePlanilhaPadrao({ cliente, maquina }: Pick<DadosPlanilhaPadrao, 'cliente' | 'maquina'>): string {
  const nome = `${cliente.trim()} ${maquina.trim()}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return nome ? `ORCAMENTO - ${nome}.xlsx` : 'ORCAMENTO.xlsx'
}

/** Mescla e põe a borda em volta: nas células de dentro de uma mescla a borda interna não aparece. */
function campo(
  ws: ExcelJS.Worksheet,
  linha: number,
  colIni: number,
  colFim: number,
  valor: string,
  fonte: Partial<ExcelJS.Font>,
  alinhamento: Partial<ExcelJS.Alignment> = A_ESQUERDA,
  linhaFim = linha,
) {
  if (colFim > colIni || linhaFim > linha) ws.mergeCells(linha, colIni, linhaFim, colFim)
  const celula = ws.getCell(linha, colIni)
  if (valor) celula.value = valor
  celula.font = fonte
  celula.alignment = alinhamento
  for (let l = linha; l <= linhaFim; l++) {
    for (let c = colIni; c <= colFim; c++) {
      ws.getCell(l, c).border = {
        ...(l === linha ? { top: FINA } : {}),
        ...(l === linhaFim ? { bottom: FINA } : {}),
        ...(c === colIni ? { left: FINA } : {}),
        ...(c === colFim ? { right: FINA } : {}),
      }
    }
  }
}

function pintar(ws: ExcelJS.Worksheet, linha: number, colIni: number, colFim: number, cor: string) {
  for (let c = colIni; c <= colFim; c++) {
    ws.getCell(linha, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } }
  }
}

function montarCabecalho(ws: ExcelJS.Worksheet, dados: DadosPlanilhaPadrao, uf: string) {
  ws.getRow(6).height = 27
  for (const linha of [7, 8, 9, 10, 11, 12]) ws.getRow(linha).height = 15
  ws.getRow(14).height = 24.95
  ws.getRow(15).height = 18
  ws.getRow(LINHA_CABECALHO).height = 18.75

  const rotulos = ['Cliente:', 'Endereço:', 'Município:', 'CPF/CNPJ', 'Equipamento', 'E-mail:', 'Contato:']
  rotulos.forEach((rotulo, i) => campo(ws, 7 + i, 1, 1, rotulo, ARIAL_9))

  campo(ws, 7, 2, 4, dados.cliente.trim(), ARIAL_9)
  campo(ws, 7, 5, 5, 'Fone:', CALIBRI_9)
  campo(ws, 7, 6, 7, '', CALIBRI_9)
  campo(ws, 8, 2, 7, '', ARIAL_9)
  campo(ws, 9, 2, 4, '', ARIAL_9)
  campo(ws, 9, 5, 5, 'UF:', CALIBRI_9)
  campo(ws, 9, 6, 7, uf, CALIBRI_9)
  campo(ws, 10, 2, 4, '', ARIAL_9)
  campo(ws, 10, 5, 6, 'Cond. Pagamento:', CALIBRI_9)
  campo(ws, 10, 7, 7, 'A COMBINAR', CALIBRI_9)
  campo(ws, 11, 2, 4, dados.maquina.trim(), ARIAL_9)
  campo(ws, 11, 5, 6, 'Data da Proposta:', CALIBRI_9)
  campo(ws, 11, 7, 7, new Date().toLocaleDateString('pt-BR'), CALIBRI_9)
  campo(ws, 12, 2, 4, '', ARIAL_9)
  campo(ws, 12, 5, 6, 'Validade Proposta:', ARIAL_9)
  campo(ws, 12, 7, 7, '15 DIAS', ARIAL_9)
  campo(ws, 13, 2, 4, '', ARIAL_9)
  campo(ws, 13, 5, 5, 'Fone:', ARIAL_9)
  campo(ws, 13, 6, 7, '', ARIAL_9)

  campo(ws, 14, 1, 1, 'Obs:', ARIAL_11, { horizontal: 'left', vertical: 'middle', shrinkToFit: true })
  campo(ws, 14, 2, 7, '', ARIAL_11, { ...NO_CENTRO, shrinkToFit: true })
  pintar(ws, 14, 1, 7, COR_FAIXA_OBS)

  campo(ws, 15, 1, 7, 'ORÇAMENTO', ARIAL_11, { ...NO_CENTRO, shrinkToFit: true })
  pintar(ws, 15, 1, 7, COR_FAIXA_ORCAMENTO)

  ;['MARCA', 'ENTREGA', 'REFERENCIA', 'DESCRIÇÃO', 'QUANT', 'VLR UNT', 'VLR TOTAL'].forEach((titulo, i) => {
    const celula = ws.getCell(LINHA_CABECALHO, i + 1)
    celula.value = titulo
    celula.font = ARIAL_8
    celula.alignment = NO_CENTRO_ENCOLHE
    celula.border = GRADE
  })
}

/** Devolve a última linha de item. O unitário vai sem arredondar (a tela mostra com 2 casas): assim
 * unitário × quantidade dá o mesmo total do site e do PDF, sem diferença de centavos. */
function montarItens(ws: ExcelJS.Worksheet, itens: ItemValorEnviado[]): number {
  itens.forEach((item, i) => {
    const linha = PRIMEIRA_LINHA_ITEM + i
    const qtd = item.quantidade || 0
    ws.getRow(linha).height = 18.75

    const valores: Record<number, ExcelJS.CellValue> = {
      [COL.marca]: item.marca.trim(),
      [COL.entrega]: item.entrega.trim(),
      [COL.referencia]: item.referencia.trim(),
      [COL.descricao]: item.descricao.trim(),
      [COL.quant]: qtd,
      [COL.vlrUnt]: qtd > 0 ? item.valorTotal / qtd : 0,
      [COL.vlrTotal]: { formula: `F${linha}*E${linha}`, result: item.valorTotal, date1904: false },
    }
    for (let c = COL.marca; c <= COL.vlrTotal; c++) {
      const celula = ws.getCell(linha, c)
      const texto = c === COL.referencia || c === COL.descricao || c === COL.quant
      if (valores[c] !== '') celula.value = valores[c]
      celula.font = texto ? CALIBRI_11 : ARIAL_8
      celula.alignment = texto ? NO_CENTRO : NO_CENTRO_ENCOLHE
      celula.border = GRADE
    }
    ws.getCell(linha, COL.vlrUnt).numFmt = FORMATO_MOEDA
    ws.getCell(linha, COL.vlrTotal).numFmt = FORMATO_MOEDA
  })
  return PRIMEIRA_LINHA_ITEM + itens.length - 1
}

function montarRodape(ws: ExcelJS.Worksheet, ultimaLinhaItem: number, total: number, vendedor: string): number {
  const linhaTotal = ultimaLinhaItem + 1
  ws.getRow(linhaTotal).height = 18.75
  for (let c = 1; c <= 4; c++) ws.getCell(linhaTotal, c).border = GRADE
  campo(ws, linhaTotal, 5, 6, 'VALOR TOTAL', { name: 'Calibri', size: 10, color: { argb: COR_VERMELHO } }, { horizontal: 'center' })
  const celulaTotal = ws.getCell(linhaTotal, COL.vlrTotal)
  celulaTotal.value = { formula: `SUM(G${PRIMEIRA_LINHA_ITEM}:G${ultimaLinhaItem})`, result: total, date1904: false }
  celulaTotal.font = { ...ARIAL_8, color: { argb: COR_VERMELHO } }
  celulaTotal.alignment = NO_CENTRO_ENCOLHE
  celulaTotal.border = GRADE
  celulaTotal.numFmt = FORMATO_MOEDA

  const assinatura = linhaTotal + 1
  const centro: Partial<ExcelJS.Alignment> = { horizontal: 'center', wrapText: true, shrinkToFit: true }
  ws.getRow(assinatura).height = 15
  campo(ws, assinatura, 1, 1, 'Email:', ARIAL_11, NO_CENTRO_ENCOLHE, assinatura + 1)
  campo(ws, assinatura, 2, 4, '', { ...ARIAL_11, size: 10 }, centro, assinatura + 1)
  campo(ws, assinatura, 5, 7, vendedor.trim(), ARIAL_9, centro, assinatura + 1)
  campo(ws, assinatura + 2, 1, 1, 'OBS:', ARIAL_11, NO_CENTRO_ENCOLHE, assinatura + 3)
  campo(ws, assinatura + 2, 2, 4, '', ARIAL_11, { horizontal: 'center', vertical: 'top', wrapText: true, shrinkToFit: true }, assinatura + 3)
  campo(ws, assinatura + 2, 5, 7, 'Vendedor', ARIAL_9, centro, assinatura + 3)
  ws.getRow(assinatura + 3).height = 15
  return assinatura + 3
}

/** A planilha do molde padrão, já preenchida com os itens da cotação — no mesmo formato da importada
 * depois de atualizada, pra as duas passarem pela mesma tela. */
export async function gerarPlanilhaPadrao(items: QuoteItem[], dados: DadosPlanilhaPadrao, titulo = 'Planilha do cliente'): Promise<PlanilhaAtualizada> {
  return gerarPlanilhaPadraoDosValores(itensParaOVendedor(items), dados, items[0]?.product.perfil ?? 'RO', titulo)
}

/** O mesmo molde, a partir dos valores já calculados (os que foram pro vendedor — ver
 * valoresEnviados.ts). `uf`: o estado de destino, que vai no cabeçalho. */
export async function gerarPlanilhaPadraoDosValores(
  itens: ItemValorEnviado[],
  dados: DadosPlanilhaPadrao,
  uf: string,
  titulo = 'Planilha do cliente',
): Promise<PlanilhaAtualizada> {
  const workbook = new ExcelJS.Workbook()
  const ws = workbook.addWorksheet(NOME_ABA)
  ws.columns = LARGURA_COLUNAS.map((width) => ({ width }))

  const logo = workbook.addImage({ base64: `data:image/png;base64,${LOGO_VENDAS_DANIEL_TRATORES_BASE64}`, extension: 'png' })
  ws.addImage(logo, {
    tl: { nativeCol: 0, nativeColOff: 0, nativeRow: 0, nativeRowOff: 0 } as unknown as ExcelJS.Anchor,
    br: { nativeCol: 6, nativeColOff: 869674, nativeRow: 5, nativeRowOff: 281609 } as unknown as ExcelJS.Anchor,
    editAs: 'oneCell',
  })

  montarCabecalho(ws, dados, uf)
  const ultimaLinhaItem = montarItens(ws, itens)
  const total = itens.reduce((s, item) => s + item.valorTotal, 0)
  const ultimaLinha = montarRodape(ws, ultimaLinhaItem, total, dados.vendedor)

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    scale: 73,
    margins: { left: 0.511811024, right: 0.511811024, top: 0.787401575, bottom: 0.787401575, header: 0.31496062, footer: 0.31496062 },
    printArea: `A1:G${ultimaLinha}`,
  }

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
  const previa = renderizarAba(abrirXlsx(bytes), NOME_ABA)
  return {
    arquivo: new Blob([bytes], { type: MIME_XLSX }),
    htmlPreview: previa.html,
    previaFiel: true,
    paginaImpressao: paginaDeImpressao(previa, titulo),
    itensAtualizados: itens.length,
    itensComValorNaPlanilha: [],
  }
}
