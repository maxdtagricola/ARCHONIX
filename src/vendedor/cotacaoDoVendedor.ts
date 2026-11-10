import { dbGetAll, dbPut, STORE_ANALISES } from '../db/db'
import type { AlteracaoVendedor, QuoteStatus, StatusChange, ValoresEnviados } from '../types'

// A cotação como o servidor entrega ao vendedor (ver "vendedores" no server.js): só as que estão no
// nome dele, e sem custos, fornecedores, margens, frete, pedido de compra ou faturamento. Os valores,
// só os que mandamos pra ele ao enviar (valoresEnviados).

export interface ItemPedido {
  id: string
  interno: string
  referencia: string
  descricao: string
  quantidade: number
}

export interface CotacaoDoVendedor {
  id: string
  codigo: string
  vendedor: string
  criadoPor: string
  cliente: string
  maquina: string
  observacao: string
  dataSolicitacao?: number
  status: QuoteStatus
  /** Quem está cotando (vazio enquanto PENDENTE). */
  responsavelStatus: string
  statusHistory: Pick<StatusChange, 'status' | 'changedAt'>[]
  /** Os itens que o vendedor pediu (é o que ele altera). */
  itensPreRegistro: ItemPedido[]
  /** Os itens já na precificação — só o que identifica cada um. */
  itensDaCotacao: Omit<ItemPedido, 'id'>[]
  valoresEnviados?: ValoresEnviados
  /** Previsões de a produção ficar pronta ("AAAA-MM-DD"). */
  previsoesDeProducao: string[]
  entregas: { previsaoEntrega: string; entregueEm?: number }[]
  alteracoesVendedor: Pick<AlteracaoVendedor, 'id' | 'em' | 'por' | 'campos'>[]
  createdAt: number
  updatedAt: number
}

/** O que o vendedor manda ao criar ou alterar (o servidor confere e registra o que mudou). */
export interface DadosDaCotacaoDoVendedor {
  id: string
  cliente: string
  maquina: string
  observacao: string
  dataSolicitacao?: number
  itensPreRegistro: ItemPedido[]
}

export async function listarMinhasCotacoes(): Promise<CotacaoDoVendedor[]> {
  const lista = await dbGetAll<CotacaoDoVendedor>(STORE_ANALISES)
  return lista.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function salvarMinhaCotacao(dados: DadosDaCotacaoDoVendedor): Promise<void> {
  await dbPut(STORE_ANALISES, dados)
}
