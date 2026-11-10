import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEstadoPersistente } from '../estadoPersistente'
import { Button } from '../components/ui/Basics'
import { SelectField } from '../components/ui/Field'
import { PedidoCompraModal } from '../components/PedidoCompraModal'
import { PedidoCompraFornecedorModal, type BasePedidoCompraFornecedor } from '../components/PedidoCompraFornecedorModal'
import {
  CartaoTransporte,
  ResumoTransporteDaCotacao,
  SeloPrevisao,
  SelosPrevisao,
  TRANSPORTE_VAZIO,
  TransporteModal,
  normalizarLinkRastreio,
  previsaoDaCotacao,
  type DadosTransporteEditaveis,
} from '../components/TransporteFornecedor'
import {
  chaveFornecedorFrete,
  freteDoFornecedor,
  listQuotes,
  registrarEntrega,
  salvarItensFechados,
  salvarProducao,
  salvarTransporte,
  updateQuoteStatus,
  type RemetenteFrete,
} from '../db/analysesRepo'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { formatCurrency } from '../utils'
import { calculateItem } from '../calc/calculator'
import { formatarNumeroBR, parseNumeroFlexivel } from '../numeros'
import { avisar, confirmar } from '../dialogs'
import { itensDoPedidoDeCompra, perguntarAntesDoStatus, perguntarProducao } from '../mudancaDeStatus'
import { DetalheProducao, SeloProducao } from '../components/SeloProducao'
import { AndamentoDoPedido } from '../components/AndamentoDoPedido'
import { entradaNoPedidoDeCompra } from '../historicoStatus'
import { estaACaminho } from '../avisosEntrega'
import { fornecedoresDoPedido, previsoesDeEntrega, previsoesDeProducao } from '../fornecedoresDoPedido'
import { OpcoesDeStatus } from '../components/OpcoesDeStatus'
import { nomeDoStatus, ordemComExtras, statusDe } from '../statusConfig'
import type { DadosFreteTransportadora, DadosTransporte, ItemFechado, PedidoCompraInfo, QuoteItem, QuoteRecord, QuoteStatus } from '../types'

// a partir de EM TRANSPORTE (no fluxo dos status), cada fornecedor mostra o cartão Transporte
function aPartirDoTransporte(status: QuoteStatus): boolean {
  const lista = statusDe('cotacoes')
  return lista.indexOf(status) >= lista.indexOf('EM TRANSPORTE')
}
// enquanto a mercadoria está a caminho (estaACaminho) dá pra marcar a entrega (que leva a PARCIALMENTE ENTREGUE / ENTREGUE);
// desfazer uma entrega marcada por engano: só até ENTREGUE (de CONFERIDO em diante, já foi conferida)
function naFaseDaEntrega(status: QuoteStatus): boolean {
  return estaACaminho(status) || status === 'ENTREGUE'
}
// "Pedidos em transporte": de EM TRANSPORTE em diante (as já entregues só quando pedidas)
function depoisDoTransporte(status: QuoteStatus): boolean {
  return status !== 'ARQUIVO' && aPartirDoTransporte(status)
}

/** Frete digitado em R$ (por unidade, ou o total do fornecedor) ou em % do valor dos produtos —
 * guardado do mesmo jeito (freteRate, fração do valor) nos dois casos. Preferência deste aparelho. */
type ModoFrete = 'valor' | 'percentual'
const CHAVE_MODO_FRETE = 'pedidoCompra.modoFrete'

function lerModoFrete(): ModoFrete {
  try {
    return localStorage.getItem(CHAVE_MODO_FRETE) === 'percentual' ? 'percentual' : 'valor'
  } catch {
    return 'valor'
  }
}

/** "5,25%" — fração (0.0525) em porcentagem com vírgula. */
function percentual(taxa: number): string {
  return `${formatarNumeroBR((taxa || 0) * 100, 2)}%`
}

/** A cotação de frete mais barata desse fornecedor/UF (aba Frete / Itens da cotação): transportadora e dados. */
function freteMaisBarato(cotacao: QuoteRecord, remetente: RemetenteFrete): [string, DadosFreteTransportadora] | undefined {
  let melhor: [string, DadosFreteTransportadora] | undefined
  let menor = Number.POSITIVE_INFINITY
  for (const [transportadora, frete] of Object.entries(freteDoFornecedor(cotacao, remetente))) {
    const valor = parseNumeroFlexivel(frete.valorCotacao)
    if (valor !== undefined && valor > 0 && valor < menor) {
      menor = valor
      melhor = [transportadora, frete]
    }
  }
  return melhor
}

/** Chave dos dados de transporte de um grupo (a do frete; itens sem fornecedor ficam juntos). */
function chaveTransporte(chaveGrupo: string): string {
  return chaveGrupo || 'SEM FORNECEDOR'
}

/** Divide os itens do pedido por fornecedor (+ UF de origem) — um pedido de compra pode ter saído
 * fechado com mais de um fornecedor, e cada um tem seu próprio frete (origem diferente, cotação
 * diferente); o mesmo fornecedor saindo de outro estado também é outro pedido, com outro frete. */
function gruposDoPedido(cotacao: QuoteRecord) {
  return fornecedoresDoPedido(cotacao)
}

/** Campos de transporte de um fornecedor: o que já foi salvo, ou a transportadora e o nº da cotação
 * do frete mais barato dele (aba Frete) como ponto de partida. */
function transporteInicial(cotacao: QuoteRecord, chaveGrupo: string, remetente: RemetenteFrete): DadosTransporteEditaveis {
  const salvo = cotacao.transportePorFornecedor?.[chaveTransporte(chaveGrupo)]
  if (salvo) {
    const { atualizadoEm: _em, atualizadoPor: _por, ...campos } = salvo
    return { ...TRANSPORTE_VAZIO, ...campos }
  }
  const frete = remetente.nome ? freteMaisBarato(cotacao, remetente) : undefined
  return {
    ...TRANSPORTE_VAZIO,
    transportadora: frete?.[0] ?? '',
    numeroCotacaoFrete: frete?.[1].numeroCotacao?.trim() || cotacao.numeroCotacaoTransportadora || '',
  }
}

/** "Aplicar a todos os itens" do fornecedor: o frete total dele em R$ (dividido pelo valor dos
 * produtos) ou uma % do valor — os dois viram a mesma taxa em todos os itens do grupo. */
function AplicarFreteGrupo({
  modo,
  valorProdutos,
  onAplicar,
}: {
  modo: ModoFrete
  valorProdutos: number
  onAplicar: (taxa: number) => void
}) {
  const [texto, setTexto] = useState('')
  function aplicar() {
    const valor = parseNumeroFlexivel(texto)
    if (valor === undefined || valor < 0) {
      void avisar(modo === 'valor' ? 'Digite o valor total do frete desse fornecedor (ex.: 350,00).' : 'Digite a porcentagem do frete (ex.: 5,5).')
      return
    }
    if (modo === 'valor' && valorProdutos <= 0) {
      void avisar('Os itens desse fornecedor ainda estão sem valor — preencha o valor fechado antes de aplicar um frete em R$.')
      return
    }
    onAplicar(modo === 'valor' ? valor / valorProdutos : valor / 100)
    setTexto('')
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-600">Frete desse fornecedor, pra todos os itens:</span>
      <input
        className="field-input w-36 py-1 text-right tabular-nums"
        inputMode="decimal"
        aria-label={modo === 'valor' ? 'Frete total do fornecedor em reais' : 'Frete do fornecedor em porcentagem'}
        placeholder={modo === 'valor' ? 'R$ total' : '% do valor'}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && aplicar()}
      />
      <span className="text-xs text-ink-400">{modo === 'valor' ? 'R$ (total do fornecedor)' : '% do valor dos produtos'}</span>
      <Button variant="secondary" onClick={aplicar} disabled={!texto.trim()}>
        Aplicar
      </Button>
    </div>
  )
}

function estatisticasGrupo(items: QuoteItem[], fechados: Record<string, ItemFechado>) {
  let qtdNegociada = 0
  let valorNegociado = 0
  let freteNegociado = 0
  let qtdFechada = 0
  let valorFechado = 0
  let freteFechado = 0
  for (const item of items) {
    const totalNegociado = (item.product.qtd || 0) * (item.product.valorUnt || 0)
    qtdNegociada += item.product.qtd || 0
    valorNegociado += totalNegociado
    freteNegociado += totalNegociado * (item.product.freteRate || 0)

    const f = fechados[item.id] ?? { qtd: item.product.qtd, valorUnt: item.product.valorUnt, freteRate: item.product.freteRate }
    const totalFechado = (f.qtd || 0) * (f.valorUnt || 0)
    qtdFechada += f.qtd || 0
    valorFechado += totalFechado
    freteFechado += totalFechado * (f.freteRate || 0)
  }
  return {
    valorNegociado,
    valorFechado,
    freteNegociado,
    freteFechado,
    freteUnitNegociado: qtdNegociada > 0 ? freteNegociado / qtdNegociada : 0,
    freteUnitFechado: qtdFechada > 0 ? freteFechado / qtdFechada : 0,
  }
}

/** Preço de venda unitário passado ao cliente na cotação (a mesma conta da precificação). */
function precoDeVenda(item: QuoteItem): number {
  return calculateItem(item.product, item.pricing).precoVendaUnitario
}

function valorDeVenda(items: QuoteItem[]): number {
  return items.reduce((s, item) => s + precoDeVenda(item) * (item.product.qtd || 0), 0)
}

/** Um status da lista de pedidos — recolhível (lembra aberto/fechado neste aparelho). */
function GrupoDaLista({ status, quantidade, children }: { status: QuoteStatus; quantidade: number; children: ReactNode }) {
  const [aberto, setAberto] = useEstadoPersistente(`pedidoCompra:grupoAberto:${status}`, true)
  const cor = corPadraoDoStatus(status)
  return (
    <div>
      <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className="mb-1.5 flex w-full items-center gap-2 text-left">
        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: cor, color: corTexto(cor) }}>
          {nomeDoStatus(status)}
        </span>
        <span className="text-xs text-ink-400">{quantidade}</span>
        <span aria-hidden className={`ml-auto text-ink-400 transition-transform ${aberto ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {aberto && <div className="space-y-1.5">{children}</div>}
    </div>
  )
}

/** Valor de venda (não tem negociado × fechado — é o que foi passado ao cliente). */
function StatVenda({ label, valor, detalhe }: { label: string; valor: number; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <p className="text-xs text-ink-400 mb-1">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-ink-900">{formatCurrency(valor)}</p>
      {detalhe && <p className="text-xs text-ink-500">{detalhe}</p>}
    </div>
  )
}

function MiniStat({ label, negociado, fechado }: { label: string; negociado: number; fechado: number }) {
  const dif = fechado - negociado
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-3">
      <p className="text-xs text-ink-400 mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-ink-500 line-through decoration-ink-300">{formatCurrency(negociado)}</span>
        <span className="font-mono text-base font-semibold text-ink-900">{formatCurrency(fechado)}</span>
      </div>
      {Math.abs(dif) > 0.001 && (
        <p className={`text-xs font-medium ${dif < 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {dif < 0 ? '' : '+'}
          {formatCurrency(dif)}
        </p>
      )}
    </div>
  )
}

/** Compara, item a item e por fornecedor, o que foi negociado na cotação (item.product) com o que
 * realmente saiu no fechamento do pedido — os dois ficam separados de propósito: a negociação
 * inicial (feita na correria) e o fechamento final costumam divergir, e é nessa diferença que dá
 * pra enxergar o que se ganhou em cima do produto. É a MESMA cotação (mesmo registro/id) — só o
 * status é compartilhado entre essa aba e a Cotação; os valores de item ficam cada um no seu canto. */
export function PedidoCompraPage({
  currentAdmin,
  abrirTransporte,
  abrirPedido,
}: {
  currentAdmin: string
  /** Pedido pra já abrir a janela de transporte (clique no aviso de entregas) — `vez` muda a cada clique. */
  abrirTransporte?: { cotacaoId: string; vez: number }
  /** Pedido pra já abrir aberto ("Abrir pedido" na janela de transporte da Tela Inicial). */
  abrirPedido?: { cotacaoId: string; vez: number }
}) {
  const [quotes, setQuotes] = useState<QuoteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [cotacaoId, setCotacaoId] = useState('')
  const [fechados, setFechados] = useState<Record<string, ItemFechado>>({})
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [pedidoModalAberto, setPedidoModalAberto] = useState(false)
  const [transporteModalAberto, setTransporteModalAberto] = useState(false)
  const [pedidoFornecedorAberto, setPedidoFornecedorAberto] = useState<string | undefined>(undefined)
  const [modoFrete, setModoFrete] = useState<ModoFrete>(lerModoFrete)
  // pedidos de fornecedor recolhidos (só o cabeçalho à vista) — vale pra cotação aberta
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())
  useEffect(() => setRecolhidos(new Set()), [cotacaoId])

  function alternarRecolhido(chaveGrupo: string) {
    setRecolhidos((prev) => {
      const proximo = new Set(prev)
      if (proximo.has(chaveGrupo)) proximo.delete(chaveGrupo)
      else proximo.add(chaveGrupo)
      return proximo
    })
  }

  function mudarModoFrete(modo: ModoFrete) {
    setModoFrete(modo)
    try {
      localStorage.setItem(CHAVE_MODO_FRETE, modo)
    } catch {
      // sem localStorage, vale só até recarregar
    }
  }

  function refresh() {
    return listQuotes()
      .then(setQuotes)
      .catch((err) => void avisar(err instanceof Error ? err.message : 'Erro ao carregar dados do servidor.'))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  // cotações a partir de "PEDIDO DE COMPRA" (esse status em diante, no fluxo dos status)
  // aparecem sozinhas aqui, sem precisar procurar — assim que o status muda em Cotações, na
  // próxima vez que essa aba abre a cotação já está na lista, e continua aparecendo enquanto
  // avança pelo resto do fluxo (confirmado, em transporte, entregue etc.)
  const cotacoesEmPedido = useMemo(() => {
    const lista = statusDe('cotacoes')
    const indicePedidoDeCompra = lista.indexOf('PEDIDO DE COMPRA')
    return (
      quotes
        // arquivada sem nunca ter virado pedido (não fechou) não é pedido de compra — continua na busca abaixo
        .filter((q) => lista.indexOf(q.status) >= indicePedidoDeCompra && !(q.status === 'ARQUIVO' && !q.pedidoCompra))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    )
  }, [quotes])

  const cotacao = useMemo(() => quotes.find((q) => q.id === cotacaoId), [quotes, cotacaoId])

  // consulta rápida do que está a caminho: clicar abre a janela com NF, transportadora, rastreio e previsão
  const [mostrarJaEntregues, setMostrarJaEntregues] = useEstadoPersistente('pedidoCompra:transporteMostrarEntregues', false)
  const [resumoTransporteId, setResumoTransporteId] = useState<string | undefined>(undefined)
  const pedidosEmTransporte = useMemo(
    () =>
      quotes
        .filter((q) => (mostrarJaEntregues ? depoisDoTransporte(q.status) : estaACaminho(q.status)))
        .sort((a, b) => {
          // a caminho primeiro, e entre eles a previsão mais próxima (ou atrasada) no topo
          const aCaminho = Number(estaACaminho(b.status)) - Number(estaACaminho(a.status))
          if (aCaminho) return aCaminho
          const pa = previsaoDaCotacao(a)
          const pb = previsaoDaCotacao(b)
          if (pa && pb) return pa.localeCompare(pb)
          if (pa || pb) return pa ? -1 : 1
          return b.updatedAt - a.updatedAt
        }),
    [quotes, mostrarJaEntregues],
  )
  const resumoTransporte = useMemo(() => quotes.find((q) => q.id === resumoTransporteId), [quotes, resumoTransporteId])
  const fecharResumoTransporte = useCallback(() => setResumoTransporteId(undefined), [])
  useEffect(() => {
    if (!abrirTransporte) return
    setResumoTransporteId(abrirTransporte.cotacaoId)
    // as cotações podem ter mudado desde que a aba abriu (a entrega/previsão vista no aviso)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirTransporte?.vez])
  useEffect(() => {
    if (abrirPedido) setCotacaoId(abrirPedido.cotacaoId)
  }, [abrirPedido])

  // só os itens que realmente entraram no pedido de compra (ver PedidoCompraModal) — uma cotação
  // pode ter sido fechada só com "alguns itens", e o resto (que não foi pedido) não deve aparecer
  // aqui nem entrar nos totais. Cotações antigas, de antes desse controle existir, não têm
  // pedidoCompra salvo — nesse caso cai pra todos os itens, como sempre foi.
  const itensDoPedido = useMemo(() => (cotacao ? itensDoPedidoDeCompra(cotacao) : []), [cotacao])

  useEffect(() => {
    if (!cotacao) {
      setFechados({})
      return
    }
    // valor fechado começa igual ao negociado — a maioria dos itens fecha no mesmo valor, só
    // ajusta quem realmente mudou na negociação final, em vez de partir tudo zerado
    const iniciais: Record<string, ItemFechado> = {}
    for (const item of itensDoPedido) {
      iniciais[item.id] = cotacao.itensFechados?.[item.id] ?? {
        qtd: item.product.qtd,
        valorUnt: item.product.valorUnt,
        freteRate: item.product.freteRate,
      }
    }
    setFechados(iniciais)
    setSalvo(false)
  }, [cotacao, itensDoPedido])

  function patchFechado(itemId: string, patch: Partial<ItemFechado>) {
    setFechados((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  function patchFreteUnitFechado(itemId: string, novoFreteUnitario: number) {
    const atual = fechados[itemId]
    const valorUnt = atual?.valorUnt || 0
    patchFechado(itemId, { freteRate: valorUnt > 0 ? novoFreteUnitario / valorUnt : 0 })
  }

  function aplicarTaxaNoGrupo(items: QuoteItem[], taxa: number) {
    setFechados((prev) => {
      const novo = { ...prev }
      for (const item of items) novo[item.id] = { ...prev[item.id], freteRate: taxa }
      return novo
    })
  }

  async function handleSalvar() {
    if (!cotacao) return
    setSalvando(true)
    try {
      // mescla com o que já estava salvo — "fechados" só cobre os itens visíveis aqui (os que
      // entraram no pedido); itens fora do pedido não devem ter o valor fechado deles apagado
      const mesclado = { ...cotacao.itensFechados, ...fechados }
      const atualizado = await salvarItensFechados(cotacao.id, mesclado)
      setQuotes((prev) => prev.map((q) => (q.id === atualizado.id ? atualizado : q)))
      setSalvo(true)
      setTimeout(() => setSalvo(false), 2000)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvando(false)
    }
  }

  async function handleStatusChange(novoStatus: QuoteStatus) {
    if (!cotacao) return
    if (novoStatus === 'PEDIDO DE COMPRA') {
      setPedidoModalAberto(true)
      return
    }
    if (novoStatus === 'EM TRANSPORTE') {
      setTransporteModalAberto(true)
      return
    }
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

  async function handleAlterarProducao() {
    if (!cotacao) return
    const producao = await perguntarProducao(cotacao)
    if (!producao) return
    try {
      const atualizado = await salvarProducao(cotacao.id, producao, currentAdmin)
      setQuotes((prev) => prev.map((q) => (q.id === atualizado.id ? atualizado : q)))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    }
  }

  /** Previsão de finalização digitada direto no cartão Produção — grava na hora, o resto da produção
   * fica igual. Com `chaveFornecedor`, é a previsão do pedido daquele fornecedor. */
  async function handlePrevisaoProducao(data: string, chaveFornecedor?: string) {
    if (!cotacao?.producao) return
    // só data completa e com ano de verdade (ou vazia, pra apagar) — e só se mudou
    if (data && !(/^\d{4}-\d{2}-\d{2}$/.test(data) && Number(data.slice(0, 4)) >= 2000)) return
    const anterior = chaveFornecedor ? cotacao.producao.previsaoPorFornecedor?.[chaveFornecedor] : cotacao.producao.previsaoFinalizacao
    if (data === (anterior ?? '')) return
    const { em: _em, por: _por, ...producao } = cotacao.producao
    const novaProducao = chaveFornecedor
      ? // a data única de antes (de quando a previsão era do pedido todo) sai: agora cada fornecedor tem a sua
        { ...producao, previsaoFinalizacao: '', previsaoPorFornecedor: { ...producao.previsaoPorFornecedor, [chaveFornecedor]: data } }
      : { ...producao, previsaoFinalizacao: data }
    try {
      const atualizado = await salvarProducao(cotacao.id, novaProducao, currentAdmin)
      setQuotes((prev) => prev.map((q) => (q.id === atualizado.id ? atualizado : q)))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    }
  }

  /** Marca (ou desfaz) a entrega da mercadoria dos fornecedores `chaves` — o status acompanha
   * (todos entregues: ENTREGUE; só alguns: PARCIALMENTE ENTREGUE). */
  async function handleEntrega(chaves: string[], entregue: boolean) {
    if (!cotacao || chaves.length === 0) return
    const todas = gruposPorFornecedor.map((g) => chaveTransporte(g.chave))
    const rotulos = gruposPorFornecedor.filter((g) => chaves.includes(chaveTransporte(g.chave))).map((g) => g.rotulo)
    const deQuem = todas.length > 1 ? ` de ${rotulos.join(', ')}` : ''
    let mensagem: string
    if (entregue) {
      const entreguesDepois = todas.filter((c) => chaves.includes(c) || cotacao.transportePorFornecedor?.[c]?.entregueEm).length
      const proximo = entreguesDepois === todas.length ? 'ENTREGUE' : 'PARCIALMENTE ENTREGUE'
      mensagem = `Marcar a mercadoria${deQuem} como entregue?${estaACaminho(cotacao.status) ? `\nA cotação vai para ${nomeDoStatus(proximo)}.` : ''}`
    } else {
      mensagem = `Desfazer a entrega${deQuem}? A mercadoria volta a constar como em transporte.`
    }
    if (!(await confirmar(mensagem, { titulo: entregue ? 'Mercadoria entregue' : 'Desfazer entrega', confirmText: entregue ? 'Marcar entregue' : 'Desfazer' }))) {
      return
    }
    try {
      const atualizado = await registrarEntrega(cotacao.id, { chaves, todasAsChaves: todas, entregue }, currentAdmin)
      setQuotes((prev) => prev.map((q) => (q.id === atualizado.id ? atualizado : q)))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    }
  }

  /** Dados de transporte do formulário → como ficam gravados (link arrumado, quem e quando). */
  function carimbarTransporte(dados: Record<string, DadosTransporteEditaveis>): Record<string, DadosTransporte> {
    const agora = Date.now()
    return Object.fromEntries(
      Object.entries(dados).map(([chave, d]) => [
        chave,
        {
          numeroNotaFiscal: d.numeroNotaFiscal.trim(),
          numeroCotacaoFrete: d.numeroCotacaoFrete.trim(),
          transportadora: d.transportadora.trim(),
          linkRastreio: normalizarLinkRastreio(d.linkRastreio) ?? '',
          previsaoEntrega: d.previsaoEntrega || '',
          atualizadoEm: agora,
          atualizadoPor: currentAdmin,
        },
      ]),
    )
  }

  async function handleConfirmarTransporte(dados: Record<string, DadosTransporteEditaveis>) {
    if (!cotacao) return
    try {
      await updateQuoteStatus(cotacao.id, 'EM TRANSPORTE', currentAdmin)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar o status.')
      return
    }
    try {
      await salvarTransporte(cotacao.id, carimbarTransporte(dados))
    } catch (err) {
      void avisar(
        `O status mudou para ${nomeDoStatus('EM TRANSPORTE')}, mas os dados do envio não foram salvos (${err instanceof Error ? err.message : 'erro no servidor'}). ` +
          'Preencha de novo no cartão Transporte de cada fornecedor.',
      )
    }
    setTransporteModalAberto(false)
    await refresh()
  }

  async function handleSalvarTransporteGrupo(chave: string, dados: DadosTransporteEditaveis) {
    if (!cotacao) return
    try {
      const atualizado = await salvarTransporte(cotacao.id, carimbarTransporte({ [chave]: dados }))
      setQuotes((prev) => prev.map((q) => (q.id === atualizado.id ? atualizado : q)))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
      throw err
    }
  }

  async function handleConfirmarPedidoCompra(info: PedidoCompraInfo) {
    if (!cotacao) return
    try {
      await updateQuoteStatus(cotacao.id, 'PEDIDO DE COMPRA', currentAdmin, info)
      setPedidoModalAberto(false)
      await refresh()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar o status.')
    }
  }

  const gruposPorFornecedor = useMemo(() => (cotacao ? gruposDoPedido(cotacao) : []), [cotacao])
  /** Previsão de finalização da produção do pedido de um fornecedor (a dele, ou a única do pedido). */
  const previsaoProducaoDoGrupo = (chaveDados: string): string | undefined =>
    cotacao?.producao?.previsaoPorFornecedor?.[chaveDados] || cotacao?.producao?.previsaoFinalizacao || undefined

  // fornecedores do pedido (chave do transporte) e os que ainda não entregaram
  const chavesTransporte = gruposPorFornecedor.map((g) => chaveTransporte(g.chave))
  const chavesAEntregar = chavesTransporte.filter((c) => !cotacao?.transportePorFornecedor?.[c]?.entregueEm)

  const totaisGerais = useMemo(() => estatisticasGrupo(itensDoPedido, fechados), [itensDoPedido, fechados])
  const corStatus = cotacao ? corPadraoDoStatus(cotacao.status) : '#999'

  // dados do pedido pro fornecedor com o modal aberto no momento — usa o valor/qtd FECHADO (o que
  // realmente saiu, ver estatisticasGrupo), não o negociado na cotação original
  const dadosPedidoFornecedorAberto = useMemo((): BasePedidoCompraFornecedor | undefined => {
    if (!pedidoFornecedorAberto || !cotacao) return undefined
    const grupo = gruposPorFornecedor.find((g) => g.chave === pedidoFornecedorAberto)
    if (!grupo) return undefined
    const chaveFornecedor = chaveFornecedorFrete(grupo.fornecedor)

    // transportadora: a do envio (se já informada ao ir pra EM TRANSPORTE), senão a da cotação de
    // frete mais barata desse fornecedor/UF (aba Frete / Itens da cotação)
    const transportadoraSugerida =
      cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]?.transportadora || freteMaisBarato(cotacao, grupo.remetente)?.[0]

    // prazo: o que esse fornecedor informou na cotação dele, se for o mesmo pra todos os itens
    const prazos = new Set(
      grupo.items.map(
        (item) =>
          item.product.cotacoesFornecedores
            ?.find((c) => chaveFornecedorFrete(c.fornecedor) === chaveFornecedor)
            ?.prazoEntrega?.trim()
            .toUpperCase() ?? '',
      ),
    )
    const prazoSugerido = prazos.size === 1 ? Array.from(prazos)[0] || undefined : undefined

    return {
      chave: `${cotacao.id}|${grupo.chave}`,
      fornecedor: grupo.fornecedor,
      codigoCotacao: cotacao.codigo || '',
      comprador: currentAdmin,
      transportadoraSugerida,
      prazoSugerido,
      itens: grupo.items.map((item) => {
        const f = fechados[item.id] ?? {
          qtd: item.product.qtd,
          valorUnt: item.product.valorUnt,
          freteRate: item.product.freteRate,
        }
        return {
          qtd: f.qtd || 0,
          referencia: item.product.referencia,
          marca: item.product.marca,
          interno: item.product.interno,
          descricao: item.product.descricao,
          valorUnitario: f.valorUnt || 0,
        }
      }),
    }
  }, [pedidoFornecedorAberto, cotacao, gruposPorFornecedor, fechados, currentAdmin])

  const cotacaoOptions = [
    { value: '', label: '— buscar outra cotação —' },
    ...quotes.map((q) => ({ value: q.id, label: `${q.codigo || 'sem código'} — ${q.cliente || 'sem cliente'} (${nomeDoStatus(q.status)})` })),
  ]

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Pedido de Compra</h2>
        <p className="text-sm text-ink-400">
          Compare o que foi negociado na cotação com o que realmente fechou com cada fornecedor — a diferença é o
          que se ganhou (ou perdeu) em cima do produto e do frete. Mudar o status aqui muda também na Cotação: é o
          mesmo registro, só os valores de item ficam independentes pra permitir a comparação.
        </p>
      </div>

      <div className="card" aria-label="Pedidos em transporte">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-semibold text-ink-900">Pedidos em transporte</h3>
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-500">
            <input type="checkbox" checked={mostrarJaEntregues} onChange={(e) => setMostrarJaEntregues(e.target.checked)} />
            Mostrar também os já entregues
          </label>
        </div>
        {loading ? (
          <p className="py-2 text-center text-sm text-ink-400">Carregando…</p>
        ) : pedidosEmTransporte.length === 0 ? (
          <p className="py-2 text-center text-sm text-ink-400">Nada em transporte no momento.</p>
        ) : (
          <div className="space-y-1.5">
            {pedidosEmTransporte.map((q) => {
              const envios = Object.values(q.transportePorFornecedor ?? {})
              const transportadoras = Array.from(new Set(envios.map((t) => t.transportadora.trim()).filter(Boolean)))
              const cor = corPadraoDoStatus(q.status)
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setResumoTransporteId(q.id)}
                  title="Ver nota, transportadora, rastreio e previsão"
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-left text-sm transition hover:border-ink-300 hover:bg-ink-50"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-800">
                      {q.codigo || 'sem código'} — {q.cliente || 'sem cliente'}
                    </span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: cor, color: corTexto(cor) }}>
                      {nomeDoStatus(q.status)}
                    </span>
                    {estaACaminho(q.status) && <SelosPrevisao previsoes={previsoesDeEntrega(q)} />}
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">{transportadoras.length > 0 ? transportadoras.join(', ') : 'transportadora não informada'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-display text-base font-semibold text-ink-900">Cotações em Pedido de Compra</h3>
        </div>
        {loading ? (
          <p className="text-sm text-ink-400 py-4 text-center">Carregando…</p>
        ) : cotacoesEmPedido.length === 0 ? (
          <p className="text-sm text-ink-400 py-4 text-center">Nenhuma cotação em Pedido de Compra no momento.</p>
        ) : (
          <div className="space-y-4">
            {ordemComExtras('cotacoes', cotacoesEmPedido.map((q) => q.status)).map((status) => {
              const doStatus = cotacoesEmPedido.filter((q) => q.status === status)
              if (doStatus.length === 0) return null
              return (
                <GrupoDaLista key={status} status={status} quantidade={doStatus.length}>
                  {doStatus.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setCotacaoId(q.id)}
                      className={`w-full flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                        cotacaoId === q.id ? 'border-ink-400 bg-ink-100' : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-medium text-ink-800 truncate">
                          {q.codigo || 'sem código'} — {q.cliente || 'sem cliente'}
                        </span>
                        {q.status === 'PEDIDO CONFIRMADO' && q.producao && (
                          <SeloProducao producao={q.producao} totalItens={itensDoPedidoDeCompra(q).length} previsoes={previsoesDeProducao(q)} />
                        )}
                        <SelosPrevisao previsoes={previsoesDeEntrega(q)} />
                      </span>
                      <span className="text-ink-400 shrink-0">
                        {q.maquina}
                        {entradaNoPedidoDeCompra(q) && (
                          <span className="ml-2 text-xs" title="Quando virou pedido de compra">
                            pedido em {new Date(entradaNoPedidoDeCompra(q)!.em).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </GrupoDaLista>
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
              <div className="mt-2 text-sm">
                <AndamentoDoPedido cotacao={cotacao} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {estaACaminho(cotacao.status) && chavesAEntregar.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleEntrega(chavesAEntregar, true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500"
                >
                  <span aria-hidden>✓</span>
                  {chavesAEntregar.length < chavesTransporte.length ? 'Marcar o restante como entregue' : 'Mercadoria entregue'}
                </button>
              )}
              <label className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{ backgroundColor: corStatus, color: corTexto(corStatus) }}
                >
                  {nomeDoStatus(cotacao.status)}
                </span>
                <select
                  value={cotacao.status}
                  aria-label="Status da cotação"
                  onChange={(e) => handleStatusChange(e.target.value as QuoteStatus)}
                  className="field-input text-xs py-1.5 w-auto"
                >
                  <OpcoesDeStatus tipo="cotacoes" atual={cotacao.status} />
                </select>
              </label>
            </div>
          </div>

          {cotacao.status === 'PEDIDO CONFIRMADO' && (
            <div className="card flex flex-wrap items-start justify-between gap-3 text-sm" aria-label="Produção do pedido">
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Produção</h3>
                {cotacao.producao ? (
                  <>
                    <DetalheProducao producao={cotacao.producao} itens={itensDoPedido} mostrarPrevisao={false} />
                    {gruposPorFornecedor.length > 1 ? (
                      <div className="mt-3 space-y-1.5" role="group" aria-label="Previsão de finalização por fornecedor">
                        <p className="text-ink-600">Previsão de finalização da produção — de cada fornecedor:</p>
                        {gruposPorFornecedor.map((grupo) => {
                          const data = cotacao.producao?.previsaoPorFornecedor?.[grupo.chaveDados] ?? ''
                          return (
                            <label key={grupo.chaveDados} className="flex flex-wrap items-center gap-2 text-ink-600">
                              <span className="min-w-[9rem] font-medium text-ink-800">{grupo.rotulo}</span>
                              <input
                                key={`${cotacao.producao!.em}-${grupo.chaveDados}`}
                                type="date"
                                aria-label={`Previsão de finalização — ${grupo.rotulo}`}
                                className="field-input w-auto py-1 text-sm"
                                defaultValue={data}
                                onBlur={(e) => void handlePrevisaoProducao(e.target.value, grupo.chaveDados)}
                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                              />
                              {data && <SeloPrevisao previsao={data} tipo="producao" />}
                            </label>
                          )
                        })}
                      </div>
                    ) : (
                      <label className="mt-3 flex flex-wrap items-center gap-2 text-ink-600" htmlFor="previsao-finalizacao">
                        Previsão de finalização da produção:
                        {/* não controlado (ver DateField) e gravando ao sair do campo: enquanto o ano é
                         * digitado, o campo passa por datas pela metade ("0202-…") que não podem ir pro servidor */}
                        <input
                          id="previsao-finalizacao"
                          key={cotacao.producao.em}
                          type="date"
                          className="field-input w-auto py-1 text-sm"
                          defaultValue={cotacao.producao.previsaoFinalizacao ?? ''}
                          onBlur={(e) => void handlePrevisaoProducao(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        />
                        {cotacao.producao.previsaoFinalizacao && <SeloPrevisao previsao={cotacao.producao.previsaoFinalizacao} tipo="producao" />}
                      </label>
                    )}
                  </>
                ) : (
                  <p className="text-ink-500">Ainda não foi informado se o pedido está todo ou só em parte em produção.</p>
                )}
              </div>
              <Button variant="secondary" onClick={() => void handleAlterarProducao()}>
                {cotacao.producao ? 'Alterar produção' : 'Informar produção'}
              </Button>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-display text-base font-semibold text-ink-900">
                Resumo geral {gruposPorFornecedor.length > 1 ? `(${gruposPorFornecedor.length} fornecedores)` : ''}
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-ink-500" role="group" aria-label="Frete em reais ou em porcentagem">
                  Frete em:
                  {(['valor', 'percentual'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={modoFrete === m}
                      onClick={() => mudarModoFrete(m)}
                      className={`pill-tab border py-1 text-xs ${
                        modoFrete === m ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                      }`}
                    >
                      {m === 'valor' ? 'R$' : '%'}
                    </button>
                  ))}
                </div>
                <Button variant="primary" onClick={handleSalvar} disabled={salvando}>
                  Salvar dados
                </Button>
                {salvo && <span className="text-xs text-emerald-600">Salvo!</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatVenda label="Valor de venda (passado ao cliente)" valor={valorDeVenda(itensDoPedido)} />
              <MiniStat label="Valor dos produtos" negociado={totaisGerais.valorNegociado} fechado={totaisGerais.valorFechado} />
              <MiniStat label="Frete total" negociado={totaisGerais.freteNegociado} fechado={totaisGerais.freteFechado} />
              <MiniStat label="Frete unitário médio" negociado={totaisGerais.freteUnitNegociado} fechado={totaisGerais.freteUnitFechado} />
              <MiniStat
                label="Total geral"
                negociado={totaisGerais.valorNegociado + totaisGerais.freteNegociado}
                fechado={totaisGerais.valorFechado + totaisGerais.freteFechado}
              />
            </div>
          </div>

          {gruposPorFornecedor.map((grupo) => {
            const est = estatisticasGrupo(grupo.items, fechados)
            const recolhido = recolhidos.has(grupo.chave)
            const transporte = cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]
            return (
              <div key={grupo.chave || '__sem_fornecedor__'} className="card" aria-label={`Pedido de ${grupo.rotulo}`}>
                <div className={`flex flex-wrap items-center justify-between gap-3 ${recolhido ? '' : 'mb-3'}`}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => alternarRecolhido(grupo.chave)}
                      aria-expanded={!recolhido}
                      aria-label={`${recolhido ? 'Mostrar' : 'Recolher'} o pedido de ${grupo.rotulo}`}
                      title={recolhido ? 'Mostrar o pedido desse fornecedor' : 'Recolher o pedido desse fornecedor'}
                      className="flex h-7 w-7 items-center justify-center rounded text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                    >
                      <span aria-hidden className={`transition-transform ${recolhido ? '-rotate-90' : ''}`}>
                        ▾
                      </span>
                    </button>
                    <h3 className="cursor-pointer font-display text-base font-semibold text-ink-900" onClick={() => alternarRecolhido(grupo.chave)}>
                      Fornecedor: {grupo.rotulo}
                      {grupo.remetente.uf && grupo.rotulo === grupo.fornecedor && (
                        <span className="ml-2 rounded border border-ink-300 px-1 py-px font-mono text-[11px] font-semibold text-ink-600">
                          {grupo.remetente.uf}
                        </span>
                      )}
                    </h3>
                    {recolhido && (
                      <span className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                        {grupo.items.length} {grupo.items.length === 1 ? 'item' : 'itens'} · total fechado{' '}
                        <strong className="font-mono tabular-nums text-ink-800">{formatCurrency(est.valorFechado + est.freteFechado)}</strong>
                        {transporte?.entregueEm ? (
                          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            ✓ entregue
                          </span>
                        ) : (
                          transporte?.previsaoEntrega && <SeloPrevisao previsao={transporte.previsaoEntrega} />
                        )}
                      </span>
                    )}
                    {cotacao.status === 'PEDIDO CONFIRMADO' && previsaoProducaoDoGrupo(grupo.chaveDados) && (
                      <SeloPrevisao previsao={previsaoProducaoDoGrupo(grupo.chaveDados)!} tipo="producao" />
                    )}
                  </div>
                  <Button variant="secondary" onClick={() => setPedidoFornecedorAberto(grupo.chave)}>
                    Gerar pedido de compra
                  </Button>
                </div>
                {!recolhido && (
                <>
                {aPartirDoTransporte(cotacao.status) && (
                  <CartaoTransporte
                    key={`${grupo.chave}-${cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]?.atualizadoEm ?? 0}`}
                    chave={chaveTransporte(grupo.chave)}
                    inicial={transporteInicial(cotacao, grupo.chave, grupo.remetente)}
                    salvoEm={cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]?.atualizadoEm}
                    salvoPor={cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]?.atualizadoPor}
                    entregueEm={cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]?.entregueEm}
                    entreguePor={cotacao.transportePorFornecedor?.[chaveTransporte(grupo.chave)]?.entreguePor}
                    // com um fornecedor só, o botão do topo ("Mercadoria entregue") já faz isso
                    onMarcarEntregue={
                      chavesTransporte.length > 1 && estaACaminho(cotacao.status)
                        ? () => void handleEntrega([chaveTransporte(grupo.chave)], true)
                        : undefined
                    }
                    onDesfazerEntrega={
                      naFaseDaEntrega(cotacao.status) ? () => void handleEntrega([chaveTransporte(grupo.chave)], false) : undefined
                    }
                    onSalvar={(dados) => handleSalvarTransporteGrupo(chaveTransporte(grupo.chave), dados)}
                  />
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <MiniStat label="Frete total" negociado={est.freteNegociado} fechado={est.freteFechado} />
                  <MiniStat label="Frete unitário" negociado={est.freteUnitNegociado} fechado={est.freteUnitFechado} />
                  <MiniStat label="Valor dos produtos" negociado={est.valorNegociado} fechado={est.valorFechado} />
                  <StatVenda label="Valor de venda" valor={valorDeVenda(grupo.items)} />
                </div>
                <AplicarFreteGrupo modo={modoFrete} valorProdutos={est.valorFechado} onAplicar={(taxa) => aplicarTaxaNoGrupo(grupo.items, taxa)} />

                <div className="overflow-x-auto rounded-xl border border-ink-100">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-ink-50 text-left text-ink-400">
                        <th className="py-2 px-2 font-medium min-w-[10rem]">Produto</th>
                        <th className="py-2 px-2 font-medium w-20 text-right">Qtd negoc.</th>
                        <th className="py-2 px-2 font-medium w-20 text-right">Qtd fechada</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">Vlr unt. negoc.</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">Vlr unt. fechado</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">{modoFrete === 'valor' ? 'Frete unt. negoc.' : 'Frete negoc. (%)'}</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">{modoFrete === 'valor' ? 'Frete unt. fechado' : 'Frete fechado (%)'}</th>
                        <th className="py-2 px-2 font-medium w-28 text-right">Total negociado</th>
                        <th className="py-2 px-2 font-medium w-28 text-right">Total fechado</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">Diferença</th>
                        <th className="py-2 px-2 font-medium w-24 text-right bg-sky-50/60">Venda unt.</th>
                        <th className="py-2 px-2 font-medium w-28 text-right bg-sky-50/60">Venda total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.items.map((item) => {
                        const f = fechados[item.id] ?? {
                          qtd: item.product.qtd,
                          valorUnt: item.product.valorUnt,
                          freteRate: item.product.freteRate,
                        }
                        const totalNegociado = (item.product.qtd || 0) * (item.product.valorUnt || 0)
                        const totalFechado = (f.qtd || 0) * (f.valorUnt || 0)
                        const freteUnitNegociado = (item.product.valorUnt || 0) * (item.product.freteRate || 0)
                        const freteUnitFechado = (f.valorUnt || 0) * (f.freteRate || 0)
                        const dif = totalFechado - totalNegociado
                        return (
                          <tr key={item.id} className="border-t border-ink-100">
                            <td className="py-1.5 px-2 text-ink-800">
                              {item.product.descricao || 'Item sem descrição'}
                              {cotacao.status === 'PEDIDO CONFIRMADO' && cotacao.producao?.tipo === 'parcial' && (
                                <span
                                  className={`ml-2 inline-flex rounded-full border px-1.5 py-px text-[10px] font-semibold ${
                                    cotacao.producao.itemIds.includes(item.id)
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                      : 'border-amber-300 bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {cotacao.producao.itemIds.includes(item.id) ? 'em produção' : 'ainda não em produção'}
                                </span>
                              )}
                              {item.product.referencia.trim() && (
                                <span className="block font-mono text-xs text-ink-500">Ref. {item.product.referencia.trim()}</span>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-500">
                              {item.product.qtd}
                            </td>
                            <td className="py-1.5 px-1">
                              <input
                                type="number"
                                min={0}
                                className="field-input text-right tabular-nums py-1"
                                value={f.qtd}
                                onChange={(e) => patchFechado(item.id, { qtd: Number(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-500">
                              {formatCurrency(item.product.valorUnt)}
                            </td>
                            <td className="py-1.5 px-1">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                className="field-input text-right tabular-nums py-1"
                                value={f.valorUnt}
                                onChange={(e) => patchFechado(item.id, { valorUnt: Number(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-500">
                              {modoFrete === 'valor' ? formatCurrency(freteUnitNegociado) : percentual(item.product.freteRate)}
                            </td>
                            <td className="py-1.5 px-1">
                              {modoFrete === 'valor' ? (
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  className="field-input text-right tabular-nums py-1"
                                  aria-label={`Frete unitário fechado (R$) — ${item.product.referencia || item.product.descricao}`}
                                  value={Math.round(freteUnitFechado * 100) / 100}
                                  onChange={(e) => patchFreteUnitFechado(item.id, Number(e.target.value) || 0)}
                                />
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  className="field-input text-right tabular-nums py-1"
                                  aria-label={`Frete fechado (%) — ${item.product.referencia || item.product.descricao}`}
                                  title={`= ${formatCurrency(freteUnitFechado)} por unidade`}
                                  value={Math.round((f.freteRate || 0) * 10000) / 100}
                                  onChange={(e) => patchFechado(item.id, { freteRate: (Number(e.target.value) || 0) / 100 })}
                                />
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-500">
                              {formatCurrency(totalNegociado)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-800">
                              {formatCurrency(totalFechado)}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right font-mono tabular-nums ${
                                dif < 0 ? 'text-emerald-600' : dif > 0 ? 'text-rose-600' : 'text-ink-400'
                              }`}
                            >
                              {dif > 0 ? '+' : ''}
                              {formatCurrency(dif)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-800 bg-sky-50/40">
                              {formatCurrency(precoDeVenda(item))}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink-800 bg-sky-50/40">
                              {formatCurrency(precoDeVenda(item) * (item.product.qtd || 0))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                </>
                )}
              </div>
            )
          })}
        </>
      )}

      {transporteModalAberto && cotacao && (
        <TransporteModal
          codigoCotacao={cotacao.codigo}
          grupos={gruposPorFornecedor.map((g) => ({
            chave: chaveTransporte(g.chave),
            rotulo: g.rotulo,
            inicial: transporteInicial(cotacao, g.chave, g.remetente),
          }))}
          onConfirmar={handleConfirmarTransporte}
          onCancelar={() => setTransporteModalAberto(false)}
        />
      )}

      {resumoTransporte && (
        <ResumoTransporteDaCotacao
          cotacao={resumoTransporte}
          onAbrirPedido={() => {
            setCotacaoId(resumoTransporte.id)
            setResumoTransporteId(undefined)
          }}
          onFechar={fecharResumoTransporte}
        />
      )}

      {pedidoModalAberto && cotacao && (
        <PedidoCompraModal quote={cotacao} onConfirm={handleConfirmarPedidoCompra} onCancel={() => setPedidoModalAberto(false)} />
      )}

      {dadosPedidoFornecedorAberto && (
        <PedidoCompraFornecedorModal
          key={dadosPedidoFornecedorAberto.chave}
          base={dadosPedidoFornecedorAberto}
          onClose={() => setPedidoFornecedorAberto(undefined)}
        />
      )}
    </div>
  )
}
