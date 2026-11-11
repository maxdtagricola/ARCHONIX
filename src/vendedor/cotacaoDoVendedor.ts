import { baixarArquivoDoServidor, chamarServidor, dbGetAll, STORE_ANALISES } from '../db/db'
import { antesDoPedidoDeCompra } from '../itensDoVendedor'
import type { AlteracaoVendedor, AnexoVendedor, ItemPedidoVendedor, ItemValorEnviado, QuoteStatus } from '../types'

/** Os valores enviados como o vendedor recebe: sem quando nem quem enviou (servidores de antes
 * mandavam as datas — a tela não mostra). */
export interface ValoresParaOVendedor {
  itens: ItemValorEnviado[]
  total: number
  uf?: string
  /** Quem cota trocou os valores depois do primeiro envio. */
  atualizada?: boolean
  /** (servidores de antes) */
  atualizadoEm?: number
}

// A cotação como o servidor entrega ao vendedor (ver "vendedores" no server.js): só as que estão no
// nome dele, e sem custos, fornecedores, margens, frete, pedido de compra ou faturamento. Os valores,
// só os que mandamos pra ele ao enviar (valoresEnviados).

export type ItemPedido = ItemPedidoVendedor

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
  /** Ainda dá pra alterar (até antes do PEDIDO DE COMPRA — o servidor é quem decide; os de antes não mandam). */
  podeAlterar?: boolean
  /** Quem está cotando (vazio enquanto PENDENTE). */
  responsavelStatus: string
  /** Só a sequência dos status — sem as datas (servidores de antes mandavam; a tela não mostra). */
  statusHistory: { status: QuoteStatus; changedAt?: number }[]
  /** A lista de itens dele, a que ele vê e altera: a da precificação (com o que ele mudou e a equipe
   * ainda não salvou) ou, antes de a equipe precificar, a que ele mandou. Servidores de antes mandavam
   * aqui só a que ele mandou — a da precificação vinha em `itensDaCotacao`. */
  itensPreRegistro: ItemPedido[]
  /** (servidores de antes) Os itens já na precificação — só o que identifica cada um. */
  itensDaCotacao: (Omit<ItemPedido, 'id'> & { id?: string })[]
  valoresEnviados?: ValoresParaOVendedor
  /** Previsões de a produção ficar pronta ("AAAA-MM-DD"). */
  previsoesDeProducao: string[]
  entregas: { previsaoEntrega: string; entregueEm?: number }[]
  alteracoesVendedor: Pick<AlteracaoVendedor, 'id' | 'em' | 'por' | 'campos'>[]
  /** Os originais que ele mandou (servidores antigos não mandam). */
  anexosVendedor?: AnexoVendedor[]
  /** Nome do arquivo da planilha do cliente, se tiver. */
  planilhaCliente?: string
  createdAt: number
  updatedAt: number
}

/** Um original pra mandar junto (foto/print já reduzida, PDF) — vira anexo da cotação. */
export interface ArquivoParaAnexar {
  nome: string
  tipo: string
  conteudoBase64: string
}

/** O que o vendedor manda ao criar ou alterar (o servidor confere e registra o que mudou). */
export interface DadosDaCotacaoDoVendedor {
  id: string
  cliente: string
  maquina: string
  observacao: string
  dataSolicitacao?: number
  itensPreRegistro: ItemPedido[]
  anexosNovos?: ArquivoParaAnexar[]
  /** A planilha do cliente, pra equipe devolver preenchida (a mesma das que ela importa). */
  planilhaCliente?: { nomeArquivo: string; conteudoBase64: string }
}

/** Ainda dá pra ele alterar? A partir do PEDIDO DE COMPRA, não. */
export function podeAlterar(c: Pick<CotacaoDoVendedor, 'podeAlterar' | 'status'>): boolean {
  return c.podeAlterar ?? antesDoPedidoDeCompra(c.status)
}

/** A lista de itens dele (ver `itensPreRegistro`) — com servidor de antes, a da precificação quando ele
 * não mandou nenhuma. */
export function itensDaLista(c: Pick<CotacaoDoVendedor, 'itensPreRegistro' | 'itensDaCotacao'>): ItemPedido[] {
  if (c.itensPreRegistro.length > 0) return c.itensPreRegistro
  return c.itensDaCotacao.map((i, n) => ({ ...i, id: i.id || `precificacao-${n + 1}` }))
}

export async function listarMinhasCotacoes(): Promise<CotacaoDoVendedor[]> {
  const lista = await dbGetAll<CotacaoDoVendedor>(STORE_ANALISES)
  return lista.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Só o Max: as cotações de um vendedor exatamente como ele as vê (pra visualizar a tela dele). */
export async function listarCotacoesDoVendedor(vendedor: string): Promise<CotacaoDoVendedor[]> {
  const lista = await chamarServidor<CotacaoDoVendedor[]>(`/_vendedores/${encodeURIComponent(vendedor)}/analises`)
  return lista.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Devolve a cotação como ficou (o servidor responde com ela). */
export async function salvarMinhaCotacao(dados: DadosDaCotacaoDoVendedor): Promise<CotacaoDoVendedor | undefined> {
  // com arquivos junto, o envio pode demorar bem mais que o normal
  const comArquivos = (dados.anexosNovos?.length ?? 0) > 0 || !!dados.planilhaCliente
  return chamarServidor<CotacaoDoVendedor | undefined>(`/${STORE_ANALISES}/${encodeURIComponent(dados.id)}`, {
    method: 'PUT',
    corpo: dados,
    timeoutMs: comArquivos ? 120000 : undefined,
  })
}

/** Abre um anexo numa aba nova (ou baixa, se o navegador não abrir o tipo). */
export async function abrirAnexo(idCotacao: string, anexo: Pick<AnexoVendedor, 'id' | 'nome'>): Promise<void> {
  // a aba abre já (antes de esperar o download), senão o navegador a trata como pop-up e bloqueia
  const aba = window.open('', '_blank')
  try {
    const blob = await baixarArquivoDoServidor(`/_anexos/${encodeURIComponent(idCotacao)}/${encodeURIComponent(anexo.id)}`)
    const url = URL.createObjectURL(blob)
    if (aba) aba.location.href = url
    else {
      const link = document.createElement('a')
      link.href = url
      link.download = anexo.nome
      link.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)
  } catch (err) {
    aba?.close()
    throw err
  }
}
