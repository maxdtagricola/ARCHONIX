import { mercadoriaRecebida } from './avisosEntrega'
import { chaveFornecedorFrete } from './db/analysesRepo'
import { CHAVE_SEM_FORNECEDOR, itensDoPedidoDeCompra } from './fornecedoresDoPedido'
import type { ItemFaturado, QuoteItem, QuoteRecord } from './types'

// -----------------------------------------------------------------------
// Faturamento em partes: o tempo de produção e de viagem dos itens de um
// mesmo pedido varia, então o que já chegou é faturado (com a nota e a data
// dele) enquanto o resto segue no transporte. A cotação fica em FATURADO
// PARCIALMENTE (antes de ENTREGUE no fluxo, pra continuar "a caminho": avisos
// de entrega, Pedido de Compra) e os relatórios separam o faturado do que
// ainda falta faturar.
// -----------------------------------------------------------------------

export const STATUS_FATURADO_PARCIALMENTE = 'FATURADO PARCIALMENTE'

export type SituacaoDoFaturamento = 'nada' | 'parcial' | 'total'

/** O item tem faturamento registrado na quantidade toda? */
function itemFaturadoInteiro(item: QuoteItem, f: ItemFaturado | undefined): boolean {
  return !!f && f.qtd + 1e-9 >= (item.product.qtd || 0)
}

/** Quanto do pedido já foi faturado: nada, uma parte (alguns itens, ou parte da quantidade de um) ou tudo. */
export function situacaoDoFaturamento(cotacao: Pick<QuoteRecord, 'items' | 'pedidoCompra' | 'itensFaturados'>): SituacaoDoFaturamento {
  const itens = itensDoPedidoDeCompra(cotacao)
  const faturados = cotacao.itensFaturados ?? {}
  if (!itens.some((item) => faturados[item.id])) return 'nada'
  return itens.every((item) => itemFaturadoInteiro(item, faturados[item.id])) ? 'total' : 'parcial'
}

/** O que ainda falta faturar, pelo preço passado: os itens sem faturamento e o resto da quantidade dos
 * faturados em parte. `precoDe` é o preço de venda unitário do item. */
export function valorAFaturar(cotacao: Pick<QuoteRecord, 'items' | 'pedidoCompra' | 'itensFaturados'>, precoDe: (item: QuoteItem) => number): number {
  let total = 0
  for (const item of itensDoPedidoDeCompra(cotacao)) {
    const resto = Math.max(0, (item.product.qtd || 0) - (cotacao.itensFaturados?.[item.id]?.qtd ?? 0))
    total += resto * precoDe(item)
  }
  return total
}

/** Nota e data do faturamento do item: as dele ou, faturado antes de cada parte ter a sua, as da cotação. */
export function notaEDataDoItem(cotacao: Pick<QuoteRecord, 'notaFaturamento' | 'dataFaturamento'>, f: ItemFaturado | undefined): { nota: string; data: string } {
  return {
    nota: f?.notaFiscal !== undefined ? f.notaFiscal : (cotacao.notaFaturamento ?? ''),
    data: f?.data !== undefined ? f.data : (cotacao.dataFaturamento ?? ''),
  }
}

export interface ParteFaturada {
  nota: string
  /** "AAAA-MM-DD" ('' sem data) */
  data: string
  itens: number
  valor: number
}

/** Cada parte faturada da cotação (uma por nota + data), da mais antiga pra mais nova. */
export function partesFaturadas(cotacao: Pick<QuoteRecord, 'items' | 'pedidoCompra' | 'itensFaturados' | 'notaFaturamento' | 'dataFaturamento'>): ParteFaturada[] {
  const partes = new Map<string, ParteFaturada>()
  for (const item of itensDoPedidoDeCompra(cotacao)) {
    const f = cotacao.itensFaturados?.[item.id]
    if (!f) continue
    const { nota, data } = notaEDataDoItem(cotacao, f)
    const chave = `${data}|${nota.trim().toUpperCase()}`
    const parte = partes.get(chave) ?? { nota: nota.trim(), data, itens: 0, valor: 0 }
    parte.itens++
    parte.valor += f.qtd * f.valorUnt
    partes.set(chave, parte)
  }
  return [...partes.values()].sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999') || a.nota.localeCompare(b.nota, 'pt-BR'))
}

/** A nota e a data que ficam na cotação: as notas de todas as partes (sem repetir) e a data da última. */
export function notaEDataDaCotacao(itensFaturados: Record<string, ItemFaturado>): { nota: string; data: string } {
  const notas: string[] = []
  let data = ''
  for (const f of Object.values(itensFaturados)) {
    for (const n of (f.notaFiscal ?? '').split(/[,;/]+/).map((s) => s.trim()).filter(Boolean)) if (!notas.includes(n)) notas.push(n)
    if (f.data && f.data > data) data = f.data
  }
  return { nota: notas.join(', '), data }
}

export type EntregaDoItem =
  | { situacao: 'entregue'; em?: number }
  | { situacao: 'caminho'; previsao?: string; notaFiscal?: string }
  | { situacao: 'semEnvio' }

/** Se o item já chegou: pelo envio do fornecedor dele (Pedido de Compra) — de ENTREGUE em diante, tudo chegou. */
export function entregaDoItem(cotacao: Pick<QuoteRecord, 'status' | 'transportePorFornecedor'>, item: QuoteItem): EntregaDoItem {
  const nome = item.product.fornecedor.trim()
  const chave = (nome ? chaveFornecedorFrete(nome, item.product.estadoOrigem) : '') || CHAVE_SEM_FORNECEDOR
  const envio = cotacao.transportePorFornecedor?.[chave]
  if (envio?.entregueEm) return { situacao: 'entregue', em: envio.entregueEm }
  if (mercadoriaRecebida(cotacao.status)) return { situacao: 'entregue' }
  if (envio) return { situacao: 'caminho', previsao: envio.previsaoEntrega, notaFiscal: envio.numeroNotaFiscal || undefined }
  return { situacao: 'semEnvio' }
}
