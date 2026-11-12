import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/Basics'
import { SelectField } from '../components/ui/Field'
import { listQuotes, salvarFaturamento, updateQuoteStatus } from '../db/analysesRepo'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { formatCurrency, formatDate } from '../utils'
import { formatarNumeroBR, formatarNumeroCurtoBR, parseNumeroFlexivel } from '../numeros'
import { custoFinal, precoPassado } from '../valoresDoPedido'
import { avisar } from '../dialogs'
import { estaACaminho } from '../avisosEntrega'
import {
  STATUS_FATURADO_PARCIALMENTE,
  entregaDoItem,
  notaEDataDaCotacao,
  notaEDataDoItem,
  partesFaturadas,
  situacaoDoFaturamento,
  type EntregaDoItem,
} from '../faturamentoParcial'
import { perguntarAntesDoStatus } from '../mudancaDeStatus'
import { OpcoesDeStatus } from '../components/OpcoesDeStatus'
import { nomeDoStatus, statusDe } from '../statusConfig'
import type { ItemFaturado, QuoteItem, QuoteRecord, QuoteStatus } from '../types'

// -----------------------------------------------------------------------
// Faturamento — onde as cotações são tratadas depois de "Parcialmente
// entregue": registra por quanto cada item foi faturado pro cliente e compara
// com o preço de venda que foi passado na cotação, antes do pedido. O
// faturado fica num campo próprio da cotação (itensFaturados), separado dos
// itens — um não sobrescreve o outro, senão a comparação some. O pedido pode
// ser faturado em partes, conforme os itens chegam (faturamentoParcial.ts):
// cada item guarda a nota e a data dele, e o que falta segue no transporte.
// -----------------------------------------------------------------------

/** De PARCIALMENTE ENTREGUE em diante no fluxo (inclusive os criados depois dele): o que já tem o que faturar. */
function statusDoFaturamento(): string[] {
  const lista = statusDe('cotacoes')
  return lista.slice(lista.indexOf('PARCIALMENTE ENTREGUE'))
}

/** O que está sendo digitado num item (texto, pra aceitar "1.234,56" sem brigar com o campo). */
interface FaturadoEmEdicao {
  qtd: string
  valorUnt: string
  /** Nota e data ("AAAA-MM-DD") da parte em que o item foi faturado — vazias, vão as deste faturamento. */
  nota: string
  data: string
}

const VAZIO: FaturadoEmEdicao = { qtd: '', valorUnt: '', nota: '', data: '' }

const diaBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '')

/** "Chegou 10/11" / "A caminho · previsão 14/11" / "Sem envio" — se o item já pode ser faturado. */
function SeloEntrega({ entrega }: { entrega: EntregaDoItem }) {
  if (entrega.situacao === 'entregue') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        Chegou{entrega.em ? ` ${formatDate(entrega.em).slice(0, 5)}` : ''}
      </span>
    )
  }
  if (entrega.situacao === 'caminho') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title={entrega.notaFiscal ? `NF de compra ${entrega.notaFiscal}` : undefined}>
        A caminho{entrega.previsao ? ` · prev. ${diaBR(entrega.previsao).slice(0, 5)}` : ''}
      </span>
    )
  }
  return <span className="whitespace-nowrap text-[11px] text-ink-400">Sem envio</span>
}

/** Itens que entraram no pedido de compra (cotação fechada com só alguns itens) — cotações de antes
 * desse controle não têm a lista, aí valem todos. */
function itensDoPedido(cotacao: QuoteRecord): QuoteItem[] {
  const ids = cotacao.pedidoCompra?.itemIds
  if (!ids) return cotacao.items
  const permitidos = new Set(ids)
  return cotacao.items.filter((item) => permitidos.has(item.id))
}

function percentual(valor: number, base: number): string {
  return base > 0 ? `${formatarNumeroBR((valor / base) * 100, 1)}%` : '—'
}

/** Diferença venda − custo, verde quando sobra e vermelha quando a venda fica abaixo do custo. */
function Margem({ valor, base }: { valor: number; base: number }) {
  return (
    <span className={valor >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
      {formatCurrency(valor)} <span className="text-[11px]">({percentual(valor, base)})</span>
    </span>
  )
}

function paraEdicao(cotacao: QuoteRecord, f: ItemFaturado | undefined): FaturadoEmEdicao {
  if (!f) return VAZIO
  const { nota, data } = notaEDataDoItem(cotacao, f)
  return { qtd: formatarNumeroCurtoBR(f.qtd, 3), valorUnt: formatarNumeroBR(f.valorUnt, 2), nota, data }
}

/** Lê o que foi digitado — undefined quando o item ainda não foi faturado (nada preenchido). */
function lerFaturado(e: FaturadoEmEdicao | undefined): { qtd: number; valorUnt: number } | undefined {
  if (!e) return undefined
  const qtd = parseNumeroFlexivel(e.qtd) ?? 0
  const valorUnt = parseNumeroFlexivel(e.valorUnt) ?? 0
  if (qtd <= 0 && valorUnt <= 0) return undefined
  return { qtd, valorUnt }
}

interface ResumoFaturamento {
  totalPassado: number
  totalFaturado: number
  /** (unitário faturado − unitário passado) × qtd faturada, somado nos itens faturados. */
  diferenca: number
  /** Valor passado só dos itens já faturados (na quantidade faturada) — base do % da diferença. */
  passadoDosFaturados: number
  itensFaturados: number
  itens: number
}

function resumir(itens: QuoteItem[], faturadoDe: (item: QuoteItem) => { qtd: number; valorUnt: number } | undefined): ResumoFaturamento {
  const r: ResumoFaturamento = { totalPassado: 0, totalFaturado: 0, diferenca: 0, passadoDosFaturados: 0, itensFaturados: 0, itens: itens.length }
  for (const item of itens) {
    const passado = precoPassado(item)
    r.totalPassado += passado * (item.product.qtd || 0)
    const f = faturadoDe(item)
    if (!f) continue
    r.itensFaturados++
    r.totalFaturado += f.qtd * f.valorUnt
    r.passadoDosFaturados += passado * f.qtd
    r.diferenca += (f.valorUnt - passado) * f.qtd
  }
  return r
}

function TextoDiferenca({ valor, base }: { valor: number; base: number }) {
  if (Math.abs(valor) < 0.005) return <span className="text-ink-400">igual ao passado</span>
  const pct = base > 0 ? (valor / base) * 100 : undefined
  return (
    <span className={valor > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
      {valor > 0 ? '▲ +' : '▼ '}
      {formatCurrency(valor)}
      {pct !== undefined && ` (${pct > 0 ? '+' : ''}${formatarNumeroBR(pct, 1)}%)`}
      <span className="ml-1 text-[11px] font-normal">{valor > 0 ? 'acima' : 'abaixo'}</span>
    </span>
  )
}

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-3">
      <p className="text-xs text-ink-400 mb-1">{titulo}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-ink-900">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs font-medium">{detalhe}</p>}
    </div>
  )
}

export function FaturamentoPage({ currentAdmin }: { currentAdmin: string }) {
  const [quotes, setQuotes] = useState<QuoteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [cotacaoId, setCotacaoId] = useState('')
  const [edicao, setEdicao] = useState<Record<string, FaturadoEmEdicao>>({})
  // a nota e a data deste faturamento: vão pros itens faturados agora (os sem nota/data própria)
  const [notaFaturamento, setNotaFaturamento] = useState('')
  const [dataFaturamento, setDataFaturamento] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [alterado, setAlterado] = useState(false)

  function refresh() {
    return listQuotes()
      .then(setQuotes)
      .catch((err) => void avisar(err instanceof Error ? err.message : 'Erro ao carregar dados do servidor.'))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  // cotações de "Parcialmente entregue" em diante aparecem sozinhas aqui — é a partir daí que começa
  // a ter o que faturar
  const cotacoesParaFaturar = useMemo(
    () =>
      quotes
        // arquivada sem nunca ter virado pedido (não fechou) não tem o que faturar — continua na busca abaixo
        .filter((q) => statusDoFaturamento().includes(q.status) && !(q.status === 'ARQUIVO' && !q.pedidoCompra))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [quotes],
  )

  const cotacao = useMemo(() => quotes.find((q) => q.id === cotacaoId), [quotes, cotacaoId])
  const itens = useMemo(() => (cotacao ? itensDoPedido(cotacao) : []), [cotacao])

  // ao abrir uma cotação, o que já estava salvo dela volta pros campos
  useEffect(() => {
    if (!cotacao) {
      setEdicao({})
      setNotaFaturamento('')
      setDataFaturamento('')
      return
    }
    const inicial: Record<string, FaturadoEmEdicao> = {}
    for (const item of itensDoPedido(cotacao)) inicial[item.id] = paraEdicao(cotacao, cotacao.itensFaturados?.[item.id])
    setEdicao(inicial)
    // cada parte faturada já guarda a dela: os campos de cima começam vazios, pra próxima parte
    setNotaFaturamento('')
    setDataFaturamento('')
    setSalvo(false)
    setAlterado(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotacao?.id, cotacao?.updatedAt])

  function patchEdicao(itemId: string, patch: Partial<FaturadoEmEdicao>) {
    setEdicao((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? VAZIO), ...patch } }))
    setAlterado(true)
  }

  /** Item faturado pelo mesmo preço/quantidade que foi passado — o caso mais comum, num clique. */
  function faturarPeloPassado(item: QuoteItem) {
    patchEdicao(item.id, {
      qtd: formatarNumeroCurtoBR(item.product.qtd || 0, 3),
      valorUnt: formatarNumeroBR(precoPassado(item), 2),
    })
  }

  /** Os que faltam (ou só os que já chegaram) pelo valor passado. */
  function faturarPeloPassadoOsQueFaltam(soOsQueChegaram: boolean) {
    for (const item of itens) {
      if (lerFaturado(edicao[item.id])) continue
      if (soOsQueChegaram && cotacao && entregaDoItem(cotacao, item).situacao !== 'entregue') continue
      faturarPeloPassado(item)
    }
  }

  const resumo = useMemo(() => resumir(itens, (item) => lerFaturado(edicao[item.id])), [itens, edicao])

  async function handleSalvar(): Promise<boolean> {
    if (!cotacao) return false
    setSalvando(true)
    try {
      const agora = Date.now()
      // mescla com o que já estava salvo — a tela só mostra os itens do pedido; os de fora dele não
      // podem perder o que tinham
      const itensFaturados: Record<string, ItemFaturado> = { ...(cotacao.itensFaturados ?? {}) }
      for (const item of itens) {
        const emEdicao = edicao[item.id]
        const lido = lerFaturado(emEdicao)
        const anterior = cotacao.itensFaturados?.[item.id]
        if (!lido) {
          delete itensFaturados[item.id]
          continue
        }
        // sem nota/data própria, o item vai com as deste faturamento (os campos de cima)
        const notaFiscal = emEdicao?.nota.trim() || notaFaturamento.trim()
        const data = emEdicao?.data || dataFaturamento
        const antes = anterior ? notaEDataDoItem(cotacao, anterior) : undefined
        const mudou = !anterior || anterior.qtd !== lido.qtd || Math.abs(anterior.valorUnt - lido.valorUnt) > 0.0001
        itensFaturados[item.id] = mudou
          ? { ...lido, registradoEm: agora, registradoPor: currentAdmin, notaFiscal, data }
          : { ...anterior, notaFiscal, data }
        if (!mudou && antes && (antes.nota !== notaFiscal || antes.data !== data)) itensFaturados[item.id] = { ...itensFaturados[item.id], registradoEm: agora, registradoPor: currentAdmin }
      }
      // na cotação ficam as notas de todas as partes e a data da última
      const daCotacao = notaEDataDaCotacao(itensFaturados)
      const atualizado = await salvarFaturamento(cotacao.id, { itensFaturados, notaFaturamento: daCotacao.nota, dataFaturamento: daCotacao.data })
      setQuotes((prev) => prev.map((q) => (q.id === atualizado.id ? atualizado : q)))
      setSalvo(true)
      setAlterado(false)
      setTimeout(() => setSalvo(false), 2500)
      return true
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
      return false
    } finally {
      setSalvando(false)
    }
  }

  /** Muda o status salvando antes o que foi preenchido (senão, ao recarregar a cotação, se perderia). */
  async function salvarEMudarStatus(novoStatus: QuoteStatus) {
    if (alterado && !(await handleSalvar())) return
    await handleStatusChange(novoStatus)
  }

  async function handleStatusChange(novoStatus: QuoteStatus) {
    if (!cotacao || novoStatus === cotacao.status) return
    // arquivar pede o motivo; confirmar o pedido, a produção — cancelando, o status não muda
    const respostas = await perguntarAntesDoStatus(cotacao, novoStatus)
    if (!respostas) return
    try {
      await updateQuoteStatus(cotacao.id, novoStatus, currentAdmin, undefined, respostas.arquivamento, respostas.producao, {
        atualizarValoresDoVendedor: respostas.atualizarValoresDoVendedor,
      })
      await refresh()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar o status.')
    }
  }

  const statusOptions = statusDoFaturamento()
  const cotacaoOptions = [
    { value: '', label: '— buscar outra cotação —' },
    ...quotes.map((q) => ({ value: q.id, label: `${q.codigo || 'sem código'} — ${q.cliente || 'sem cliente'} (${nomeDoStatus(q.status)})` })),
  ]
  const corStatus = cotacao ? corPadraoDoStatus(cotacao.status) : '#999'
  const tudoFaturado = resumo.itens > 0 && resumo.itensFaturados === resumo.itens
  // faturado em parte (o salvo) com o resto ainda a caminho: sugere FATURADO PARCIALMENTE
  const sugereParcial =
    !!cotacao &&
    resumo.itensFaturados > 0 &&
    !tudoFaturado &&
    estaACaminho(cotacao.status) &&
    cotacao.status !== STATUS_FATURADO_PARCIALMENTE &&
    statusDe('cotacoes').includes(STATUS_FATURADO_PARCIALMENTE)
  const partes = cotacao ? partesFaturadas(cotacao) : []
  const chegaramSemFaturar = cotacao ? itens.filter((item) => !lerFaturado(edicao[item.id]) && entregaDoItem(cotacao, item).situacao === 'entregue').length : 0

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Faturamento</h2>
        <p className="text-sm text-ink-400">
          Cotações a partir de <strong className="font-medium text-ink-600">Parcialmente entregue</strong>: registre por
          quanto cada item foi faturado e compare com o preço de venda que foi passado na cotação, antes do pedido. Dá pra
          faturar em partes: o que já chegou vai com a nota e a data dele, e o que falta segue no transporte
          (<strong className="font-medium text-ink-600">{nomeDoStatus(STATUS_FATURADO_PARCIALMENTE)}</strong>).
        </p>
      </div>

      <div className="card">
        <h3 className="font-display text-base font-semibold text-ink-900 mb-3">Cotações para faturar</h3>
        {loading ? (
          <p className="text-sm text-ink-400 py-4 text-center">Carregando…</p>
        ) : cotacoesParaFaturar.length === 0 ? (
          <p className="text-sm text-ink-400 py-4 text-center">
            Nenhuma cotação em Parcialmente entregue (ou depois) no momento.
          </p>
        ) : (
          <div className="space-y-1.5">
            {cotacoesParaFaturar.map((q) => {
              const r = resumir(itensDoPedido(q), (item) => q.itensFaturados?.[item.id])
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCotacaoId(q.id)}
                  className={`w-full flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    cotacaoId === q.id ? 'border-ink-400 bg-ink-100' : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-ink-800 truncate">
                      {q.codigo || 'sem código'} — {q.cliente || 'sem cliente'}
                    </span>
                    <span
                      className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: corPadraoDoStatus(q.status), color: corTexto(corPadraoDoStatus(q.status)) }}
                    >
                      {nomeDoStatus(q.status)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">
                    {r.itensFaturados === 0
                      ? 'nada faturado ainda'
                      : `${r.itensFaturados} de ${r.itens} ite${r.itens === 1 ? 'm' : 'ns'} faturado${r.itensFaturados === 1 ? '' : 's'} · ${formatCurrency(r.totalFaturado)}`}
                    {situacaoDoFaturamento(q) === 'parcial' && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">em parte</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-ink-100">
          <SelectField label="Ou busque qualquer cotação" value={cotacaoId} onChange={setCotacaoId} options={cotacaoOptions} />
        </div>
      </div>

      {cotacao && (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-display text-base font-semibold text-ink-900">
                {cotacao.codigo || 'sem código'} — {cotacao.cliente || 'sem cliente'}
              </p>
              <p className="text-sm text-ink-400">
                {cotacao.maquina} · {cotacao.vendedor || 'sem vendedor'}
              </p>
            </div>
            <label className="flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ backgroundColor: corStatus, color: corTexto(corStatus) }}
              >
                {nomeDoStatus(cotacao.status)}
              </span>
              <select
                value={cotacao.status}
                onChange={(e) => handleStatusChange(e.target.value as QuoteStatus)}
                className="field-input text-xs py-1.5 w-auto"
                aria-label="Status da cotação"
              >
                <OpcoesDeStatus tipo="cotacoes" atual={cotacao.status} lista={statusOptions} />
              </select>
            </label>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="font-display text-base font-semibold text-ink-900">Resumo do faturamento</h3>
              <div className="flex items-center gap-3">
                {salvo && <span className="text-xs font-medium text-emerald-600">✓ Faturamento salvo!</span>}
                {alterado && !salvo && <span className="text-xs text-amber-700">alterações não salvas</span>}
                <Button variant="primary" onClick={handleSalvar} disabled={salvando}>
                  Salvar faturamento
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Indicador titulo="Valor passado (pedido)" valor={formatCurrency(resumo.totalPassado)} />
              <Indicador
                titulo="Faturado até agora"
                valor={formatCurrency(resumo.totalFaturado)}
                detalhe={
                  <span className="text-ink-500">
                    {resumo.itensFaturados} de {resumo.itens} ite{resumo.itens === 1 ? 'm' : 'ns'}
                  </span>
                }
              />
              <Indicador
                titulo="Faturado × passado (itens faturados)"
                valor={formatCurrency(resumo.passadoDosFaturados)}
                detalhe={
                  resumo.itensFaturados > 0 ? (
                    <TextoDiferenca valor={resumo.diferenca} base={resumo.passadoDosFaturados} />
                  ) : (
                    <span className="text-ink-400">nenhum item faturado</span>
                  )
                }
              />
              <Indicador
                titulo="Falta faturar (pelo valor passado)"
                valor={formatCurrency(
                  itens.reduce((s, item) => (lerFaturado(edicao[item.id]) ? s : s + precoPassado(item) * (item.product.qtd || 0)), 0),
                )}
                detalhe={
                  tudoFaturado ? <span className="text-emerald-700 dark:text-emerald-300">todos os itens faturados</span> : undefined
                }
              />
            </div>
            {tudoFaturado && cotacao.status !== 'FATURADO' && cotacao.status !== 'ARQUIVO' && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm">
                <span className="text-ink-600">Todos os itens já têm valor faturado.</span>
                <button
                  type="button"
                  onClick={() => void salvarEMudarStatus('FATURADO')}
                  className="pill-tab border border-ink-300 py-1 text-ink-800 hover:bg-surface"
                >
                  Mudar status pra {nomeDoStatus('FATURADO')}
                </button>
              </div>
            )}
            {sugereParcial && (
              <div role="note" aria-label="Faturado em parte" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <span className="text-amber-900">
                  Parte dos itens faturada e o resto ainda a caminho: os que faltam continuam no transporte (avisos de entrega e
                  Pedido de Compra) até chegarem.
                </span>
                <button
                  type="button"
                  onClick={() => void salvarEMudarStatus(STATUS_FATURADO_PARCIALMENTE)}
                  className="pill-tab border border-amber-300 py-1 text-amber-900 hover:bg-surface"
                >
                  Mudar status pra {nomeDoStatus(STATUS_FATURADO_PARCIALMENTE)}
                </button>
              </div>
            )}
            {partes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-ink-500">{partes.length === 1 ? 'Faturamento registrado' : `Faturado em ${partes.length} partes`}</p>
                <ul aria-label="Partes faturadas" className="flex flex-wrap gap-1.5">
                  {partes.map((p) => (
                    <li key={`${p.data}|${p.nota}`} className="rounded-lg border border-ink-100 bg-ink-50/60 px-2.5 py-1 text-xs text-ink-700">
                      <strong className="font-semibold">{p.nota ? `NF ${p.nota}` : 'Sem nota'}</strong>
                      {' · '}
                      {p.data ? diaBR(p.data) : 'sem data'} · {p.itens} ite{p.itens === 1 ? 'm' : 'ns'} ·{' '}
                      <span className="font-mono tabular-nums">{formatCurrency(p.valor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <ComparativoCustoVenda cotacao={cotacao} itens={itens} faturadoDe={(item) => lerFaturado(edicao[item.id])} />

          <div className="card">
            <fieldset className="mb-4 rounded-xl border border-ink-100 bg-ink-50/40 p-3">
              <legend className="px-1 text-sm font-medium text-ink-700">Nota e data deste faturamento</legend>
              <p className="mb-2 text-xs text-ink-400">
                Vão para os itens faturados agora (os que estiverem sem nota ou data na tabela). Faturando em partes, cada parte
                fica com a sua — as já faturadas continuam com a delas.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="field-label">Nº da nota fiscal de venda</span>
                  <input
                    type="text"
                    className="field-input"
                    placeholder="ex.: 12345"
                    value={notaFaturamento}
                    onChange={(e) => {
                      setNotaFaturamento(e.target.value)
                      setAlterado(true)
                    }}
                  />
                </label>
                <label className="block">
                  <span className="field-label">Data do faturamento</span>
                  <input
                    type="date"
                    className="field-input"
                    value={dataFaturamento}
                    onChange={(e) => {
                      setDataFaturamento(e.target.value)
                      setAlterado(true)
                    }}
                  />
                </label>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-sm text-ink-500">
                Preencha a quantidade e o valor unitário faturados — item sem nada preenchido conta como ainda não
                faturado.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => faturarPeloPassadoOsQueFaltam(true)}
                  disabled={chegaramSemFaturar === 0}
                  className="pill-tab border border-emerald-300 py-1.5 text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
                  title="Preenche só os itens que já chegaram (e ainda sem faturamento) com a quantidade e o preço de venda passados"
                >
                  Faturar os que já chegaram ({chegaramSemFaturar})
                </button>
                <button
                  type="button"
                  onClick={() => faturarPeloPassadoOsQueFaltam(false)}
                  disabled={tudoFaturado}
                  className="pill-tab border border-ink-200 py-1.5 text-ink-700 hover:bg-ink-50 disabled:opacity-40"
                  title="Preenche os itens ainda sem faturamento com a quantidade e o preço de venda passados na cotação"
                >
                  Faturar os que faltam pelo valor passado
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ink-100">
              <table className="w-full min-w-[74rem] text-sm border-collapse">
                <thead>
                  <tr className="bg-ink-50 text-left text-ink-400">
                    <th className="py-2 px-2 font-medium">Produto</th>
                    <th className="py-2 px-2 font-medium w-32">Entrega</th>
                    <th className="py-2 px-2 font-medium w-20 text-right">Qtd cotada</th>
                    <th className="py-2 px-2 font-medium w-28 text-right">Preço passado (unt.)</th>
                    <th className="py-2 px-2 font-medium w-28 text-right">Total passado</th>
                    <th className="py-2 px-2 font-medium w-24 text-right">Qtd faturada</th>
                    <th className="py-2 px-2 font-medium w-32 text-right">Valor faturado (unt.)</th>
                    <th className="py-2 px-2 font-medium w-28 text-right">Total faturado</th>
                    <th className="py-2 px-2 font-medium w-28">NF de venda</th>
                    <th className="py-2 px-2 font-medium w-36">Data</th>
                    <th className="py-2 px-2 font-medium w-44 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-6 text-center text-ink-400 border-t border-ink-100">
                        Essa cotação não tem itens no pedido.
                      </td>
                    </tr>
                  )}
                  {itens.map((item) => {
                    const passado = precoPassado(item)
                    const emEdicao = edicao[item.id] ?? VAZIO
                    const f = lerFaturado(emEdicao)
                    const p = item.product
                    const nome = p.descricao || p.referencia || 'item'
                    const emParte = !!f && f.qtd + 1e-9 < (p.qtd || 0)
                    return (
                      <tr key={item.id} className="border-t border-ink-100">
                        <td className="py-1.5 px-2 text-ink-800">
                          <span className="block truncate max-w-[22rem]" title={p.descricao}>
                            {p.descricao || p.referencia || 'Item sem descrição'}
                          </span>
                          <span className="block text-[11px] text-ink-400">
                            {[p.interno, p.referencia, p.fornecedor].filter((x) => x.trim()).join(' · ')}
                          </span>
                        </td>
                        <td className="py-1.5 px-2" aria-label={`Entrega de ${nome}`}>
                          <SeloEntrega entrega={entregaDoItem(cotacao, item)} />
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-500">{p.qtd}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-600">{formatCurrency(passado)}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-500">
                          {formatCurrency(passado * (p.qtd || 0))}
                        </td>
                        <td className="py-1.5 px-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="field-input text-right tabular-nums py-1"
                            placeholder="—"
                            value={emEdicao.qtd}
                            onChange={(e) => patchEdicao(item.id, { qtd: e.target.value })}
                            aria-label={`Quantidade faturada de ${p.descricao || p.referencia || 'item'}`}
                          />
                        </td>
                        <td className="py-1.5 px-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="field-input text-right tabular-nums py-1"
                              placeholder="—"
                              value={emEdicao.valorUnt}
                              onChange={(e) => patchEdicao(item.id, { valorUnt: e.target.value })}
                              onBlur={() => {
                                const n = parseNumeroFlexivel(emEdicao.valorUnt)
                                if (n !== undefined) patchEdicao(item.id, { valorUnt: formatarNumeroBR(n, 2) })
                              }}
                              aria-label={`Valor unitário faturado de ${p.descricao || p.referencia || 'item'}`}
                            />
                            {!f && (
                              <button
                                type="button"
                                onClick={() => faturarPeloPassado(item)}
                                title="Faturado pela quantidade e preço passados"
                                className="shrink-0 rounded-md border border-ink-200 px-1.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50"
                              >
                                = passado
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-800">
                          {f ? formatCurrency(f.qtd * f.valorUnt) : <span className="text-ink-300">—</span>}
                          {emParte && <span className="block text-[10px] font-sans font-medium text-amber-700">em parte · faltam {formatarNumeroCurtoBR((p.qtd || 0) - f.qtd, 3)}</span>}
                        </td>
                        <td className="py-1.5 px-1">
                          {f && (
                            <input
                              type="text"
                              className="field-input py-1 text-xs"
                              placeholder={notaFaturamento.trim() || '—'}
                              value={emEdicao.nota}
                              onChange={(e) => patchEdicao(item.id, { nota: e.target.value })}
                              aria-label={`Nota fiscal de venda de ${nome}`}
                              title="Vazio: vai com a nota deste faturamento"
                            />
                          )}
                        </td>
                        <td className="py-1.5 px-1">
                          {f && (
                            <>
                              <input
                                type="date"
                                className="field-input py-1 text-xs"
                                value={emEdicao.data}
                                onChange={(e) => patchEdicao(item.id, { data: e.target.value })}
                                aria-label={`Data do faturamento de ${nome}`}
                              />
                              {!emEdicao.data && dataFaturamento && <span className="block px-1 text-[10px] text-ink-400">vai com {diaBR(dataFaturamento)}</span>}
                            </>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs tabular-nums">
                          {f ? (
                            <TextoDiferenca valor={(f.valorUnt - passado) * f.qtd} base={passado * f.qtd} />
                          ) : (
                            <span className="text-ink-300">não faturado</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Comparativo por item: o valor final da peça (custo, com o que fechou no Pedido de Compra), o preço de
 * venda passado na cotação e o valor da venda concretizada (faturado) — e quanto sobrou entre venda e
 * custo, no previsto (cotação) e no real (faturado). */
function ComparativoCustoVenda({
  cotacao,
  itens,
  faturadoDe,
}: {
  cotacao: QuoteRecord
  itens: QuoteItem[]
  faturadoDe: (item: QuoteItem) => { qtd: number; valorUnt: number } | undefined
}) {
  const linhas = itens.map((item) => {
    const custo = custoFinal(cotacao, item)
    const passado = precoPassado(item)
    const f = faturadoDe(item)
    return { item, custo, passado, f }
  })
  const qtdCotada = (item: QuoteItem) => item.product.qtd || 0
  const custoTotal = linhas.reduce((s, l) => s + l.custo * qtdCotada(l.item), 0)
  const vendaTotal = linhas.reduce((s, l) => s + l.passado * qtdCotada(l.item), 0)
  const faturados = linhas.filter((l) => l.f)
  const faturadoTotal = faturados.reduce((s, l) => s + l.f!.qtd * l.f!.valorUnt, 0)
  const custoDosFaturados = faturados.reduce((s, l) => s + l.custo * l.f!.qtd, 0)

  return (
    <div className="card" aria-label="Custo × venda">
      <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Custo × venda</h3>
      <p className="text-sm text-ink-400 mb-3">
        Valor final da peça (custo com o que fechou no Pedido de Compra, impostos e frete inclusos) comparado com o preço
        de venda passado na cotação e com a venda concretizada (faturado).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Indicador titulo="Valor final das peças (custo)" valor={formatCurrency(custoTotal)} />
        <Indicador titulo="Venda passada na cotação" valor={formatCurrency(vendaTotal)} detalhe={<Margem valor={vendaTotal - custoTotal} base={vendaTotal} />} />
        <Indicador
          titulo="Venda concretizada (faturado)"
          valor={formatCurrency(faturadoTotal)}
          detalhe={
            faturados.length > 0 ? (
              <Margem valor={faturadoTotal - custoDosFaturados} base={faturadoTotal} />
            ) : (
              <span className="text-ink-400">nenhum item faturado</span>
            )
          }
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-ink-100">
        <table className="w-full min-w-[48rem] text-sm border-collapse">
          <thead>
            <tr className="bg-ink-50 text-left text-ink-400">
              <th className="py-2 px-2 font-medium">Produto</th>
              <th className="py-2 px-2 font-medium w-28 text-right">Valor final (custo unt.)</th>
              <th className="py-2 px-2 font-medium w-28 text-right">Venda passada (unt.)</th>
              <th className="py-2 px-2 font-medium w-40 text-right">Venda − custo (cotação)</th>
              <th className="py-2 px-2 font-medium w-28 text-right">Venda concretizada (unt.)</th>
              <th className="py-2 px-2 font-medium w-40 text-right">Venda − custo (concretizada)</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ item, custo, passado, f }) => (
              <tr key={item.id} className="border-t border-ink-100">
                <td className="py-1.5 px-2 text-ink-800">
                  <span className="block truncate max-w-[20rem]" title={item.product.descricao}>
                    {item.product.descricao || item.product.referencia || 'Item sem descrição'}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-700">{formatCurrency(custo)}</td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-700">{formatCurrency(passado)}</td>
                <td className="py-1.5 px-2 text-right font-mono text-xs tabular-nums">
                  <Margem valor={passado - custo} base={passado} />
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-800">
                  {f ? formatCurrency(f.valorUnt) : <span className="whitespace-nowrap text-ink-300">não faturado</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-xs tabular-nums">
                  {f ? <Margem valor={f.valorUnt - custo} base={f.valorUnt} /> : <span className="text-ink-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
