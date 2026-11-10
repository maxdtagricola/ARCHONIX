import { calculateItem } from './calc/calculator'
import { diasUteisDesde } from './diasUteis'
import { itensDoPedidoDeCompra } from './fornecedoresDoPedido'
import { passosDoStatus } from './historicoStatus'
import { adminDaCotacao, dataDoFaturamento } from './relatorioGeral'
import { nomeDoStatus, statusDe } from './statusConfig'
import type { QuoteRecord } from './types'
import { custoFinal, precoPassado } from './valoresDoPedido'

// -----------------------------------------------------------------------
// Controle de Cotações x Faturamento: uma linha por item vendido, com o que
// foi orçado e o que foi faturado, no formato da planilha que a empresa já
// usava (as 15 colunas, na mesma ordem). Na tela dá pra tirar e pôr colunas
// (inclusive outras do sistema), retirar linhas, ordenar e agrupar; o Excel
// sai do jeito que estiver na tela (controleFaturamentoExcel.ts).
//
// Margem prevista é o lucro definido na precificação do item. Margem final é
// esse mesmo lucro refeito com o valor que foi faturado e o custo do que
// fechou no Pedido de Compra, com os mesmos impostos, comissão e custo fixo:
// as duas ficam na mesma régua, e sem desconto nem mudança de custo dão igual.
// A margem bruta (venda − custo) ÷ venda, a da aba Faturamento, é coluna extra.
// -----------------------------------------------------------------------

export type IdColuna =
  | 'vendedor'
  | 'cliente'
  | 'interno'
  | 'qtd'
  | 'ref'
  | 'descricao'
  | 'dataConfirmacao'
  | 'vlrOrcado'
  | 'vlrTotalOrcado'
  | 'margemPrevista'
  | 'dataFaturamento'
  | 'vlrFaturado'
  | 'margemFinal'
  | 'totalDias'
  | 'observacao'
  | 'codigo'
  | 'admin'
  | 'status'
  | 'maquina'
  | 'fornecedor'
  | 'marca'
  | 'qtdFaturada'
  | 'vlrTotalFaturado'
  | 'diferenca'
  | 'custoUnitario'
  | 'margemBruta'
  | 'notaFaturamento'
  | 'prazoInformado'
  | 'diasUteis'
  | 'dataCotacao'

export type TipoDeValor = 'texto' | 'quantidade' | 'moeda' | 'percentual' | 'data' | 'dias'

/** Como a coluna fecha na linha "Total / Média". */
export type Fechamento = 'soma' | 'totalFaturado' | 'margemPrevista' | 'margemFinal' | 'margemBruta' | 'media'

export interface DefColuna {
  id: IdColuna
  /** O cabeçalho, igual ao da planilha nas colunas do formato padrão. */
  titulo: string
  tipo: TipoDeValor
  /** Largura no Excel (a mesma da planilha nas do formato padrão). */
  largura: number
  fechamento?: Fechamento
  descricao: string
}

export const COLUNAS: DefColuna[] = [
  { id: 'vendedor', titulo: 'VENDEDOR', tipo: 'texto', largura: 14.4, descricao: 'Vendedor da cotação' },
  { id: 'cliente', titulo: 'CLIENTE', tipo: 'texto', largura: 29.7, descricao: 'Cliente da cotação' },
  { id: 'interno', titulo: 'COD. INTERNO', tipo: 'texto', largura: 11.6, descricao: 'Código interno do produto' },
  { id: 'qtd', titulo: 'QTD.', tipo: 'quantidade', largura: 11.6, fechamento: 'soma', descricao: 'Quantidade do item no pedido' },
  { id: 'ref', titulo: 'REF.', tipo: 'texto', largura: 12.7, descricao: 'Referência do produto' },
  { id: 'descricao', titulo: 'DESCRIÇÃO', tipo: 'texto', largura: 48.6, descricao: 'Descrição do produto' },
  { id: 'dataConfirmacao', titulo: 'DATA CONFIRMACAO DO PEDIDO', tipo: 'data', largura: 25.7, descricao: 'Quando o pedido foi confirmado' },
  { id: 'vlrOrcado', titulo: 'VLR ORÇADO', tipo: 'moeda', largura: 21.1, descricao: 'Preço de venda unitário passado na cotação' },
  { id: 'vlrTotalOrcado', titulo: 'VLR TOTAL ORÇADO', tipo: 'moeda', largura: 21.1, fechamento: 'soma', descricao: 'Quantidade × valor orçado' },
  { id: 'margemPrevista', titulo: 'MARGEM PREVISTA (%)', tipo: 'percentual', largura: 18.6, fechamento: 'margemPrevista', descricao: 'Lucro definido na precificação do item' },
  { id: 'dataFaturamento', titulo: 'DATA DO FATURAMENTO', tipo: 'data', largura: 18, descricao: 'Data informada na aba Faturamento' },
  { id: 'vlrFaturado', titulo: 'VLR FATURADO (R$)', tipo: 'moeda', largura: 20, fechamento: 'totalFaturado', descricao: 'Valor unitário faturado (aba Faturamento); no total, o total faturado' },
  { id: 'margemFinal', titulo: 'MARGEM FINAL (%)', tipo: 'percentual', largura: 17.6, fechamento: 'margemFinal', descricao: 'Lucro com o valor faturado e o custo do fechamento' },
  { id: 'totalDias', titulo: 'TOTAL DE DIAS', tipo: 'dias', largura: 18.6, fechamento: 'media', descricao: 'Dias corridos da confirmação ao faturamento' },
  { id: 'observacao', titulo: 'OBSERVAÇÃO', tipo: 'texto', largura: 74.1, descricao: 'Observação do item na cotação' },
  { id: 'codigo', titulo: 'COTAÇÃO', tipo: 'texto', largura: 14, descricao: 'Código da cotação (COT-0000)' },
  { id: 'admin', titulo: 'ADMIN', tipo: 'texto', largura: 16, descricao: 'Admin responsável pela cotação' },
  { id: 'status', titulo: 'STATUS', tipo: 'texto', largura: 22, descricao: 'Status atual da cotação' },
  { id: 'maquina', titulo: 'MÁQUINA', tipo: 'texto', largura: 22, descricao: 'Máquina da cotação' },
  { id: 'fornecedor', titulo: 'FORNECEDOR', tipo: 'texto', largura: 28, descricao: 'Fornecedor do item' },
  { id: 'marca', titulo: 'MARCA', tipo: 'texto', largura: 16, descricao: 'Marca do item' },
  { id: 'qtdFaturada', titulo: 'QTD. FATURADA', tipo: 'quantidade', largura: 14, fechamento: 'soma', descricao: 'Quantidade faturada (aba Faturamento)' },
  { id: 'vlrTotalFaturado', titulo: 'VLR TOTAL FATURADO (R$)', tipo: 'moeda', largura: 22, fechamento: 'soma', descricao: 'Quantidade faturada × valor faturado' },
  { id: 'diferenca', titulo: 'DIFERENÇA FATURADO x ORÇADO (R$)', tipo: 'moeda', largura: 24, fechamento: 'soma', descricao: 'Quanto o faturado ficou acima (ou abaixo) do orçado' },
  { id: 'custoUnitario', titulo: 'CUSTO UNITÁRIO (R$)', tipo: 'moeda', largura: 18, descricao: 'Custo do item com impostos e frete, do fechamento com o fornecedor' },
  { id: 'margemBruta', titulo: 'MARGEM BRUTA (%)', tipo: 'percentual', largura: 16, fechamento: 'margemBruta', descricao: '(Faturado − custo) ÷ faturado, como na aba Faturamento' },
  { id: 'notaFaturamento', titulo: 'NF DE VENDA', tipo: 'texto', largura: 16, descricao: 'Nota fiscal de venda (aba Faturamento)' },
  { id: 'prazoInformado', titulo: 'PRAZO INFORMADO', tipo: 'texto', largura: 18, descricao: 'Prazo de entrega passado ao cliente' },
  { id: 'diasUteis', titulo: 'DIAS ÚTEIS', tipo: 'dias', largura: 12, fechamento: 'media', descricao: 'Dias úteis da confirmação ao faturamento' },
  { id: 'dataCotacao', titulo: 'DATA DA COTAÇÃO', tipo: 'data', largura: 16, descricao: 'Quando a cotação foi criada' },
]

export const COLUNA = Object.fromEntries(COLUNAS.map((c) => [c.id, c])) as Record<IdColuna, DefColuna>

/** As 15 colunas da planilha, na ordem dela. */
export const COLUNAS_PADRAO: IdColuna[] = COLUNAS.slice(0, 15).map((c) => c.id)

export interface LinhaControle {
  /** cotação:item — o que identifica a linha pra retirar e trazer de volta. */
  chave: string
  cotacaoId: string
  codigo: string
  vendedor: string
  cliente: string
  maquina: string
  admin: string
  status: string
  interno: string
  ref: string
  descricao: string
  fornecedor: string
  marca: string
  observacao: string
  qtd: number
  vlrOrcado: number
  vlrTotalOrcado: number
  margemPrevista: number
  custoUnitario: number
  dataCotacao: number
  dataConfirmacao?: number
  dataFaturamento?: number
  qtdFaturada?: number
  vlrFaturado?: number
  vlrTotalFaturado?: number
  margemFinal?: number
  margemBruta?: number
  diferenca?: number
  totalDias?: number
  diasUteis?: number
  notaFaturamento: string
  prazoInformado: string
  faturada: boolean
}

export type ValorDaCelula = string | number | undefined

export function valorDaColuna(l: LinhaControle, id: IdColuna): ValorDaCelula {
  return l[id] as ValorDaCelula
}

const meiaNoite = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Dias corridos entre as duas datas, contando pelo dia do calendário (como a planilha, K − G). */
export function diasCorridos(inicio: number | undefined, fim: number | undefined): number | undefined {
  if (inicio === undefined || fim === undefined) return undefined
  return Math.round((meiaNoite(fim) - meiaNoite(inicio)) / 86400000)
}

/** A primeira vez que a cotação chegou em PEDIDO CONFIRMADO ou num status depois dele (sem contar o arquivo). */
function dataDaConfirmacao(cotacao: QuoteRecord): number | undefined {
  const ordem = statusDe('cotacoes')
  const marco = ordem.indexOf('PEDIDO CONFIRMADO')
  const passo = passosDoStatus(cotacao).find((p) => p.para !== 'ARQUIVO' && ordem.indexOf(p.para) >= marco && marco >= 0)
  return passo?.em
}

/** Lucro sobre a venda com outro preço e outro custo, mantendo impostos, comissão e custo fixo do item. */
function lucroCom(preco: number, custo: number, cmvFracao: number, lucroPct: number): number | undefined {
  if (!(preco > 0) || !(cmvFracao > 0)) return undefined
  return cmvFracao + lucroPct - custo / preco
}

export function linhasDaCotacao(cotacao: QuoteRecord): LinhaControle[] {
  const dataConfirmacao = dataDaConfirmacao(cotacao)
  const faturamentos = cotacao.itensFaturados ?? {}
  const temItensFaturados = Object.keys(faturamentos).length > 0
  // entra quem passou da confirmação do pedido, ou já tem faturamento registrado
  if (dataConfirmacao === undefined && !temItensFaturados) return []
  // faturada antes de existir o valor por item na aba Faturamento: a data vale pra todos os itens, sem valor
  const faturadaSoPeloStatus = !temItensFaturados && cotacao.statusHistory.some((h) => h.status === 'FATURADO')
  const dataFaturamento = temItensFaturados || faturadaSoPeloStatus ? dataDoFaturamento(cotacao) : undefined

  return itensDoPedidoDeCompra(cotacao).map((item) => {
    const p = item.product
    const calculado = calculateItem(p, item.pricing)
    const vlrOrcado = precoPassado(item)
    const custoUnitario = custoFinal(cotacao, item)
    const f = faturamentos[item.id]
    const faturada = !!f || faturadaSoPeloStatus
    const qtd = p.qtd || 0
    const margemFinal = f ? lucroCom(f.valorUnt, custoUnitario, calculado.cmvFracao, item.pricing.lucroPct) : undefined
    return {
      chave: `${cotacao.id}:${item.id}`,
      cotacaoId: cotacao.id,
      codigo: cotacao.codigo || '',
      vendedor: (cotacao.vendedor || '').trim(),
      cliente: (cotacao.cliente || '').trim(),
      maquina: cotacao.maquina || '',
      admin: adminDaCotacao(cotacao),
      status: nomeDoStatus(cotacao.status),
      interno: p.interno || '',
      ref: p.referencia || '',
      descricao: p.descricao || '',
      fornecedor: p.fornecedor || '',
      marca: p.marca || '',
      observacao: p.observacao || '',
      qtd,
      vlrOrcado,
      vlrTotalOrcado: vlrOrcado * qtd,
      margemPrevista: item.pricing.lucroPct,
      custoUnitario,
      dataCotacao: cotacao.dataSolicitacao ?? cotacao.createdAt,
      dataConfirmacao,
      dataFaturamento: faturada ? dataFaturamento : undefined,
      qtdFaturada: f?.qtd,
      vlrFaturado: f?.valorUnt,
      vlrTotalFaturado: f ? f.qtd * f.valorUnt : undefined,
      margemFinal,
      margemBruta: f && f.valorUnt > 0 ? (f.valorUnt - custoUnitario) / f.valorUnt : undefined,
      diferenca: f ? (f.valorUnt - vlrOrcado) * f.qtd : undefined,
      totalDias: faturada ? diasCorridos(dataConfirmacao, dataFaturamento) : undefined,
      diasUteis:
        faturada && dataConfirmacao !== undefined && dataFaturamento !== undefined && dataFaturamento >= dataConfirmacao ? diasUteisDesde(dataConfirmacao, dataFaturamento) : undefined,
      notaFaturamento: cotacao.notaFaturamento ?? '',
      prazoInformado: p.prazoEntrega?.trim() || '',
      faturada,
    }
  })
}

// --- filtros, ordem e grupos ------------------------------------------------------------------
export type DataDeReferencia = 'confirmacao' | 'faturamento'
export type Situacao = 'todas' | 'faturadas' | 'aFaturar'
export type Agrupamento = 'nenhum' | 'vendedor' | 'cliente' | 'mesConfirmacao' | 'mesFaturamento'

export const AGRUPAMENTOS: { id: Agrupamento; nome: string }[] = [
  { id: 'nenhum', nome: 'Sem agrupar' },
  { id: 'vendedor', nome: 'Vendedor' },
  { id: 'cliente', nome: 'Cliente' },
  { id: 'mesConfirmacao', nome: 'Mês da confirmação' },
  { id: 'mesFaturamento', nome: 'Mês do faturamento' },
]

export interface Filtro {
  inicio: number
  fim: number
  dataDeReferencia: DataDeReferencia
  situacao: Situacao
  /** Vazio = todos. */
  vendedores: string[]
  busca: string
}

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

export function filtrar(linhas: LinhaControle[], f: Filtro): LinhaControle[] {
  const busca = semAcento(f.busca.trim())
  return linhas.filter((l) => {
    const data = f.dataDeReferencia === 'confirmacao' ? l.dataConfirmacao : l.dataFaturamento
    if (data === undefined || data < f.inicio || data >= f.fim) return false
    if (f.situacao === 'faturadas' && !l.faturada) return false
    if (f.situacao === 'aFaturar' && l.faturada) return false
    if (f.vendedores.length > 0 && !f.vendedores.includes(l.vendedor)) return false
    if (busca && !semAcento([l.vendedor, l.cliente, l.interno, l.ref, l.descricao, l.codigo, l.observacao, l.fornecedor].join(' ')).includes(busca)) return false
    return true
  })
}

export interface Ordem {
  coluna: IdColuna
  desc: boolean
}

function comparar(a: ValorDaCelula, b: ValorDaCelula): number {
  if (a === undefined || a === '') return b === undefined || b === '' ? 0 : 1
  if (b === undefined || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true })
}

/** Sem ordem escolhida: por vendedor, data da confirmação e cliente, como na planilha. Vazio fica sempre no fim. */
export function ordenar(linhas: LinhaControle[], ordem: Ordem | null): LinhaControle[] {
  const padrao = (a: LinhaControle, b: LinhaControle) =>
    comparar(a.vendedor, b.vendedor) || comparar(a.dataConfirmacao, b.dataConfirmacao) || comparar(a.cliente, b.cliente) || comparar(a.descricao, b.descricao)
  return [...linhas].sort((a, b) => {
    if (!ordem) return padrao(a, b)
    const va = valorDaColuna(a, ordem.coluna)
    const vb = valorDaColuna(b, ordem.coluna)
    const vazio = (v: ValorDaCelula) => v === undefined || v === ''
    if (vazio(va) || vazio(vb)) return comparar(va, vb) || padrao(a, b)
    return (ordem.desc ? -comparar(va, vb) : comparar(va, vb)) || padrao(a, b)
  })
}

const nomeDoMes = (t: number | undefined) =>
  t === undefined ? 'Sem data' : new Date(t).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())

const chaveDoMes = (t: number | undefined) => (t === undefined ? '9999-99' : `${new Date(t).getFullYear()}-${String(new Date(t).getMonth() + 1).padStart(2, '0')}`)

export interface Grupo {
  titulo: string
  linhas: LinhaControle[]
}

/** Agrupa mantendo a ordem de dentro de cada grupo; os grupos vão em ordem alfabética (mês: do mais antigo). */
export function agrupar(linhas: LinhaControle[], como: Agrupamento): Grupo[] | null {
  if (como === 'nenhum') return null
  const chave = (l: LinhaControle): [string, string] => {
    if (como === 'vendedor') return [l.vendedor || 'Sem vendedor', l.vendedor.toUpperCase()]
    if (como === 'cliente') return [l.cliente || 'Sem cliente', l.cliente.toUpperCase()]
    const data = como === 'mesConfirmacao' ? l.dataConfirmacao : l.dataFaturamento
    return [nomeDoMes(data), chaveDoMes(data)]
  }
  const grupos = new Map<string, Grupo>()
  for (const l of linhas) {
    const [titulo, ordem] = chave(l)
    const g = grupos.get(ordem) ?? { titulo, linhas: [] }
    g.linhas.push(l)
    grupos.set(ordem, g)
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([, g]) => g)
}

// --- totais -------------------------------------------------------------------------------------
const ponderada = (linhas: LinhaControle[], peso: (l: LinhaControle) => number | undefined, valor: (l: LinhaControle) => number | undefined) => {
  let soma = 0
  let pesos = 0
  for (const l of linhas) {
    const p = peso(l)
    const v = valor(l)
    if (p === undefined || v === undefined || !(p > 0)) continue
    soma += p * v
    pesos += p
  }
  return pesos > 0 ? soma / pesos : undefined
}

/** O fechamento de uma coluna num conjunto de linhas (a linha de total e as de subtotal). */
export function fechamentoDaColuna(linhas: LinhaControle[], id: IdColuna): number | undefined {
  const tipo = COLUNA[id].fechamento
  if (!tipo) return undefined
  const numeros = linhas.map((l) => valorDaColuna(l, id)).filter((v): v is number => typeof v === 'number')
  if (tipo === 'soma') return numeros.reduce((s, v) => s + v, 0)
  if (tipo === 'media') return numeros.length > 0 ? numeros.reduce((s, v) => s + v, 0) / numeros.length : undefined
  if (tipo === 'totalFaturado') return linhas.reduce((s, l) => s + (l.vlrTotalFaturado ?? 0), 0)
  if (tipo === 'margemPrevista') return ponderada(linhas, (l) => l.vlrTotalOrcado, (l) => l.margemPrevista)
  if (tipo === 'margemFinal') return ponderada(linhas, (l) => l.vlrTotalFaturado, (l) => l.margemFinal)
  return ponderada(linhas, (l) => l.vlrTotalFaturado, (l) => l.margemBruta)
}

// --- formato da tela (o que fica salvo neste aparelho) ------------------------------------------
export interface FormatoDoControle {
  colunas: IdColuna[]
  agrupar: Agrupamento
  ordem: Ordem | null
}

export const FORMATO_PADRAO: FormatoDoControle = { colunas: COLUNAS_PADRAO, agrupar: 'nenhum', ordem: null }

/** O salvo pode ser de uma versão antiga: só valem colunas que existem, sem repetir, e pelo menos uma. */
export function formatoValido(f: Partial<FormatoDoControle> | null | undefined): FormatoDoControle {
  const ids = new Set(COLUNAS.map((c) => c.id))
  const colunas = [...new Set((f?.colunas ?? []).filter((c) => ids.has(c)))]
  return {
    colunas: colunas.length > 0 ? colunas : COLUNAS_PADRAO,
    agrupar: AGRUPAMENTOS.some((a) => a.id === f?.agrupar) ? f!.agrupar! : 'nenhum',
    ordem: f?.ordem && ids.has(f.ordem.coluna) ? f.ordem : null,
  }
}
