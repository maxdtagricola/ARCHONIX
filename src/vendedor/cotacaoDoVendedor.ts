import { baixarArquivoDoServidor, chamarServidor, dbGetAll, STORE_ANALISES } from '../db/db'
import type { AlteracaoVendedor, AnexoVendedor, ItemValorEnviado, QuoteStatus } from '../types'

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
  /** Só a sequência dos status — sem as datas (servidores de antes mandavam; a tela não mostra). */
  statusHistory: { status: QuoteStatus; changedAt?: number }[]
  /** Os itens que o vendedor pediu (é o que ele altera). */
  itensPreRegistro: ItemPedido[]
  /** Os itens já na precificação — só o que identifica cada um. */
  itensDaCotacao: Omit<ItemPedido, 'id'>[]
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
