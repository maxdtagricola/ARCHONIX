import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import { autoTable, type RowInput, type Styles } from 'jspdf-autotable'
import { baixarBlob } from './planilhaCliente'
import { ETAPAS_RELATORIO, margem, textoDias, textoPercentual, type LinhaRelatorio, type Relatorio, type Totais } from './relatorioGeral'
import { nomeDoStatus } from './statusConfig'
import { formatCurrency } from './utils'

// O relatório geral em arquivo, pra passar aos supervisores: PDF pra ler, Excel pra mexer nos números.
// Os dois saem do mesmo `Relatorio` que está na tela.

export interface DadosDoRelatorio {
  relatorio: Relatorio
  /** Como o período é escrito no cabeçalho. */
  periodo: string
  admins: string[]
  geradoPor: string
}

const nomeDaEtapa = (l: LinhaRelatorio) => ETAPAS_RELATORIO.find((e) => e.id === l.etapa)?.nome ?? l.etapa
const dataCurta = (t: number | undefined) => (t === undefined ? '' : new Date(t).toLocaleDateString('pt-BR'))

function nomeDoArquivo(extensao: string): string {
  const hoje = new Date()
  const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  return `relatorio-geral-${dia}.${extensao}`
}

function linhaDeTotais(rotulo: string, t: Totais): string[] {
  return [
    rotulo,
    String(t.quantidade),
    formatCurrency(t.valorCotado),
    formatCurrency(t.custo),
    textoPercentual(margem(t.valorCotado, t.custo)),
    formatCurrency(t.faturado),
    textoPercentual(margem(t.faturado, t.custoDoFaturado)),
    t.aFaturar > 0 ? formatCurrency(t.aFaturar) : '',
  ]
}

const CABECALHO_TOTAIS = ['Cotações', 'Valor cotado', 'Custo', 'Margem', 'Faturado', 'Margem faturada', 'A faturar']
const NOTA_ESTIMADAS = (n: number) =>
  `${n} ${n === 1 ? 'cotação faturada está' : 'cotações faturadas estão'} sem o valor registrado na aba Faturamento: entra${n === 1 ? '' : 'm'} pelo preço passado na cotação.`

export function baixarRelatorioPdf({ relatorio, periodo, admins, geradoPor }: DadosDoRelatorio): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const MARGEM = 12
  const altura = doc.internal.pageSize.getHeight()
  const largura = doc.internal.pageSize.getWidth()
  const { totais } = relatorio
  let y = 16

  doc.setFontSize(15)
  doc.text('Relatório geral de cotações', MARGEM, y)
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(`Período: ${periodo}   ·   Admins: ${admins.join(', ')}`, MARGEM, y + 6)
  doc.text(`Gerado por ${geradoPor} em ${new Date().toLocaleString('pt-BR')}`, MARGEM, y + 11)
  y += 19

  function secao(titulo: string, cabecalho: string[], corpo: RowInput[], colunas: Record<number, Partial<Styles>> = {}, tamanho = 8.5) {
    if (y > altura - 35) {
      doc.addPage()
      y = 16
    }
    doc.setFontSize(11)
    doc.setTextColor(20)
    doc.text(titulo, MARGEM, y)
    autoTable(doc, {
      startY: y + 2,
      head: [cabecalho],
      body: corpo,
      margin: { left: MARGEM, right: MARGEM, bottom: 14 },
      styles: { fontSize: tamanho, cellPadding: 1.4 },
      headStyles: { fillColor: [20, 17, 14] },
      columnStyles: colunas,
      // columnStyles só vale pro corpo: o título da coluna de números acompanha o alinhamento dela
      didParseCell: ({ section, column, cell }) => {
        if (section === 'head' && colunas[column.index]?.halign) cell.styles.halign = colunas[column.index].halign as Styles['halign']
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9
  }
  const aDireita = (...colunas: number[]) => Object.fromEntries(colunas.map((c) => [c, { halign: 'right' } as Partial<Styles>]))

  secao(
    'Resumo',
    ['Cotações', 'Fecharam', 'Valor cotado', 'Margem cotada', 'Margem definida', 'Faturamento final', 'Margem faturada', 'A faturar'],
    [
      [
        String(totais.quantidade),
        `${relatorio.fechadas} (${textoPercentual(totais.quantidade > 0 ? relatorio.fechadas / totais.quantidade : undefined)})`,
        formatCurrency(totais.valorCotado),
        textoPercentual(margem(totais.valorCotado, totais.custo)),
        textoPercentual(totais.valorCotado > 0 ? totais.lucroDefinido / totais.valorCotado : undefined),
        formatCurrency(totais.faturado),
        textoPercentual(margem(totais.faturado, totais.custoDoFaturado)),
        totais.aFaturar > 0 ? formatCurrency(totais.aFaturar) : '',
      ],
    ],
  )
  secao(
    'Situação das cotações',
    ['Situação', ...CABECALHO_TOTAIS],
    relatorio.porEtapa.map((e) => linhaDeTotais(e.nome, e.totais)),
    aDireita(1, 2, 3, 4, 5, 6, 7),
  )
  if (relatorio.porAdmin.length > 1) {
    secao(
      'Por admin',
      ['Admin', ...CABECALHO_TOTAIS],
      relatorio.porAdmin.map((a) => linhaDeTotais(a.admin, a.totais)),
      aDireita(1, 2, 3, 4, 5, 6, 7),
    )
  }
  secao(
    'Prazos médios, em dias úteis',
    ['Etapa', 'O que mede', 'Média', 'Cotações medidas'],
    relatorio.prazos.map((p) => [p.rotulo, p.detalhe, textoDias(p.media), String(p.cotacoes)]),
    aDireita(2, 3),
  )
  if (relatorio.motivos.length > 0) {
    secao(
      'Por que não fecharam',
      ['Motivo', 'Cotações', 'Valor'],
      relatorio.motivos.map((m) => [m.motivo, String(m.quantidade), formatCurrency(m.valor)]),
      aDireita(1, 2),
    )
  }
  if (relatorio.estimadas > 0) {
    doc.setFontSize(8.5)
    doc.setTextColor(90)
    doc.text(NOTA_ESTIMADAS(relatorio.estimadas), MARGEM, y - 4)
    y += 4
  }

  secao(
    'Cotações',
    ['Cotação', 'Criada', 'Cliente', 'Admin', 'Vendedor', 'Status', 'Prazo', 'Valor cotado', 'Custo', 'Margem', 'Faturado', 'A faturar', 'Nota'],
    relatorio.linhas.map((l) => [
      l.codigo,
      dataCurta(l.criadaEm),
      l.cliente,
      l.admin,
      l.vendedor,
      nomeDoStatus(l.status),
      l.prazoInformado,
      formatCurrency(l.valorCotado),
      formatCurrency(l.custo),
      textoPercentual(margem(l.valorCotado, l.custo)),
      l.faturado > 0 ? `${formatCurrency(l.faturado)}${l.faturadoEstimado ? ' *' : ''}` : '',
      l.aFaturar > 0 ? formatCurrency(l.aFaturar) : '',
      l.notaFaturamento,
    ]),
    aDireita(7, 8, 9, 10, 11),
    7.5,
  )
  if (relatorio.estimadas > 0) {
    doc.setFontSize(8.5)
    doc.setTextColor(90)
    doc.text(`* Sem valor registrado na aba Faturamento: entra pelo preço passado na cotação.`, MARGEM, Math.min(y - 4, altura - 16))
  }

  const paginas = doc.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`Página ${p} de ${paginas}`, largura - MARGEM, altura - 7, { align: 'right' })
  }

  baixarBlob(doc.output('blob'), nomeDoArquivo('pdf'))
}

const FONTE = 'Arial'
const MOEDA = '"R$" #,##0.00'
const PERCENTUAL = '0.0%'
const COR_CABECALHO = 'FF14110E'

/** O ExcelJS grava a data em UTC: passando o dia local à meia-noite UTC, ela não muda de dia na planilha. */
function diaNaPlanilha(t: number | undefined): Date | null {
  if (t === undefined) return null
  const d = new Date(t)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function formula(texto: string, resultado: number | undefined): ExcelJS.CellFormulaValue {
  return { formula: texto, result: resultado ?? '', date1904: false }
}

function estilizarCabecalho(linha: ExcelJS.Row) {
  linha.eachCell((celula) => {
    celula.font = { name: FONTE, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CABECALHO } }
    celula.alignment = { vertical: 'middle', wrapText: true }
  })
}

function montarAbaResumo(planilha: ExcelJS.Workbook, { relatorio, periodo, admins, geradoPor }: DadosDoRelatorio) {
  const aba = planilha.addWorksheet('Resumo')
  aba.columns = [{ width: 34 }, { width: 11 }, { width: 17 }, { width: 17 }, { width: 11 }, { width: 17 }, { width: 11 }, { width: 17 }]
  aba.addRow(['Relatório geral de cotações']).getCell(1).font = { name: FONTE, size: 14, bold: true }
  aba.addRow([`Período: ${periodo}`])
  aba.addRow([`Admins: ${admins.join(', ')}`])
  aba.addRow([`Gerado por ${geradoPor} em ${new Date().toLocaleString('pt-BR')}`])
  aba.addRow([])

  function tabelaDeTotais(titulo: string, linhas: { rotulo: string; totais: Totais }[]) {
    aba.addRow([titulo]).getCell(1).font = { name: FONTE, size: 11, bold: true }
    estilizarCabecalho(aba.addRow(['', ...CABECALHO_TOTAIS]))
    for (const { rotulo, totais: t } of linhas) {
      const n = aba.rowCount + 1
      const linha = aba.addRow([
        rotulo,
        t.quantidade,
        t.valorCotado,
        t.custo,
        formula(`IF(C${n}>0,(C${n}-D${n})/C${n},"")`, margem(t.valorCotado, t.custo)),
        t.faturado,
        // o custo do faturado não é coluna aqui: o resultado vem pronto, da aba Cotações não dá pra somar por grupo
        margem(t.faturado, t.custoDoFaturado) ?? '',
        t.aFaturar,
      ])
      linha.getCell(8).numFmt = MOEDA
      linha.getCell(3).numFmt = MOEDA
      linha.getCell(4).numFmt = MOEDA
      linha.getCell(5).numFmt = PERCENTUAL
      linha.getCell(6).numFmt = MOEDA
      linha.getCell(7).numFmt = PERCENTUAL
    }
    aba.addRow([])
  }

  tabelaDeTotais('Situação das cotações', [
    ...relatorio.porEtapa.map((e) => ({ rotulo: e.nome, totais: e.totais })),
    { rotulo: 'Total', totais: relatorio.totais },
  ])
  aba.getRow(aba.rowCount - 1).eachCell((c) => (c.font = { name: FONTE, size: 10, bold: true }))
  if (relatorio.porAdmin.length > 1) tabelaDeTotais('Por admin', relatorio.porAdmin.map((a) => ({ rotulo: a.admin, totais: a.totais })))

  aba.addRow(['Prazos médios, em dias úteis']).getCell(1).font = { name: FONTE, size: 11, bold: true }
  estilizarCabecalho(aba.addRow(['Etapa', 'Média', 'Cotações medidas']))
  for (const p of relatorio.prazos) aba.addRow([p.rotulo, p.media ?? '—', p.cotacoes]).getCell(2).numFmt = '0.0'
  aba.addRow([])

  if (relatorio.motivos.length > 0) {
    aba.addRow(['Por que não fecharam']).getCell(1).font = { name: FONTE, size: 11, bold: true }
    estilizarCabecalho(aba.addRow(['Motivo', 'Cotações', 'Valor']))
    for (const m of relatorio.motivos) aba.addRow([m.motivo, m.quantidade, m.valor]).getCell(3).numFmt = MOEDA
    aba.addRow([])
  }
  if (relatorio.estimadas > 0) aba.addRow([NOTA_ESTIMADAS(relatorio.estimadas)])

  aba.eachRow((linha) =>
    linha.eachCell((c) => {
      if (c.font?.name !== FONTE) c.font = { name: FONTE, size: 10 }
    }),
  )
}

function montarAbaCotacoes(planilha: ExcelJS.Workbook, relatorio: Relatorio) {
  const aba = planilha.addWorksheet('Cotações', { views: [{ state: 'frozen', ySplit: 1 }] })
  aba.columns = [
    { header: 'Cotação', width: 12 },
    { header: 'Criada em', width: 12 },
    { header: 'Cliente', width: 28 },
    { header: 'Vendedor', width: 12 },
    { header: 'Admin', width: 12 },
    { header: 'Status', width: 22 },
    { header: 'Situação', width: 26 },
    { header: 'Prazo informado', width: 20 },
    { header: 'Valor cotado', width: 15 },
    { header: 'Custo', width: 15 },
    { header: 'Margem', width: 10 },
    { header: 'Margem definida', width: 10 },
    { header: 'Faturado', width: 15 },
    { header: 'Faturado estimado', width: 10 },
    { header: 'Custo do faturado', width: 15 },
    { header: 'Margem faturada', width: 10 },
    { header: 'Nota fiscal', width: 14 },
    { header: 'Data do faturamento', width: 13 },
    { header: 'Dias: resposta', width: 10 },
    { header: 'Dias: pedido até entrega', width: 11 },
    { header: 'Dias: entrega até faturar', width: 11 },
    { header: 'Motivo de não fechar', width: 32 },
    { header: 'A faturar', width: 15 },
  ]
  estilizarCabecalho(aba.getRow(1))
  aba.getRow(1).height = 44

  for (const l of relatorio.linhas) {
    const n = aba.rowCount + 1
    aba.addRow([
      l.codigo,
      diaNaPlanilha(l.criadaEm),
      l.cliente,
      l.vendedor,
      l.admin,
      nomeDoStatus(l.status),
      nomeDaEtapa(l),
      l.prazoInformado,
      l.valorCotado,
      l.custo,
      formula(`IF(I${n}>0,(I${n}-J${n})/I${n},"")`, margem(l.valorCotado, l.custo)),
      l.valorCotado > 0 ? l.lucroDefinido / l.valorCotado : '',
      l.faturado,
      l.faturadoEstimado ? 'Sim' : '',
      l.custoDoFaturado,
      formula(`IF(M${n}>0,(M${n}-O${n})/M${n},"")`, margem(l.faturado, l.custoDoFaturado)),
      l.notaFaturamento,
      diaNaPlanilha(l.faturadaEm),
      l.diasResposta ?? '',
      l.diasEntrega ?? '',
      l.diasFaturamento ?? '',
      [l.motivo, l.motivoDetalhe].filter(Boolean).join(': '),
      l.aFaturar,
    ])
  }

  const fim = aba.rowCount
  if (fim > 1) {
    const t = relatorio.totais
    const n = fim + 1
    const soma = (coluna: string, resultado: number) => formula(`SUM(${coluna}2:${coluna}${fim})`, resultado)
    const total = aba.addRow([
      'Total',
      '', '', '', '', '', '', '',
      soma('I', t.valorCotado),
      soma('J', t.custo),
      formula(`IF(I${n}>0,(I${n}-J${n})/I${n},"")`, margem(t.valorCotado, t.custo)),
      '',
      soma('M', t.faturado),
      '',
      soma('O', t.custoDoFaturado),
      formula(`IF(M${n}>0,(M${n}-O${n})/M${n},"")`, margem(t.faturado, t.custoDoFaturado)),
      '', '', '', '', '', '',
      soma('W', t.aFaturar),
    ])
    total.eachCell({ includeEmpty: true }, (c) => (c.font = { name: FONTE, size: 10, bold: true }))
    aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: fim, column: 23 } }
  }

  aba.eachRow((linha, numero) => {
    if (numero === 1) return
    linha.eachCell({ includeEmpty: true }, (c) => {
      if (c.font?.name !== FONTE) c.font = { name: FONTE, size: 10 }
    })
    linha.getCell(2).numFmt = 'dd/mm/yyyy'
    linha.getCell(18).numFmt = 'dd/mm/yyyy'
    for (const coluna of [9, 10, 13, 15, 23]) linha.getCell(coluna).numFmt = MOEDA
    for (const coluna of [11, 12, 16]) linha.getCell(coluna).numFmt = PERCENTUAL
  })
}

export async function baixarRelatorioExcel(dados: DadosDoRelatorio): Promise<void> {
  const planilha = new ExcelJS.Workbook()
  planilha.creator = dados.geradoPor
  montarAbaResumo(planilha, dados)
  montarAbaCotacoes(planilha, dados.relatorio)
  const buffer = await planilha.xlsx.writeBuffer()
  baixarBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    nomeDoArquivo('xlsx'),
  )
}
