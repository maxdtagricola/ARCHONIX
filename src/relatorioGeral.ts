import { calculateItem } from './calc/calculator'
import { diasUteisDesde } from './diasUteis'
import { itensDoPedidoDeCompra } from './fornecedoresDoPedido'
import { entradaNoPedidoDeCompra, passosDoStatus } from './historicoStatus'
import { formatarNumeroBR } from './numeros'
import { statusDe } from './statusConfig'
import { STATUS_FATURADO_PARCIALMENTE, partesFaturadas, situacaoDoFaturamento, valorAFaturar } from './faturamentoParcial'
import type { ItemFaturado, QuoteRecord } from './types'
import { custoFinal, precoPassado } from './valoresDoPedido'

// -----------------------------------------------------------------------
// Relatório geral pros supervisores: em que pé estão as cotações de um ou
// mais admins (não fechadas, confirmadas, em transporte, faturadas), com
// preço, custo, margem, prazos e o valor de faturamento final. As contas de
// custo e margem são as mesmas da aba Faturamento — (venda − custo) ÷ venda,
// com o custo do que fechou no Pedido de Compra —, pra um número não
// desmentir o outro.
// -----------------------------------------------------------------------

export type EtapaRelatorio = 'aberta' | 'arquivada' | 'confirmada' | 'transporte' | 'entregue' | 'parcial' | 'faturada'

export const ETAPAS_RELATORIO: { id: EtapaRelatorio; nome: string; detalhe: string }[] = [
  { id: 'aberta', nome: 'Não fechadas — em aberto', detalhe: 'Antes do pedido de compra' },
  { id: 'arquivada', nome: 'Não fechadas — arquivadas', detalhe: 'Arquivadas sem faturar' },
  { id: 'confirmada', nome: 'Confirmadas', detalhe: 'Pedido de compra e pedido confirmado' },
  { id: 'transporte', nome: 'Em transporte', detalhe: 'A caminho, ainda sem entrega' },
  { id: 'entregue', nome: 'Entregues, a faturar', detalhe: 'De parcialmente entregue até conferido' },
  { id: 'parcial', nome: 'Faturadas parcialmente', detalhe: 'Parte faturada; o resto a caminho ou a faturar' },
  { id: 'faturada', nome: 'Faturadas', detalhe: 'Pedido faturado' },
]

export const SEM_RESPONSAVEL = 'Sem responsável'
const SEM_MOTIVO = 'Sem motivo registrado'

/** O admin da cotação: quem a tirou de PENDENTE; ainda pendente, quem criou. */
export function adminDaCotacao(cotacao: QuoteRecord): string {
  return cotacao.responsavelStatus?.trim() || cotacao.criadoPor?.trim() || SEM_RESPONSAVEL
}

function foiFaturada(cotacao: QuoteRecord): boolean {
  return Object.keys(cotacao.itensFaturados ?? {}).length > 0 || cotacao.statusHistory.some((h) => h.status === 'FATURADO')
}

/** Vai pela posição do status no fluxo, não pelo nome: um status criado em Configurações cai na etapa
 * de onde ele foi colocado. Pedido com parte faturada e parte não (ainda antes de FATURADO) fica em
 * "faturadas parcialmente", esteja o resto a caminho ou já entregue. */
export function etapaDaCotacao(cotacao: QuoteRecord): EtapaRelatorio {
  if (cotacao.status === 'ARQUIVO') return foiFaturada(cotacao) ? 'faturada' : 'arquivada'
  const ordem = statusDe('cotacoes')
  const posicao = ordem.indexOf(cotacao.status)
  const antesDe = (marco: string) => posicao < ordem.indexOf(marco)
  if (antesDe('PEDIDO DE COMPRA')) return 'aberta'
  if (!antesDe('FATURADO')) return 'faturada'
  if (cotacao.status === STATUS_FATURADO_PARCIALMENTE || situacaoDoFaturamento(cotacao) === 'parcial') return 'parcial'
  if (antesDe('EM TRANSPORTE')) return 'confirmada'
  if (antesDe('PARCIALMENTE ENTREGUE')) return 'transporte'
  return 'entregue'
}

const diaValido = (data: string | undefined) => {
  const t = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(`${data}T12:00:00`).getTime() : NaN
  return Number.isNaN(t) ? undefined : t
}

/** Data do item faturado: a dele (faturamento em partes), a da cotação ou a do registro. */
export function dataDoItemFaturado(cotacao: QuoteRecord, f: ItemFaturado): number {
  return diaValido(f.data) ?? diaValido(cotacao.dataFaturamento) ?? f.registradoEm
}

/** A do último faturamento (em partes, a da parte mais recente). */
export function dataDoFaturamento(cotacao: QuoteRecord): number | undefined {
  const dosItens = Object.values(cotacao.itensFaturados ?? {})
    .map((f) => diaValido(f.data))
    .filter((t): t is number => t !== undefined)
  if (dosItens.length > 0) return Math.max(...dosItens)
  const informada = diaValido(cotacao.dataFaturamento)
  if (informada !== undefined) return informada
  const registros = Object.values(cotacao.itensFaturados ?? {}).map((f) => f.registradoEm)
  if (registros.length > 0) return Math.max(...registros)
  return [...cotacao.statusHistory].reverse().find((h) => h.status === 'FATURADO')?.changedAt
}

function diasEntre(inicio: number | undefined, fim: number | undefined): number | undefined {
  return inicio !== undefined && fim !== undefined && fim >= inicio ? diasUteisDesde(inicio, fim) : undefined
}

export interface LinhaRelatorio {
  id: string
  codigo: string
  cliente: string
  vendedor: string
  admin: string
  status: string
  etapa: EtapaRelatorio
  criadaEm: number
  /** Data do faturamento: a informada na aba Faturamento; sem ela, a do registro ou a do status. */
  faturadaEm?: number
  notaFaturamento: string
  /** O prazo que foi dado ao cliente, como foi escrito nos itens ("20 A 25 DIAS"). */
  prazoInformado: string
  /** Preço de venda passado na cotação. Fechada só com alguns itens, conta só eles. */
  valorCotado: number
  custo: number
  /** Lucro definido na precificação (a "Margem" de lá), em R$. */
  lucroDefinido: number
  faturado: number
  /** Faturada sem o valor registrado na aba Faturamento: `faturado` é o preço passado na cotação. */
  faturadoEstimado: boolean
  custoDoFaturado: number
  /** O que falta faturar, pelo preço passado — nas entregues a faturar e nas faturadas em parte. */
  aFaturar: number
  /** Em quantas partes (notas/datas) foi faturada até agora. */
  partesFaturadas: number
  /** Em dias úteis: da solicitação até enviar a cotação. */
  diasResposta?: number
  /** Em dias úteis: do pedido de compra até a mercadoria chegar. */
  diasEntrega?: number
  /** Em dias úteis: da entrega até o faturamento. */
  diasFaturamento?: number
  /** Arquivada sem fechar: o motivo. */
  motivo?: string
  motivoDetalhe?: string
}

export function linhaDaCotacao(cotacao: QuoteRecord): LinhaRelatorio {
  const etapa = etapaDaCotacao(cotacao)
  const itens = itensDoPedidoDeCompra(cotacao)
  let valorCotado = 0
  let custo = 0
  let lucroDefinido = 0
  let faturado = 0
  let custoDoFaturado = 0
  for (const item of itens) {
    const calculado = calculateItem(item.product, item.pricing)
    const custoUnitario = custoFinal(cotacao, item)
    valorCotado += calculado.precoVendaTotal
    lucroDefinido += calculado.breakdown.lucro
    custo += custoUnitario * (item.product.qtd || 0)
    const f = cotacao.itensFaturados?.[item.id]
    if (f) {
      faturado += f.qtd * f.valorUnt
      custoDoFaturado += custoUnitario * f.qtd
    }
  }
  const faturadoEstimado = etapa === 'faturada' && faturado === 0
  const faturadaEm = etapa === 'faturada' || faturado > 0 ? dataDoFaturamento(cotacao) : undefined
  const aFaturar = etapa === 'entregue' || etapa === 'parcial' ? valorAFaturar(cotacao, precoPassado) : 0

  const passos = passosDoStatus(cotacao)
  const primeiraEm = (...status: string[]) => passos.find((p) => status.includes(p.para))?.em
  const entregueEm = primeiraEm('ENTREGUE', 'CONFERIDO', 'FATURADO')
  const prazos = [...new Set(itens.map((i) => i.product.prazoEntrega?.trim()).filter(Boolean))]
  const arquivada = etapa === 'arquivada'

  return {
    id: cotacao.id,
    codigo: cotacao.codigo || 'sem código',
    cliente: cotacao.cliente || '',
    vendedor: cotacao.vendedor || '',
    admin: adminDaCotacao(cotacao),
    status: cotacao.status,
    etapa,
    criadaEm: cotacao.createdAt,
    faturadaEm,
    notaFaturamento: cotacao.notaFaturamento ?? '',
    prazoInformado: prazos.join(' / '),
    valorCotado,
    custo,
    lucroDefinido,
    faturado: faturadoEstimado ? valorCotado : faturado,
    faturadoEstimado,
    custoDoFaturado: faturadoEstimado ? custo : custoDoFaturado,
    aFaturar,
    partesFaturadas: partesFaturadas(cotacao).length,
    diasResposta: diasEntre(cotacao.dataSolicitacao ?? cotacao.createdAt, primeiraEm('ENVIADO')),
    diasEntrega: diasEntre(entradaNoPedidoDeCompra(cotacao)?.em, entregueEm),
    diasFaturamento: diasEntre(entregueEm, faturadaEm),
    motivo: arquivada ? cotacao.motivoArquivamento?.motivo || SEM_MOTIVO : undefined,
    motivoDetalhe: arquivada ? cotacao.motivoArquivamento?.detalhe || undefined : undefined,
  }
}

export interface Totais {
  quantidade: number
  valorCotado: number
  custo: number
  lucroDefinido: number
  faturado: number
  custoDoFaturado: number
  aFaturar: number
}

function somar(linhas: LinhaRelatorio[]): Totais {
  const t: Totais = { quantidade: linhas.length, valorCotado: 0, custo: 0, lucroDefinido: 0, faturado: 0, custoDoFaturado: 0, aFaturar: 0 }
  for (const l of linhas) {
    t.valorCotado += l.valorCotado
    t.custo += l.custo
    t.lucroDefinido += l.lucroDefinido
    t.faturado += l.faturado
    t.custoDoFaturado += l.custoDoFaturado
    t.aFaturar += l.aFaturar
  }
  return t
}

/** (venda − custo) ÷ venda, como fração; sem venda, não tem margem. */
export function margem(valor: number, custo: number): number | undefined {
  return valor > 0 ? (valor - custo) / valor : undefined
}

/** Fração em texto ("20,0%"); sem valor, "—". */
export function textoPercentual(fracao: number | undefined): string {
  return fracao === undefined ? '—' : `${formatarNumeroBR(fracao * 100, 1)}%`
}

export function textoDias(dias: number | undefined): string {
  if (dias === undefined) return '—'
  return `${formatarNumeroBR(dias, dias % 1 === 0 ? 0 : 1)} ${dias === 1 ? 'dia' : 'dias'}`
}

export interface PrazoMedio {
  rotulo: string
  detalhe: string
  media: number | undefined
  /** Em quantas cotações deu pra medir. */
  cotacoes: number
}

function prazoMedio(linhas: LinhaRelatorio[], rotulo: string, detalhe: string, dias: (l: LinhaRelatorio) => number | undefined): PrazoMedio {
  const medidos = linhas.map(dias).filter((d): d is number => d !== undefined)
  const media = medidos.length > 0 ? medidos.reduce((s, d) => s + d, 0) / medidos.length : undefined
  return { rotulo, detalhe, media, cotacoes: medidos.length }
}

export interface Relatorio {
  linhas: LinhaRelatorio[]
  totais: Totais
  /** Quantas viraram pedido (tudo menos as não fechadas). */
  fechadas: number
  porEtapa: { etapa: EtapaRelatorio; nome: string; detalhe: string; totais: Totais }[]
  porAdmin: { admin: string; fechadas: number; totais: Totais }[]
  motivos: { motivo: string; quantidade: number; valor: number }[]
  prazos: PrazoMedio[]
  /** Faturadas sem o valor registrado na aba Faturamento. */
  estimadas: number
}

const naoFechada = (l: LinhaRelatorio) => l.etapa === 'aberta' || l.etapa === 'arquivada'

/** Entra a cotação de um dos admins criada no período ou faturada no período — a venda faturada neste
 * mês conta no faturamento deste mês, mesmo com a cotação sendo de antes. */
export function montarRelatorio(todas: LinhaRelatorio[], filtro: { inicio: number; fim: number; admins: string[] }): Relatorio {
  const noPeriodo = (t: number | undefined) => t !== undefined && t >= filtro.inicio && t < filtro.fim
  const posicaoDaEtapa = (l: LinhaRelatorio) => ETAPAS_RELATORIO.findIndex((e) => e.id === l.etapa)
  const linhas = todas
    .filter((l) => filtro.admins.includes(l.admin) && (noPeriodo(l.criadaEm) || noPeriodo(l.faturadaEm)))
    .sort((a, b) => posicaoDaEtapa(a) - posicaoDaEtapa(b) || b.criadaEm - a.criadaEm)

  const porMotivo = new Map<string, { quantidade: number; valor: number }>()
  for (const l of linhas) {
    if (!l.motivo) continue
    const atual = porMotivo.get(l.motivo) ?? { quantidade: 0, valor: 0 }
    porMotivo.set(l.motivo, { quantidade: atual.quantidade + 1, valor: atual.valor + l.valorCotado })
  }

  return {
    linhas,
    totais: somar(linhas),
    fechadas: linhas.filter((l) => !naoFechada(l)).length,
    porEtapa: ETAPAS_RELATORIO.map((e) => ({
      etapa: e.id,
      nome: e.nome,
      detalhe: e.detalhe,
      totais: somar(linhas.filter((l) => l.etapa === e.id)),
    })),
    porAdmin: filtro.admins
      .map((admin) => {
        const dele = linhas.filter((l) => l.admin === admin)
        return { admin, fechadas: dele.filter((l) => !naoFechada(l)).length, totais: somar(dele) }
      })
      .filter((a) => a.totais.quantidade > 0),
    motivos: [...porMotivo.entries()].map(([motivo, m]) => ({ motivo, ...m })).sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor),
    prazos: [
      prazoMedio(linhas, 'Resposta ao cliente', 'Da solicitação até enviar a cotação', (l) => l.diasResposta),
      prazoMedio(linhas, 'Pedido até a entrega', 'Do pedido de compra até a mercadoria chegar', (l) => l.diasEntrega),
      prazoMedio(linhas, 'Entrega até o faturamento', 'Da mercadoria chegar até faturar', (l) => l.diasFaturamento),
    ],
    estimadas: linhas.filter((l) => l.faturadoEstimado).length,
  }
}
