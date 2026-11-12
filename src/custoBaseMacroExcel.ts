import ExcelJS from 'exceljs'
import { COR_CABECALHO, COR_CABECALHO_RESULTADO, chaveMarca, chavePreco, valorDaCelula, type ColunaPlanilha, type LinhaPlanilha } from './compararPlanilha'
import { baixarBlob } from './planilhaCliente'

// A comparação de fornecedores em Excel, no formato do CUSTO BASE MACRO: as colunas na ordem (e só as)
// que estão na tela, com as fórmulas da planilha — VLR MÍN = MÍNIMO dos preços, FORNECEDOR e MARCA
// do mais barato, VLR UNIT = VLR MÍN (ou o preço escolhido, se for outro), TOTAL = VLR UNIT × UND e a
// soma no fim —, as cores dela, as listras, a referência repetida em vermelho e o filtro no cabeçalho.

const FONTE = 'Calibri'
// o formato contábil da planilha
const MOEDA = '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-'
const BORDA: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}
// larguras da planilha
const LARGURA: Record<string, number> = { referencia: 21, interno: 14.7, descricao: 45.9, und: 10.6, vlrUnit: 14.4, total: 16.7, vlrMin: 13.7, fornecedorMin: 15.9, marcaMin: 13 }

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`
const letra = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

function formula(texto: string, resultado: string | number | undefined): ExcelJS.CellFormulaValue {
  return { formula: texto, result: resultado ?? '', date1904: false }
}

export async function baixarCustoBaseMacro({
  colunas,
  linhas,
  corDe,
  nomeArquivo,
}: {
  colunas: ColunaPlanilha[]
  linhas: LinhaPlanilha[]
  /** A cor das células de preço de cada coluna ('' = sem cor). */
  corDe: (c: ColunaPlanilha) => string
  nomeArquivo: string
}): Promise<void> {
  const planilha = new ExcelJS.Workbook()
  const aba = planilha.addWorksheet('BASE', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, zoomScale: 80 }] })
  aba.columns = colunas.map((c) => ({ width: LARGURA[c.chave] ?? (c.grupo === 'marca' ? 13 : 14.7) }))
  const col = new Map(colunas.map((c, i) => [c.chave, letra(i + 1)]))
  const precos = colunas.filter((c) => c.grupo === 'preco')

  // cabeçalho: azul claro, e o mais barato (VLR MÍN, FORNECEDOR, MARCA) em verde
  const cabecalho = aba.addRow(colunas.map((c) => (c.grupo === 'marca' ? `MARCA ${c.fornecedor?.toUpperCase()}` : c.titulo)))
  cabecalho.eachCell((celula, n) => {
    const c = colunas[n - 1]
    celula.font = { name: FONTE, size: 11, bold: true }
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.grupo === 'resultado' ? COR_CABECALHO_RESULTADO : COR_CABECALHO) } }
    celula.border = BORDA
    celula.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })

  linhas.forEach((l, k) => {
    const r = k + 2
    const ref = (chave: string) => `${col.get(chave)}${r}`
    const valores = colunas.map((c): ExcelJS.CellValue => {
      switch (c.chave) {
        case 'vlrMin': {
          if (precos.length === 0) return l.melhor?.valorUnitario ?? null
          const lista = precos.map((p) => ref(p.chave)).join(',')
          return formula(`IF(COUNT(${lista})=0,"",MIN(${lista}))`, l.melhor?.valorUnitario)
        }
        case 'fornecedorMin':
        case 'marcaMin': {
          if (!col.has('vlrMin') || precos.length === 0) return (valorDaCelula(l, c) as string | undefined) ?? null
          const min = ref('vlrMin')
          // o mesmo SE encadeado da planilha: o primeiro preço igual ao mínimo dá o fornecedor (ou a marca)
          let f = '""'
          for (const p of [...precos].reverse()) {
            const resposta = c.chave === 'fornecedorMin' ? `${col.get(p.chave)}$1` : col.has(chaveMarca(p.fornecedor!)) ? ref(chaveMarca(p.fornecedor!)) : '""'
            f = `IF(${ref(p.chave)}=${min},${resposta},${f})`
          }
          return formula(`IF(${min}="","",${f})`, valorDaCelula(l, c) as string | undefined)
        }
        case 'vlrUnit':
          // o mais barato preenche o item: VLR UNIT = VLR MÍN; escolhido outro (mais caro), o preço dele
          if (col.has('vlrMin') && (!l.emUso || l.emUso === l.melhor)) return formula(`IF(${ref('vlrMin')}="","",${ref('vlrMin')})`, l.vlrUnit || undefined)
          return l.vlrUnit || null
        case 'total':
          if (col.has('vlrUnit') && col.has('und')) return formula(`IF(${ref('vlrUnit')}="","",${ref('vlrUnit')}*${ref('und')})`, l.total || undefined)
          return l.total || null
      }
      // nos preços, "sem quantidade", prazo e NCM vão num comentário da célula (logo abaixo)
      return valorDaCelula(l, c) ?? null
    })
    const linha = aba.addRow(valores)
    linha.eachCell({ includeEmpty: true }, (celula, n) => {
      const c = colunas[n - 1]
      if (!c) return
      celula.font = { name: FONTE, size: c.grupo === 'item' && c.tipo === 'texto' ? 10 : 11 }
      celula.border = BORDA
      celula.alignment = { horizontal: c.chave === 'descricao' ? 'left' : 'center', vertical: 'middle' }
      if (c.tipo === 'moeda') celula.numFmt = MOEDA
      if (c.chave === 'referencia' || c.chave === 'interno') celula.numFmt = '@'
      const cor = c.grupo === 'preco' ? corDe(c) : ''
      if (cor) celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(cor) } }
      if (c.grupo === 'preco' && c.fornecedor) {
        const cot = l.porFornecedor.get(chavePreco(c.fornecedor))?.cotacao
        const nota = cot
          ? [cot.quantidadeDisponivel === 0 ? 'Sem quantidade — não entra no mais barato do sistema' : '', cot.prazoEntrega ? `Prazo: ${cot.prazoEntrega}` : '', cot.ncm ? `NCM: ${cot.ncm}` : '']
              .filter(Boolean)
              .join('\n')
          : ''
        if (nota) celula.note = nota
      }
    })
  })

  // TOTAL: a soma, como no fim da planilha
  const ultima = linhas.length + 1
  if (col.has('total') && linhas.length > 0) {
    const total = aba.addRow(colunas.map((c, i) => (i === 0 ? 'TOTAL' : c.chave === 'total' ? formula(`SUM(${col.get('total')}2:${col.get('total')}${ultima})`, linhas.reduce((s, l) => s + l.total, 0)) : null)))
    total.eachCell({ includeEmpty: true }, (celula, n) => {
      celula.font = { name: FONTE, size: 11, bold: true }
      celula.border = BORDA
      if (colunas[n - 1]?.tipo === 'moeda') celula.numFmt = MOEDA
    })
  }

  if (linhas.length > 0) {
    aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultima, column: colunas.length } }
    // listras (linha par de cinza) nas colunas sem a cor do fornecedor, como a formatação da planilha
    const semCor = colunas.map((c, i) => ({ c, i })).filter(({ c }) => !(c.grupo === 'preco' && corDe(c)))
    if (semCor.length > 0) {
      aba.addConditionalFormatting({
        ref: semCor.map(({ i }) => `${letra(i + 1)}2:${letra(i + 1)}${ultima}`).join(' '),
        rules: [{ type: 'expression', priority: 2, formulae: ['MOD(ROW(),2)=0'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFBFBFBF' } } } }],
      })
    }
    // referência repetida em vermelho
    if (col.has('referencia')) {
      const a = col.get('referencia')!
      aba.addConditionalFormatting({
        ref: `${a}2:${a}${ultima}`,
        rules: [
          {
            type: 'expression',
            priority: 1,
            formulae: [`AND(${a}2<>"",COUNTIF($${a}$2:$${a}$${ultima},${a}2)>1)`],
            style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } }, font: { color: { argb: 'FF9C0006' } } },
          },
        ],
      })
    }
  }

  const buffer = await planilha.xlsx.writeBuffer()
  baixarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeArquivo)
}
