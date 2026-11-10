import { confirmar, pedirMotivoArquivamento, pedirProducao, type RespostaProducao } from './dialogs'
import { formatCurrency } from './utils'
import { totalAtualParaOVendedor, valoresMudaram } from './valoresEnviados'
import { fornecedoresDoPedido, itensDoPedidoDeCompra } from './fornecedoresDoPedido'
import type { QuoteItem, QuoteRecord, QuoteStatus } from './types'

export { itensDoPedidoDeCompra }

// -----------------------------------------------------------------------
// O que é perguntado antes de mudar o status de uma cotação — igual em
// todas as telas que mudam status (Cotações, Histórico, Pedido de Compra,
// Faturamento): o motivo, ao arquivar; a produção, ao confirmar o pedido.
// -----------------------------------------------------------------------

function rotuloDoItem(item: QuoteItem, indice: number): string {
  const nome = [item.product.referencia, item.product.descricao].filter((x) => x?.trim()).join(' — ') || `Item ${indice + 1}`
  return item.product.qtd ? `${nome} ×${item.product.qtd}` : nome
}

/** Pergunta se o pedido está todo ou só em parte em produção — começando pelo que já foi informado. */
export function perguntarProducao(cotacao: Pick<QuoteRecord, 'codigo' | 'items' | 'pedidoCompra' | 'producao'>): Promise<RespostaProducao | null> {
  const itens = itensDoPedidoDeCompra(cotacao)
  const atual = cotacao.producao
  // mais de um fornecedor no pedido: a previsão de finalização é pedida pra cada um
  const fornecedores = fornecedoresDoPedido(cotacao)
  return pedirProducao(
    `${cotacao.codigo ? `${cotacao.codigo} — ` : ''}o pedido já está todo em produção no fornecedor, ou só uma parte?`,
    itens.map((item, i) => ({ id: item.id, rotulo: rotuloDoItem(item, i) })),
    atual
      ? {
          tipo: atual.tipo,
          itemIds: atual.itemIds,
          observacao: atual.observacao,
          previsaoFinalizacao: atual.previsaoFinalizacao ?? '',
          previsaoPorFornecedor: atual.previsaoPorFornecedor,
        }
      : undefined,
    fornecedores.length > 1 ? fornecedores.map((f) => ({ chave: f.chaveDados, rotulo: f.rotulo })) : undefined,
  )
}

export interface RespostasDoStatus {
  arquivamento?: { motivo: string; detalhe: string }
  producao?: RespostaProducao
  /** Indo de novo pra ENVIADO com valores diferentes dos que o vendedor vê: trocar pelos de agora? */
  atualizarValoresDoVendedor?: boolean
}

/** Pergunta o que o novo status precisa antes de mudar. null = cancelou, e o status não deve mudar. */
export async function perguntarAntesDoStatus(
  cotacao: Pick<QuoteRecord, 'codigo' | 'items' | 'pedidoCompra' | 'producao'> & Partial<Pick<QuoteRecord, 'vendedor' | 'valoresEnviados'>>,
  novoStatus: QuoteStatus,
): Promise<RespostasDoStatus | null> {
  if (novoStatus === 'ENVIADO') {
    const atualizar = await perguntarSeReenviaAoVendedor(cotacao)
    return atualizar === undefined ? {} : { atualizarValoresDoVendedor: atualizar }
  }
  if (novoStatus === 'ARQUIVO') {
    // arquivar sempre pede o motivo de a cotação não ter fechado — sem motivo, não arquiva
    const arquivamento = await pedirMotivoArquivamento(`Por que a cotação ${cotacao.codigo || ''} não foi fechada?`)
    return arquivamento ? { arquivamento } : null
  }
  if (novoStatus === 'PEDIDO CONFIRMADO') {
    const producao = await perguntarProducao(cotacao)
    return producao ? { producao } : null
  }
  return {}
}

/** A cotação vai de novo pra ENVIADO e os valores mudaram desde o último envio ao vendedor: pergunta
 * se ele passa a ver os de agora (ver valoresEnviados.ts). undefined = não há o que perguntar. */
export async function perguntarSeReenviaAoVendedor(
  cotacao: Pick<QuoteRecord, 'items'> & Partial<Pick<QuoteRecord, 'vendedor' | 'valoresEnviados'>>,
): Promise<boolean | undefined> {
  if (!cotacao.vendedor || !cotacao.valoresEnviados || !valoresMudaram({ items: cotacao.items, valoresEnviados: cotacao.valoresEnviados })) return undefined
  return confirmar(
    `A cotação vai como enviada, mas os valores mudaram desde o que o vendedor ${cotacao.vendedor} vê ` +
      `(total ${formatCurrency(cotacao.valoresEnviados.total)} → ${formatCurrency(totalAtualParaOVendedor(cotacao.items))}).\n\n` +
      'Atualizar os valores que o vendedor vê?',
    { titulo: 'Valores do vendedor', confirmText: 'Atualizar para o vendedor', cancelText: 'Manter os enviados' },
  )
}
