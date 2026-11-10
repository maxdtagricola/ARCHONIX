import ExcelJS from 'exceljs'
import { COLUNA, fechamentoDaColuna, valorDaColuna, type Grupo, type IdColuna, type LinhaControle } from './controleFaturamento'
import { baixarBlob } from './planilhaCliente'

// O Controle de Cotações x Faturamento em Excel, no formato da planilha da empresa (cores, fontes,
// larguras e formatos dela), com as colunas, a ordem, as linhas e os grupos que estão na tela.
// Onde a planilha tinha fórmula (total orçado = qtd × orçado; dias = faturamento − confirmação) a
// fórmula continua; os totais também saem em fórmula quando as colunas de que dependem estão no arquivo.

const AZUL = 'FF425D90'
const LISTRA = 'FFF9F9FF'
const SUBTOTAL = 'FFE8ECF5'
const MOEDA = '[$R$-416] #,##0.00'
const MOEDA_CONTABIL = '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-'
const PERCENTUAL = '0.00%'
const DATA = 'dd/mm/yyyy'
const BORDA: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}
const TEXTO_LONGO: IdColuna[] = ['cliente', 'descricao', 'observacao', 'fornecedor', 'maquina']

/** O ExcelJS grava a data em UTC: passando o dia local à meia-noite UTC, ela não muda de dia na planilha. */
function diaNaPlanilha(t: number | undefined): Date | null {
  if (t === undefined) return null
  const d = new Date(t)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function formatoDoNumero(id: IdColuna): string | undefined {
  const tipo = COLUNA[id].tipo
  if (tipo === 'moeda') return id === 'vlrFaturado' ? MOEDA_CONTABIL : MOEDA
  if (tipo === 'percentual') return PERCENTUAL
  if (tipo === 'data') return DATA
  if (tipo === 'quantidade') return '#,##0.###'
  if (tipo === 'dias') return '0'
  return undefined
}

function valorNaPlanilha(l: LinhaControle, id: IdColuna): ExcelJS.CellValue {
  const v = valorDaColuna(l, id)
  if (COLUNA[id].tipo === 'data') return diaNaPlanilha(typeof v === 'number' ? v : undefined)
  return v === undefined || v === '' ? null : v
}

interface Faixa {
  inicio: number
  fim: number
}

export async function baixarControleExcel({ colunas, linhas, grupos }: { colunas: IdColuna[]; linhas: LinhaControle[]; grupos: Grupo[] | null }): Promise<void> {
  const planilha = new ExcelJS.Workbook()
  const aba = planilha.addWorksheet('Página1', { views: [{ state: 'frozen', ySplit: 1, zoomScale: 85 }] })
  aba.columns = colunas.map((id) => ({ header: COLUNA[id].titulo, key: id, width: COLUNA[id].largura }))
  const letra = (id: IdColuna) => (colunas.includes(id) ? aba.getColumn(colunas.indexOf(id) + 1).letter : null)

  const cabecalho = aba.getRow(1)
  cabecalho.height = 36
  cabecalho.eachCell((celula) => {
    celula.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    celula.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    celula.border = BORDA
  })

  const estilizar = (linha: ExcelJS.Row, fundo: string, negrito = false) => {
    colunas.forEach((id, i) => {
      const celula = linha.getCell(i + 1)
      celula.font = { name: 'Roboto', size: 10, bold: negrito }
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fundo } }
      celula.border = BORDA
      celula.alignment = { horizontal: TEXTO_LONGO.includes(id) ? 'left' : 'center', vertical: 'middle' }
      const formato = formatoDoNumero(id)
      if (formato) celula.numFmt = formato
      const v = celula.value
      if (COLUNA[id].tipo === 'percentual' && typeof v === 'number' && v < 0) celula.font = { ...celula.font, color: { argb: 'FFC00000' } }
    })
  }

  // --- linhas de dados
  let numero = 2
  let listra = false
  const faixas: Faixa[] = []
  const subtotais: number[] = []
  const blocos = grupos ?? [{ titulo: '', linhas }]
  for (const bloco of blocos) {
    const inicio = numero
    for (const l of bloco.linhas) {
      const linha = aba.getRow(numero)
      colunas.forEach((id, i) => {
        linha.getCell(i + 1).value = valorNaPlanilha(l, id)
      })
      const D = letra('qtd')
      const H = letra('vlrOrcado')
      const I = letra('vlrTotalOrcado')
      if (I && D && H) linha.getCell(colunas.indexOf('vlrTotalOrcado') + 1).value = { formula: `${D}${numero}*${H}${numero}`, result: l.vlrTotalOrcado }
      const G = letra('dataConfirmacao')
      const K = letra('dataFaturamento')
      const N = letra('totalDias')
      if (N && G && K && l.totalDias !== undefined) linha.getCell(colunas.indexOf('totalDias') + 1).value = { formula: `${K}${numero}-${G}${numero}`, result: l.totalDias }
      const Q = letra('qtdFaturada')
      const L = letra('vlrFaturado')
      const T = letra('vlrTotalFaturado')
      if (T && Q && L && l.vlrTotalFaturado !== undefined) linha.getCell(colunas.indexOf('vlrTotalFaturado') + 1).value = { formula: `${Q}${numero}*${L}${numero}`, result: l.vlrTotalFaturado }
      estilizar(linha, listra ? LISTRA : 'FFFFFFFF')
      listra = !listra
      numero++
    }
    const faixa = { inicio, fim: numero - 1 }
    faixas.push(faixa)
    if (grupos && bloco.linhas.length > 0) {
      escreverFechamento(aba, colunas, numero, `Subtotal — ${bloco.titulo}`, bloco.linhas, (col) => formulaDaFaixa(col, faixa, letra))
      estilizar(aba.getRow(numero), SUBTOTAL, true)
      subtotais.push(numero)
      numero++
    }
  }
  const ultimaDeDados = numero - 1

  // --- Total / Média
  escreverFechamento(aba, colunas, numero, 'Total / Média', linhas, (col) =>
    grupos ? formulaDosSubtotais(col, subtotais, faixas, letra) : faixas[0] && faixas[0].fim >= faixas[0].inicio ? formulaDaFaixa(col, faixas[0], letra) : null,
  )
  estilizar(aba.getRow(numero), LISTRA, true)

  aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ultimaDeDados), column: colunas.length } }

  const buffer = await planilha.xlsx.writeBuffer()
  const hoje = new Date()
  const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  baixarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `controle-cotacoes-x-faturamento-${dia}.xlsx`)
}

type Letra = (id: IdColuna) => string | null

/** A linha de total (ou de subtotal): o rótulo na primeira coluna de texto e o fechamento de cada coluna. */
function escreverFechamento(aba: ExcelJS.Worksheet, colunas: IdColuna[], numero: number, rotulo: string, linhas: LinhaControle[], formula: (col: IdColuna) => string | null) {
  const linha = aba.getRow(numero)
  const ondeRotulo = colunas.findIndex((id) => COLUNA[id].tipo === 'texto' && !COLUNA[id].fechamento)
  linha.getCell((ondeRotulo >= 0 ? ondeRotulo : 0) + 1).value = rotulo
  colunas.forEach((id, i) => {
    if (!COLUNA[id].fechamento) return
    const resultado = fechamentoDaColuna(linhas, id)
    const texto = formula(id)
    linha.getCell(i + 1).value = texto ? { formula: texto, result: resultado ?? 0 } : (resultado ?? null)
  })
}

/** O fechamento de uma coluna numa faixa contínua de linhas; null quando falta coluna e vai o valor. */
function formulaDaFaixa(id: IdColuna, f: Faixa, letra: Letra): string | null {
  const X = letra(id)
  if (!X) return null
  const r = (col: string) => `${col}${f.inicio}:${col}${f.fim}`
  const tipo = COLUNA[id].fechamento
  if (tipo === 'soma') return `SUM(${r(X)})`
  if (tipo === 'media') return `IFERROR(AVERAGE(${r(X)}),"")`
  const Q = letra('qtdFaturada')
  const T = letra('vlrTotalFaturado')
  if (tipo === 'totalFaturado') return T ? `SUM(${r(T)})` : Q ? `SUMPRODUCT(${r(Q)},${r(X)})` : null
  if (tipo === 'margemPrevista') {
    const I = letra('vlrTotalOrcado')
    return I ? `IFERROR(SUMPRODUCT(${r(I)},${r(X)})/SUM(${r(I)}),"")` : null
  }
  // margens sobre o faturado: o peso é o total faturado de cada linha
  const peso = T ? r(T) : null
  return peso ? `IFERROR(SUMPRODUCT(${peso},${r(X)})/SUMIFS(${peso},${r(X)},"<>"),"")` : null
}

/** O total geral com grupos: soma dos subtotais (ou média de todas as linhas de dados). */
function formulaDosSubtotais(id: IdColuna, subtotais: number[], faixas: Faixa[], letra: Letra): string | null {
  const X = letra(id)
  if (!X || subtotais.length === 0) return null
  const celulas = (col: string) => subtotais.map((n) => `${col}${n}`)
  const tipo = COLUNA[id].fechamento
  if (tipo === 'soma' || tipo === 'totalFaturado') return `SUM(${celulas(X).join(',')})`
  if (tipo === 'media') return `IFERROR(AVERAGE(${faixas.filter((f) => f.fim >= f.inicio).map((f) => `${X}${f.inicio}:${X}${f.fim}`).join(',')}),"")`
  const pesoColuna = tipo === 'margemPrevista' ? letra('vlrTotalOrcado') : letra('vlrTotalFaturado') ?? letra('vlrFaturado')
  if (!pesoColuna) return null
  const termos = subtotais.map((n) => `N(${pesoColuna}${n})*N(${X}${n})`).join('+')
  return `IFERROR((${termos})/SUM(${celulas(pesoColuna).join(',')}),"")`
}
