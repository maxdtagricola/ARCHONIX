import * as XLSX from 'xlsx'
import { parseNumeroFlexivel } from './numeros'

export function cellValue(ws: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })
  const cell = ws[addr]
  return cell ? cell.v : undefined
}

/** Texto da célula como aparece na planilha (com a formatação dela) — importante pra códigos: uma
 * referência guardada como número com formato "000000" vale "000256", não 256. */
export function cellTexto(ws: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })
  const cell = ws[addr] as XLSX.CellObject | undefined
  if (!cell || cell.v === undefined || cell.v === null) return ''
  if (cell.t === 'n' && typeof cell.w === 'string' && cell.w.trim()) {
    const w = cell.w.trim()
    // só usa o texto formatado quando ele é o próprio número com zeros/separadores (ex.: "000256");
    // formatos de moeda/data viram o valor cru, que é mais útil
    if (/^\d+$/.test(w)) return w
  }
  return String(cell.v).trim()
}

/** Número da célula — aceita número de verdade e texto ("R$ 1.234,56", "12,5"). */
export function cellNumero(ws: XLSX.WorkSheet, row: number, col: number): number | undefined {
  const v = cellValue(ws, row, col)
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return parseNumeroFlexivel(v)
  return undefined
}

export function setCellValue(ws: XLSX.WorkSheet, row: number, col: number, value: string | number): void {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })
  ws[addr] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: value }
}

export function clearCellValue(ws: XLSX.WorkSheet, row: number, col: number): void {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })
  delete ws[addr]
}

export function sheetDims(ws: XLSX.WorkSheet): { maxRow: number; maxCol: number } {
  const ref = ws['!ref']
  if (!ref) return { maxRow: 0, maxCol: 0 }
  const range = XLSX.utils.decode_range(ref)
  return { maxRow: range.e.r + 1, maxCol: range.e.c + 1 }
}

export function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function vazio(valor: unknown): boolean {
  return valor === undefined || valor === null || String(valor).trim() === ''
}

/** Texto de cabeçalho comparável: sem acento, minúsculo, sem pontuação ("VLR. UNT." → "vlr unt"). */
function textoCabecalho(valor: unknown): string {
  return normalizar(valor)
    .replace(/[.:;/\\()_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cada coluna da tabela e os nomes de cabeçalho que ela costuma ter, do mais exato pro mais
 * genérico — a primeira forma que bater, na ordem, ganha (assim "REFERENCIA" exata vence um
 * "COD" genérico que também exista na planilha). */
const CABECALHOS = {
  referencia: [/^referencia$/, /^referencias?\b/, /^ref\b/, /^cod(igo)? (do )?fabricante$/, /^part ?number$/, /^p ?n$/, /^codigo original$/, /^cod(igo)? fornecedor$/, /^codigo$/, /^cod$/],
  descricao: [/^descricao$/, /^descri/, /^produto$/, /^item descricao$/, /^nome do produto$/, /^material$/],
  // antes de `quantidade`: "QTD DISPONÍVEL" é a quantidade que o fornecedor atende, não a pedida
  quantidadeDisponivel: [
    /^(qtd|qtde|qt|quant|quantidade) (disp|atend|em estoque|estoque|fornec|cotad|ofertad|confirmad)/,
    /^disponivel$/,
    /^disponibilidade$/,
    /^(em )?estoque$/,
    /^saldo( (em )?estoque)?$/,
    /^atende$/,
    /^atendid[ao]s?$/,
  ],
  quantidade: [/^quant(idade)?$/, /^quant/, /^qtd[e]?$/, /^qtde?\b/, /^qt$/],
  entrega: [/^entrega$/, /^prazo( de)? entrega\b/, /^(data|dt|previsao|prev)( de| da)? entrega\b/, /^entrega\b/, /^prazo$/, /^prazo (em )?dias$/],
  valorUnitario: [/^vlr unt$/, /^vlr unt/, /^valor unt/, /^vlr unit/, /^valor unit/, /^v unit/, /^vl unit/, /^preco unit/, /^unitario$/, /^preco$/, /^valor$/],
  valorTotal: [/^vlr total$/, /^vlr total/, /^valor total/, /^v total/, /^vl total/, /^total$/, /^subtotal$/],
  marca: [/^marca$/, /^fabricante$/, /^marca\b/, /^fabricante\b/],
  ncm: [/^ncm$/, /^ncm\b/, /^(cod|codigo) ncm$/, /^classif(icacao)? fiscal$/, /^class fiscal$/],
  observacao: [/^obs$/, /^obs\b/, /^observac/],
} satisfies Record<string, RegExp[]>

type ColunaCabecalho = keyof typeof CABECALHOS

export interface TabelaItensLocalizada {
  linhaCabecalho: number
  colReferencia: number
  colDescricao: number
  colQuant: number
  /** Coluna da quantidade que o fornecedor atende (DISPONÍVEL, ESTOQUE, QTD ATENDIDA…), -1 se não tiver. */
  colQuantDisponivel: number
  colEntrega: number
  colVlrUnt: number
  colVlrTotal: number
  colMarca: number
  colNcm: number
  /** Coluna OBS/OBSERVAÇÃO (ex.: "S/ PARAFUSO"), -1 se não tiver. */
  colObservacao: number
  maxRow: number
  maxCol: number
}

/** Procura, nas primeiras linhas, a linha de cabeçalho da tabela de itens e mapeia as colunas pelo
 * texto (não pela posição). Aceita os nomes mais comuns de cada coluna (REF, REFERÊNCIA, CÓDIGO;
 * QTD, QUANT, QUANTIDADE; VLR UNT, VALOR UNITÁRIO, PREÇO…). Devolve undefined se não achar uma
 * linha com pelo menos referência + (descrição ou quantidade ou valor). */
export function procurarTabelaItens(ws: XLSX.WorkSheet, linhasProcura = 60): TabelaItensLocalizada | undefined {
  const { maxRow, maxCol } = sheetDims(ws)
  let melhor: { linha: number; cols: Partial<Record<ColunaCabecalho, number>>; pontos: number } | undefined
  for (let r = 1; r <= Math.min(maxRow, linhasProcura); r++) {
    const textos: string[] = []
    for (let c = 1; c <= maxCol; c++) textos.push(textoCabecalho(cellValue(ws, r, c)))
    const cols: Partial<Record<ColunaCabecalho, number>> = {}
    for (const chave of Object.keys(CABECALHOS) as ColunaCabecalho[]) {
      // o padrão mais exato que aparecer em qualquer coluna dessa linha
      for (const padrao of CABECALHOS[chave]) {
        const c = textos.findIndex((t, i) => t && padrao.test(t) && !Object.values(cols).includes(i + 1))
        if (c !== -1) {
          cols[chave] = c + 1
          break
        }
      }
    }
    if (!cols.referencia) continue
    const pontos = Object.keys(cols).length
    if (pontos >= 2 && (!melhor || pontos > melhor.pontos)) melhor = { linha: r, cols, pontos }
  }
  if (!melhor) return undefined
  const c = melhor.cols
  return {
    linhaCabecalho: melhor.linha,
    colReferencia: c.referencia ?? -1,
    colDescricao: c.descricao ?? -1,
    // planilha que só tem a coluna de quantidade atendida: ela também serve de quantidade
    colQuant: c.quantidade ?? c.quantidadeDisponivel ?? -1,
    colQuantDisponivel: c.quantidadeDisponivel ?? -1,
    colEntrega: c.entrega ?? -1,
    colVlrUnt: c.valorUnitario ?? -1,
    colVlrTotal: c.valorTotal ?? -1,
    colMarca: c.marca ?? -1,
    colNcm: c.ncm ?? -1,
    colObservacao: c.observacao ?? -1,
    maxRow,
    maxCol,
  }
}

/**
 * Localiza a tabela de itens de uma planilha de orçamento (modelo
 * MARCA/ENTREGA/REFERENCIA/DESCRIÇÃO/QUANT/VLR UNT/VLR TOTAL, e variações
 * de nome dessas colunas). Exige referência, descrição e quantidade.
 */
export function localizarTabelaItens(ws: XLSX.WorkSheet): TabelaItensLocalizada {
  const tabela = procurarTabelaItens(ws)
  if (!tabela) {
    throw new Error('Não encontrei a tabela de itens (coluna "REFERENCIA", "REF" ou "CÓDIGO") nessa planilha.')
  }
  if (tabela.colDescricao === -1 || tabela.colQuant === -1) {
    throw new Error('Não encontrei as colunas de descrição e quantidade na tabela de itens.')
  }
  return tabela
}

/** Primeira aba que tem a tabela de itens (muita planilha traz capa/resumo na primeira aba). */
export function abaComTabelaItens(workbook: XLSX.WorkBook): { ws: XLSX.WorkSheet; nome: string; tabela?: TabelaItensLocalizada } {
  for (const nome of workbook.SheetNames) {
    const ws = workbook.Sheets[nome]
    const tabela = ws ? procurarTabelaItens(ws) : undefined
    if (ws && tabela) return { ws, nome, tabela }
  }
  const nome = workbook.SheetNames[0]
  return { ws: workbook.Sheets[nome], nome }
}

export interface PreviaPlanilha {
  htmlPreview: string
  nomeAba: string
  totalLinhas: number
  linhasMostradas: number
}

/**
 * Prévia bruta da primeira aba de um arquivo, pra conferir visualmente "é essa planilha mesmo?"
 * antes de ler/processar o conteúdo de verdade — limita a poucas linhas pra não travar em
 * planilhas grandes (a de markup, por exemplo, tem mais de 1500 linhas).
 */
export async function gerarPreviaPlanilha(arquivo: File, maxLinhas = 30): Promise<PreviaPlanilha> {
  const buffer = await arquivo.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const nomeAba = workbook.SheetNames[0]
  const ws = workbook.Sheets[nomeAba]

  const refCompleto = ws['!ref']
  if (!refCompleto) {
    return { htmlPreview: '<p>(aba vazia)</p>', nomeAba, totalLinhas: 0, linhasMostradas: 0 }
  }
  const range = XLSX.utils.decode_range(refCompleto)
  const totalLinhas = range.e.r - range.s.r + 1
  const linhasMostradas = Math.min(totalLinhas, maxLinhas)
  const ultimaLinha = range.s.r + linhasMostradas - 1

  // sheet_to_html não tem opção de range — monta uma planilha só com as linhas
  // mostradas, copiando as células originais, em vez de renderizar tudo.
  const wsLimitado: XLSX.WorkSheet = {
    '!ref': XLSX.utils.encode_range({ s: range.s, e: { r: ultimaLinha, c: range.e.c } }),
  }
  for (let r = range.s.r; r <= ultimaLinha; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (ws[addr] !== undefined) wsLimitado[addr] = ws[addr]
    }
  }
  const htmlPreview = XLSX.utils.sheet_to_html(wsLimitado)

  return { htmlPreview, nomeAba, totalLinhas, linhasMostradas }
}
