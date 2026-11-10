import { useEffect, useMemo, useRef, useState } from 'react'
import { listQuotes, salvarObservacaoCotacao, updateQuoteStatus } from '../db/analysesRepo'
import { CelulaObservacao } from '../components/CelulaObservacao'
import { getStatusColors } from '../db/configRepo'
import { Button } from '../components/ui/Basics'
import { SelectField, TextField } from '../components/ui/Field'
import { PedidoCompraModal } from '../components/PedidoCompraModal'
import { PreviaImportacao } from '../components/PreviaImportacao'
import { AvisoImportacaoCotar } from '../components/AvisoImportacaoCotar'
import { lerPlanilhaCotacao, type ItemCotacaoImportado } from '../quoteImport'
import { arquivoParaBase64 } from '../planilhaCliente'
import { gerarPreviaPlanilha, type PreviaPlanilha } from '../xlsxSheetUtil'
import { formatCurrency, formatDate, selecionarTudoAoFocar } from '../utils'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { VENDEDORES } from '../types'
import { OpcoesDeStatus } from '../components/OpcoesDeStatus'
import { nomeDoStatus, ordemComExtras } from '../statusConfig'
import type { PedidoCompraInfo, QuoteRecord, QuoteStatus, TipoReferencia } from '../types'
import { useEstadoPersistente } from '../estadoPersistente'
import { diasUteisDesde, textoDiasUteis, useVersaoFeriados } from '../diasUteis'
import { avisar, confirmar } from '../dialogs'
import { useFecharComEsc } from '../teclaEsc'
import { itensDoPedidoDeCompra, perguntarAntesDoStatus } from '../mudancaDeStatus'
import { DetalheProducao, SeloProducao } from '../components/SeloProducao'
import { previsoesDeProducao } from '../fornecedoresDoPedido'
import { AndamentoDoPedido } from '../components/AndamentoDoPedido'
import { VendedorNaCotacao } from '../components/VendedorNaCotacao'
import { alteracoesNaoVistas } from '../alteracoesVendedor'

const vendedorOptions = [{ value: '', label: '— selecione —' }, ...VENDEDORES.map((v) => ({ value: v, label: v }))]
const NOVO = '__novo__'

/** Correspondências case-insensitive, por igualdade ou substring em qualquer direção. */
function encontrarCorrespondencias(valor: string, conhecidos: string[]): string[] {
  const alvo = valor.trim().toLowerCase()
  if (!alvo) return []
  const vistos = new Set<string>()
  const resultado: string[] = []
  for (const c of conhecidos) {
    const atual = c.trim().toLowerCase()
    if (!atual || vistos.has(atual)) continue
    if (atual === alvo || atual.includes(alvo) || alvo.includes(atual)) {
      vistos.add(atual)
      resultado.push(c)
    }
  }
  return resultado
}

/** O que a cotação pede, pra mostrar na frente do cliente: quando veio de uma planilha importada, só
 * isso (e quantos itens); senão os dois primeiros itens — nomes repetidos se juntam ("×2") — e
 * quantos outros ainda tem. */
function resumoDosItens(r: QuoteRecord): { planilha?: string; primeiros: { nome: string; vezes: number }[]; resto: number; total: number } {
  const nomesDosItens = r.items.map((i) => i.product.descricao.trim() || i.product.referencia.trim()).filter(Boolean)
  // itens ainda só na lista "a cotar" (antes da precificação)
  const nomes =
    nomesDosItens.length > 0
      ? nomesDosItens
      : (r.itensPreRegistro ?? []).map((p) => (p.descricao ?? '').trim() || p.referencia.trim() || p.interno.trim()).filter(Boolean)
  if (r.planilhaOriginal || r.tipoReferencia === 'planilha') {
    return { planilha: r.planilhaOriginal?.nomeArquivo ?? '', primeiros: [], resto: 0, total: nomes.length }
  }
  const contagem = new Map<string, number>()
  for (const nome of nomes) contagem.set(nome.toUpperCase(), (contagem.get(nome.toUpperCase()) ?? 0) + 1)
  const primeiros = Array.from(contagem.entries())
    .slice(0, 2)
    .map(([chave, vezes]) => ({ nome: nomes.find((n) => n.toUpperCase() === chave) ?? chave, vezes }))
  const mostrados = primeiros.reduce((s, p) => s + p.vezes, 0)
  return { primeiros, resto: nomes.length - mostrados, total: nomes.length }
}

function ResumoDosItens({ r }: { r: QuoteRecord }) {
  const resumo = resumoDosItens(r)
  if (resumo.planilha !== undefined) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] font-semibold text-ink-600"
        title={resumo.planilha ? `Importada da planilha ${resumo.planilha}` : 'Cotação de uma planilha'}
      >
        Planilha{resumo.total > 0 ? ` · ${resumo.total} ${resumo.total === 1 ? 'item' : 'itens'}` : ''}
      </span>
    )
  }
  if (resumo.primeiros.length === 0) return null
  const texto = resumo.primeiros.map((p) => (p.vezes > 1 ? `${p.nome} ×${p.vezes}` : p.nome)).join(', ')
  return (
    <span className="min-w-0 truncate text-xs text-ink-500" title={`Itens: ${texto}${resumo.resto > 0 ? ` e mais ${resumo.resto}` : ''}`}>
      {texto}
      {resumo.resto > 0 && (
        <>
          {' '}
          <span className="font-semibold text-ink-600">+{resumo.resto}</span>
        </>
      )}
    </span>
  )
}

// cor fixa por pessoa — dá pra reconhecer quem está com a cotação de relance, sem ler o nome
const CORES_RESPONSAVEL: Record<string, string> = { Max: '#2a78d6', Gouvêa: '#eb6834', Maicon: '#1baf7a' }
const CORES_OUTROS_RESPONSAVEIS = ['#4a3aa7', '#e87ba4', '#008300', '#eda100']

function corDoResponsavel(nome: string): string {
  if (CORES_RESPONSAVEL[nome]) return CORES_RESPONSAVEL[nome]
  let hash = 0
  for (const letra of nome) hash = (hash * 31 + letra.charCodeAt(0)) >>> 0
  return CORES_OUTROS_RESPONSAVEIS[hash % CORES_OUTROS_RESPONSAVEIS.length]
}

/** Quem está com a cotação (quem a tirou de PENDENTE) — o primeiro que se vê na linha. */
function SeloResponsavel({ nome, ehVoce }: { nome: string; ehVoce: boolean }) {
  if (!nome) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full border border-dashed border-ink-300 px-2 py-0.5 text-[11px] text-ink-400"
        title="Ninguém pegou essa cotação ainda"
      >
        sem responsável
      </span>
    )
  }
  const cor = corDoResponsavel(nome)
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-200 bg-surface py-0.5 pl-0.5 pr-2 text-xs font-semibold text-ink-800"
      title={`${nome} está com essa cotação`}
    >
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ backgroundColor: cor }}
      >
        {nome.charAt(0).toUpperCase()}
      </span>
      {nome}
      {ehVoce && <span className="font-normal text-ink-400">(você)</span>}
    </span>
  )
}

/** PENDENTE há mais dias úteis que isso fica em destaque. */
const DIAS_PENDENTE_ALERTA = 2

/** Há quanto tempo a cotação está pendente (desde que o cliente pediu), em dias úteis — fim de semana e
 * feriado não contam. */
function TempoPendente({ r }: { r: QuoteRecord }) {
  useVersaoFeriados()
  const dias = diasUteisDesde(r.dataSolicitacao ?? r.createdAt)
  const atrasada = dias > DIAS_PENDENTE_ALERTA
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        atrasada ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-ink-200 text-ink-500'
      }`}
      title="Tempo pendente em dias úteis — fins de semana e feriados não contam"
    >
      ⏱ {dias === 0 ? 'pendente desde hoje' : `pendente há ${textoDiasUteis(dias)}`}
    </span>
  )
}

/** Observação já na criação da cotação (opcional) — depois ela fica no balão do cartão da cotação. */
function CampoObservacaoNova({ valor, onChange }: { valor: string; onChange: (valor: string) => void }) {
  return (
    <label className="mb-4 block">
      <span className="field-label">Observação (opcional)</span>
      <textarea
        className="field-input min-h-[3.5rem] text-sm"
        placeholder="Ex.: cliente pediu entrega até sexta; conferir referência do item 3…"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/** Observação da cotação, no balão igual ao da Precificação — grava sozinha quando o balão fecha. */
function ObservacaoDaCotacao({ r }: { r: QuoteRecord }) {
  const [texto, setTexto] = useState(r.observacao ?? '')
  const salvo = useRef(r.observacao ?? '')
  useEffect(() => {
    salvo.current = r.observacao ?? ''
    setTexto(r.observacao ?? '')
  }, [r.observacao])

  async function gravar() {
    const novo = texto.trim()
    if (novo === salvo.current.trim()) return
    salvo.current = novo
    try {
      await salvarObservacaoCotacao(r.id, novo)
    } catch (err) {
      salvo.current = r.observacao ?? ''
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar a observação no servidor.')
    }
  }

  return (
    <div className="w-28 shrink-0">
      <CelulaObservacao
        valor={texto}
        onChange={setTexto}
        onFechar={() => void gravar()}
        idLinha={r.id}
        descricaoItem={r.codigo || r.cliente || 'cotação'}
        placeholder="Escreva a observação dessa cotação…"
      />
    </div>
  )
}

function QuoteCard({
  r,
  corDoStatus,
  currentAdmin,
  onOpenQuote,
  onStatusChange,
}: {
  r: QuoteRecord
  corDoStatus: (status: string) => string
  currentAdmin: string
  onOpenQuote: (r: QuoteRecord) => void
  onStatusChange: (r: QuoteRecord, status: QuoteStatus) => void
}) {
  const [expandido, setExpandido] = useState(false)
  const [menuAberto, setMenuAberto] = useState(false)
  useFecharComEsc(() => setMenuAberto(false), menuAberto)
  const menuRef = useRef<HTMLDivElement>(null)
  const travadaPorOutro = r.status !== 'PENDENTE' && !!r.responsavelStatus && r.responsavelStatus !== currentAdmin

  useEffect(() => {
    if (!menuAberto) return
    function aoClicarFora(e: Event) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [menuAberto])

  return (
    <div className="rounded-lg border border-ink-100">
      <div className="flex items-center gap-2 pl-1 pr-2 py-2">
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-label={expandido ? 'Recolher detalhes' : 'Expandir detalhes'}
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition"
        >
          <span className={`inline-block transition-transform ${expandido ? 'rotate-90' : ''}`}>▸</span>
        </button>

        {/* clicar na cotação só mostra os detalhes (o mesmo que a setinha) — abrir na Precificação é
         * pelo "Editar", pra ninguém sair da lista sem querer só por ter tocado na linha */}
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          title={expandido ? 'Recolher detalhes' : 'Ver detalhes'}
          className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-left py-1"
        >
          <SeloResponsavel nome={r.status === 'PENDENTE' ? '' : r.responsavelStatus} ehVoce={!!r.responsavelStatus && r.responsavelStatus === currentAdmin} />
          <span className="font-mono text-sm text-ink-500">{r.codigo || '—'}</span>
          <span className="text-sm text-ink-800 truncate">
            {r.vendedor || '—'} | {r.cliente || '(sem cliente)'}
          </span>
          <ResumoDosItens r={r} />
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: corDoStatus(r.status), color: corTexto(corDoStatus(r.status)) }}
          >
            {nomeDoStatus(r.status)}
          </span>
          {r.status === 'PENDENTE' && <TempoPendente r={r} />}
          {alteracoesNaoVistas(r, currentAdmin).length > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              alterada pelo vendedor
            </span>
          )}
          {r.status === 'PEDIDO CONFIRMADO' && r.producao && (
            <SeloProducao producao={r.producao} totalItens={itensDoPedidoDeCompra(r).length} previsoes={previsoesDeProducao(r)} />
          )}
          <span className="ml-auto text-sm font-mono tabular-nums text-ink-800">
            {r.summary.precoVendaTotalGeral > 0 ? formatCurrency(r.summary.precoVendaTotalGeral) : '—'}
          </span>
        </button>

        <ObservacaoDaCotacao r={r} />

        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuAberto((v) => !v)
            }}
            aria-label="Mais opções"
            className="h-7 w-7 flex items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition"
          >
            ⋯
          </button>
          {menuAberto && (
            <div className="absolute right-0 top-8 z-10 w-36 rounded-lg border border-ink-100 bg-surface py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setMenuAberto(false)
                  onOpenQuote(r)
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                Editar
              </button>
            </div>
          )}
        </div>
      </div>

      {expandido && (
        <div className="px-3 pb-3 pt-1 border-t border-ink-50 space-y-3 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            <div>
              <p className="text-ink-400">Data criada</p>
              <p className="text-ink-700">{formatDate(r.createdAt)}</p>
            </div>
            <div>
              <p className="text-ink-400">Em análise por</p>
              <p className="text-ink-700">{r.responsavelStatus || '—'}</p>
            </div>
            <div>
              <p className="text-ink-400">Itens</p>
              <p className="text-ink-700">{r.summary.totalItens || r.items.length}</p>
            </div>
            {r.maquina && (
              <div>
                <p className="text-ink-400">Máquina</p>
                <p className="text-ink-700">{r.maquina}</p>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-ink-100 px-3 py-2">
            <p className="mb-1 text-ink-400">Datas do processamento</p>
            <AndamentoDoPedido cotacao={r} corDoStatus={corDoStatus} />
          </div>
          <VendedorNaCotacao r={r} currentAdmin={currentAdmin} />
          {r.status === 'ARQUIVO' && r.motivoArquivamento && (
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
              <p className="text-ink-400">Arquivada sem fechar — motivo</p>
              <p className="font-medium text-ink-800">
                {r.motivoArquivamento.motivo}
                {r.motivoArquivamento.detalhe && <span className="font-normal text-ink-600"> — {r.motivoArquivamento.detalhe}</span>}
              </p>
              <p className="text-[11px] text-ink-400">
                por {r.motivoArquivamento.por} em {formatDate(r.motivoArquivamento.em)}
              </p>
            </div>
          )}
          {r.status === 'PEDIDO CONFIRMADO' && r.producao && (
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
              <p className="text-ink-400">Produção</p>
              <DetalheProducao producao={r.producao} itens={itensDoPedidoDeCompra(r)} previsoes={previsoesDeProducao(r)} />
            </div>
          )}
          <div>
            <p className="text-ink-400 mb-1">Alterar status</p>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDoStatus(r.status) }} />
              <select
                value={r.status}
                disabled={travadaPorOutro}
                onChange={(e) => onStatusChange(r, e.target.value as QuoteStatus)}
                className={`field-input text-xs py-1.5 ${travadaPorOutro ? 'opacity-60 cursor-not-allowed' : ''}`}
                title={travadaPorOutro ? `Em análise por ${r.responsavelStatus} — só ele(a) pode mudar` : undefined}
              >
                <OpcoesDeStatus tipo="cotacoes" atual={r.status} />
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenQuote(r)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 transition"
          >
            Editar (abrir na Precificação)
          </button>
        </div>
      )}
    </div>
  )
}

function GrupoCotacoesCard({
  grupo,
  corDoStatus,
  currentAdmin,
  onOpenQuote,
  onStatusChange,
}: {
  grupo: { status: QuoteStatus; itens: QuoteRecord[] }
  corDoStatus: (status: string) => string
  currentAdmin: string
  onOpenQuote: (r: QuoteRecord) => void
  onStatusChange: (r: QuoteRecord, status: QuoteStatus) => void
}) {
  const [aberto, setAberto] = useEstadoPersistente(`cotacoes:grupoStatusAberto:${grupo.status}`, false)
  return (
    <div>
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center gap-2 mb-2 text-left">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ backgroundColor: corDoStatus(grupo.status), color: corTexto(corDoStatus(grupo.status)) }}
        >
          {nomeDoStatus(grupo.status)}
        </span>
        <span className="text-xs text-ink-400">{grupo.itens.length}</span>
        <span aria-hidden className={`ml-auto text-ink-400 transition-transform ${aberto ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {aberto && (
        <div className="space-y-2">
          {grupo.itens.map((r) => (
            <QuoteCard
              key={r.id}
              r={r}
              corDoStatus={corDoStatus}
              currentAdmin={currentAdmin}
              onOpenQuote={onOpenQuote}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Texto pra busca: sem acento, minúsculo, sem espaços nas pontas. */
function normalizarBusca(texto: string | undefined): string {
  return (texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function CotacoesPage({
  refreshKey,
  currentAdmin,
  onCreateQuote,
  onImportQuote,
  onOpenQuote,
  modoNovoInicial = 'manual',
  abrirNova = false,
}: {
  refreshKey: number
  currentAdmin: string
  /** Como "Nova cotação" já abre — 'importar' quando se chega pelo atalho "Importar cotação" da Tela Inicial. */
  modoNovoInicial?: 'manual' | 'importar'
  /** Chegou pelo "Nova cotação"/"Importar cotação" da Tela Inicial: abre a parte, mesmo se estava recolhida. */
  abrirNova?: boolean
  onCreateQuote: (vendedor: string, cliente: string, maquina: string, tipo: TipoReferencia, observacao: string) => Promise<void>
  onImportQuote: (
    vendedor: string,
    cliente: string,
    maquina: string,
    itens: ItemCotacaoImportado[],
    planilhaOriginal: { nomeArquivo: string; conteudoBase64: string },
    observacao: string,
  ) => Promise<void>
  onOpenQuote: (record: QuoteRecord) => void
}) {
  const [records, setRecords] = useState<QuoteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [modoNovo, setModoNovo] = useState<'manual' | 'importar'>(modoNovoInicial)
  // "Nova cotação" recolhível (lembrado neste aparelho) — abre sozinha quando se chega pelo atalho da Tela Inicial
  const [novaRecolhida, setNovaRecolhida] = useEstadoPersistente('cotacoes:novaRecolhida', false)
  useEffect(() => {
    if (abrirNova) setNovaRecolhida(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirNova])
  // chegar pelo atalho "Importar cotação" mostra o mesmo aviso de clicar em "Importar planilha" aqui
  const [mostrarAvisoCotar, setMostrarAvisoCotar] = useState(modoNovoInicial === 'importar')
  const [vendedor, setVendedor] = useState('')
  const [cliente, setCliente] = useState('')
  const [maquina, setMaquina] = useState('')
  // observação da cotação nova — a mesma caixa serve pro manual e pra importação
  const [observacaoNova, setObservacaoNova] = useState('')
  const [criando, setCriando] = useState(false)
  const [pedidoModalRecord, setPedidoModalRecord] = useState<QuoteRecord | undefined>(undefined)
  const [coresStatus, setCoresStatus] = useState<Record<string, string>>({})

  // --- importar planilha de cotação -----------------------------------------
  const [lendoArquivo, setLendoArquivo] = useState(false)
  const [arquivoPendente, setArquivoPendente] = useState<File | undefined>(undefined)
  const [previaImport, setPreviaImport] = useState<PreviaPlanilha | undefined>(undefined)
  const [importado, setImportado] = useState(false)
  const [clienteMatches, setClienteMatches] = useState<string[]>([])
  const [clienteEscolha, setClienteEscolha] = useState('')
  const [clienteNovoTexto, setClienteNovoTexto] = useState('')
  const [maquinaMatches, setMaquinaMatches] = useState<string[]>([])
  const [maquinaEscolha, setMaquinaEscolha] = useState('')
  const [maquinaNovoTexto, setMaquinaNovoTexto] = useState('')
  const [vendedorImport, setVendedorImport] = useState('')
  const [itensImportados, setItensImportados] = useState<ItemCotacaoImportado[]>([])
  const [arquivoImportado, setArquivoImportado] = useState<File | undefined>(undefined)
  const [confirmandoImport, setConfirmandoImport] = useState(false)

  const clientesConhecidos = useMemo(
    () => Array.from(new Set(records.map((r) => r.cliente.trim()).filter(Boolean))),
    [records],
  )
  const maquinasConhecidas = useMemo(
    () => Array.from(new Set(records.map((r) => r.maquina.trim()).filter(Boolean))),
    [records],
  )

  function resetImportacao() {
    setArquivoPendente(undefined)
    setPreviaImport(undefined)
    setImportado(false)
    setClienteMatches([])
    setClienteEscolha('')
    setClienteNovoTexto('')
    setMaquinaMatches([])
    setMaquinaEscolha('')
    setMaquinaNovoTexto('')
    setVendedorImport('')
    setItensImportados([])
    setArquivoImportado(undefined)
  }

  async function handleArquivoSelecionado(file: File) {
    setLendoArquivo(true)
    try {
      const previa = await gerarPreviaPlanilha(file)
      setArquivoPendente(file)
      setPreviaImport(previa)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao ler a planilha.')
    } finally {
      setLendoArquivo(false)
    }
  }

  async function handleConfirmarPrevia() {
    if (!arquivoPendente) return
    setLendoArquivo(true)
    try {
      const resultado = await lerPlanilhaCotacao(arquivoPendente)
      const clMatches = encontrarCorrespondencias(resultado.cliente, clientesConhecidos)
      const maMatches = encontrarCorrespondencias(resultado.equipamento, maquinasConhecidas)
      setClienteMatches(clMatches)
      setClienteEscolha(clMatches[0] ?? NOVO)
      setClienteNovoTexto(resultado.cliente)
      setMaquinaMatches(maMatches)
      setMaquinaEscolha(maMatches[0] ?? NOVO)
      setMaquinaNovoTexto(resultado.equipamento)
      setVendedorImport(resultado.vendedor)
      setItensImportados(resultado.itens)
      setArquivoImportado(arquivoPendente)
      setImportado(true)
      setPreviaImport(undefined)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao ler a planilha.')
    } finally {
      setLendoArquivo(false)
    }
  }

  function handlePatchItemImportado(index: number, patch: Partial<ItemCotacaoImportado>) {
    setItensImportados((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  async function handleRemoveItemImportado(index: number) {
    const item = itensImportados[index]
    const nome = item ? [item.referencia, item.descricao].filter((x) => x?.trim()).join(' — ') : ''
    if (!(await confirmar(`Tirar este item da importação?${nome ? `\n\n${nome}` : ''}`, { confirmText: 'Tirar', tone: 'danger' }))) {
      return
    }
    setItensImportados((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleConfirmarImportacao() {
    if (!vendedorImport) {
      void avisar('Selecione o vendedor.')
      return
    }
    const clienteFinal = clienteEscolha === NOVO ? clienteNovoTexto.trim().toUpperCase() : clienteEscolha
    const maquinaFinal = maquinaEscolha === NOVO ? maquinaNovoTexto.trim() : maquinaEscolha
    if (!clienteFinal) {
      void avisar('Informe o cliente.')
      return
    }
    if (!maquinaFinal) {
      void avisar('Informe a máquina.')
      return
    }
    if (itensImportados.length === 0) {
      void avisar('Nenhum item pra importar — remova a planilha e confira se ela tem itens marcados como "COTAR".')
      return
    }
    if (!arquivoImportado) {
      void avisar('Selecione o arquivo novamente.')
      return
    }
    setConfirmandoImport(true)
    try {
      const conteudoBase64 = await arquivoParaBase64(arquivoImportado)
      await onImportQuote(
        vendedorImport,
        clienteFinal,
        maquinaFinal,
        itensImportados,
        { nomeArquivo: arquivoImportado.name, conteudoBase64 },
        observacaoNova,
      )
      resetImportacao()
      setObservacaoNova('')
      setModoNovo('manual')
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao importar a cotação.')
    } finally {
      setConfirmandoImport(false)
    }
  }

  async function refresh() {
    setLoading(true)
    try {
      setRecords(await listQuotes())
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao carregar cotações do servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [refreshKey])

  useEffect(() => {
    getStatusColors()
      .then(setCoresStatus)
      .catch(() => {
        // cores customizadas são só um extra visual — se o servidor falhar, usa a paleta padrão
      })
  }, [])

  function corDoStatus(status: string): string {
    return coresStatus[status] || corPadraoDoStatus(status)
  }

  async function handleCriar() {
    if (!vendedor) {
      void avisar('Selecione o vendedor.')
      return
    }
    if (!cliente.trim()) {
      void avisar('Informe o cliente.')
      return
    }
    if (!maquina.trim()) {
      void avisar('Informe a máquina.')
      return
    }
    setCriando(true)
    try {
      await onCreateQuote(vendedor, cliente, maquina, 'itens', observacaoNova)
      setVendedor('')
      setCliente('')
      setMaquina('')
      setObservacaoNova('')
    } finally {
      setCriando(false)
    }
  }

  async function handleStatusChange(record: QuoteRecord, novoStatus: QuoteStatus) {
    if (novoStatus === 'PEDIDO DE COMPRA') {
      setPedidoModalRecord(record)
      return
    }
    // arquivar pede o motivo; confirmar o pedido, a produção — cancelando, o status não muda
    const respostas = await perguntarAntesDoStatus(record, novoStatus)
    if (!respostas) return
    try {
      await updateQuoteStatus(record.id, novoStatus, currentAdmin, undefined, respostas.arquivamento, respostas.producao)
      refresh()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar o status.')
    }
  }

  async function handleConfirmPedidoCompra(info: PedidoCompraInfo) {
    if (!pedidoModalRecord) return
    try {
      await updateQuoteStatus(pedidoModalRecord.id, 'PEDIDO DE COMPRA', currentAdmin, info)
      setPedidoModalRecord(undefined)
      refresh()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar o status.')
    }
  }

  // busca ampla: pela cotação (COT-0070, 0070 ou 70), pelo vendedor ou pelo cliente — sem diferença de
  // acento ou maiúscula; com mais de uma palavra, todas precisam bater ("edson silvernane")
  const [busca, setBusca] = useState('')
  const resultadosBusca = useMemo(() => {
    const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean)
    if (termos.length === 0) return []
    return records
      .filter((r) => {
        const codigo = normalizarBusca(r.codigo || '')
        const numero = (r.codigo || '').replace(/\D/g, '').replace(/^0+/, '')
        const nomes = [normalizarBusca(r.vendedor), normalizarBusca(r.cliente)]
        return termos.every((t) =>
          /^\d+$/.test(t)
            ? numero === t.replace(/^0+/, '') || nomes.some((n) => n.includes(t))
            : codigo.includes(t) || nomes.some((n) => n.includes(t)),
        )
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [records, busca])

  const grupos = useMemo(() => {
    return ordemComExtras('cotacoes', records.map((r) => r.status)).map((status) => ({
      status,
      itens: records.filter((r) => r.status === status).sort((a, b) => b.createdAt - a.createdAt),
    })).filter((g) => g.itens.length > 0)
  }, [records])

  return (
    <div className="space-y-6">
      <div className="card" role="search">
        <label htmlFor="busca-cotacoes" className="sr-only">
          Buscar cotação, vendedor ou cliente
        </label>
        <div className="relative">
          <svg
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="busca-cotacoes"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setBusca('')}
            placeholder="Buscar cotação, vendedor ou cliente — ex.: COT-0070, 70, EDSON, SILVERNANE"
            autoComplete="off"
            className="field-input h-14 pl-12 pr-12 text-base sm:text-lg [&::-webkit-search-cancel-button]:hidden"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              aria-label="Limpar busca"
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-xl leading-none text-ink-400 transition hover:bg-ink-100 hover:text-ink-800"
            >
              ×
            </button>
          )}
        </div>
        {busca.trim() && (
          <div className="mt-4" aria-label="Resultado da busca">
            <p className="mb-2 text-xs text-ink-500">
              {resultadosBusca.length === 0
                ? `Nenhuma cotação encontrada pra "${busca.trim()}".`
                : `${resultadosBusca.length} ${resultadosBusca.length === 1 ? 'cotação encontrada' : 'cotações encontradas'}`}
            </p>
            <div className="space-y-2">
              {resultadosBusca.map((r) => (
                <QuoteCard
                  key={r.id}
                  r={r}
                  corDoStatus={corDoStatus}
                  currentAdmin={currentAdmin}
                  onOpenQuote={onOpenQuote}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className={`flex flex-wrap items-center justify-between gap-3 ${novaRecolhida ? '' : 'mb-1'}`}>
          <h2 className="font-display text-lg font-semibold text-ink-900">
            <button
              type="button"
              onClick={() => setNovaRecolhida((v) => !v)}
              aria-expanded={!novaRecolhida}
              title={novaRecolhida ? 'Mostrar' : 'Recolher'}
              className="flex items-center gap-2 rounded text-left transition hover:text-ink-700"
            >
              <span aria-hidden className={`text-sm text-ink-400 transition-transform ${novaRecolhida ? '-rotate-90' : ''}`}>▾</span>
              Nova cotação
            </button>
          </h2>
          {!novaRecolhida && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModoNovo('manual')}
                className={`pill-tab border ${
                  modoNovo === 'manual' ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                }`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoNovo('importar')
                  setMostrarAvisoCotar(true)
                }}
                className={`pill-tab border ${
                  modoNovo === 'importar' ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                }`}
              >
                Importar planilha
              </button>
            </div>
          )}
        </div>

        {!novaRecolhida && (
          <>
            {modoNovo === 'manual' ? (
              <>
                <p className="text-sm text-ink-400 mb-4">
                  Identifique o vendedor, o cliente e a máquina — depois é só registrar os itens a cotar.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <SelectField label="Vendedor" value={vendedor} onChange={setVendedor} options={vendedorOptions} />
                  <TextField label="Cliente" value={cliente} onChange={setCliente} uppercase />
                  <TextField label="Máquina" value={maquina} onChange={setMaquina} />
                </div>
                <CampoObservacaoNova valor={observacaoNova} onChange={setObservacaoNova} />
                <Button variant="primary" onClick={handleCriar} disabled={criando}>
                  Criar cotação e registrar itens
                </Button>
              </>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-ink-400 mb-4">
                  Envie a planilha de orçamento do cliente — o cliente e o equipamento são lidos do topo, e os itens sem
                  prazo de entrega marcados como "COTAR" viram os itens a cotar dessa cotação.
                </p>
                <label className="block mb-4">
                  <span className="field-label">Arquivo (.xlsx)</span>
                  <input
                    type="file"
                    accept=".xlsx"
                    className="field-input"
                    disabled={lendoArquivo}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleArquivoSelecionado(file)
                      e.target.value = ''
                    }}
                  />
                </label>

                {lendoArquivo && <p className="text-sm text-ink-400">Lendo planilha…</p>}

                {previaImport && arquivoPendente && (
                  <PreviaImportacao
                    nomeArquivo={arquivoPendente.name}
                    previa={previaImport}
                    onConfirmar={handleConfirmarPrevia}
                    onCancelar={resetImportacao}
                    confirmando={lendoArquivo}
                  />
                )}

                {importado && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <span className="field-label">Cliente</span>
                        <select
                          className="field-input"
                          value={clienteEscolha}
                          onChange={(e) => setClienteEscolha(e.target.value)}
                        >
                          {clienteMatches.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          <option value={NOVO}>+ Adicionar novo cliente</option>
                        </select>
                        {clienteEscolha === NOVO && (
                          <input
                            className="field-input uppercase mt-2"
                            value={clienteNovoTexto}
                            onChange={(e) => setClienteNovoTexto(e.target.value)}
                          />
                        )}
                      </div>
                      <div>
                        <span className="field-label">Máquina</span>
                        <select
                          className="field-input"
                          value={maquinaEscolha}
                          onChange={(e) => setMaquinaEscolha(e.target.value)}
                        >
                          {maquinaMatches.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                          <option value={NOVO}>+ Adicionar nova máquina</option>
                        </select>
                        {maquinaEscolha === NOVO && (
                          <input
                            className="field-input mt-2"
                            value={maquinaNovoTexto}
                            onChange={(e) => setMaquinaNovoTexto(e.target.value)}
                          />
                        )}
                      </div>
                    </div>

                    <SelectField
                      label="Vendedor"
                      value={vendedorImport}
                      onChange={setVendedorImport}
                      options={vendedorOptions}
                    />

                    <CampoObservacaoNova valor={observacaoNova} onChange={setObservacaoNova} />

                    <div>
                      <p className="field-label mb-2">Itens a cotar encontrados na planilha</p>
                      <div className="overflow-x-auto rounded-xl border border-ink-100">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-ink-50 text-left text-ink-400">
                              <th className="py-2 px-2 font-medium w-10">#</th>
                              <th className="py-2 px-2 font-medium min-w-[10rem]">Referência</th>
                              <th className="py-2 px-2 font-medium min-w-[14rem]">Descrição</th>
                              <th className="py-2 px-2 font-medium w-28 text-right">Quantidade</th>
                              <th className="py-2 px-2 font-medium w-28">Observação</th>
                              <th className="w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {itensImportados.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-6 text-center text-ink-400 border-t border-ink-100">
                                  Nenhum item restante.
                                </td>
                              </tr>
                            ) : (
                              itensImportados.map((item, index) => (
                                <tr key={index}>
                                  <td className="px-2 py-1 border-t border-ink-100 text-ink-400 text-xs text-center">
                                    {index + 1}
                                  </td>
                                  <td className="px-1 py-1 border-t border-ink-100">
                                    <input
                                      className="w-full bg-transparent border-0 rounded px-1.5 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-brand-400"
                                      value={item.referencia}
                                      onChange={(e) => handlePatchItemImportado(index, { referencia: e.target.value })}
                                    />
                                  </td>
                                  <td className="px-1 py-1 border-t border-ink-100">
                                    <input
                                      className="w-full bg-transparent border-0 rounded px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-400"
                                      value={item.descricao}
                                      onChange={(e) => handlePatchItemImportado(index, { descricao: e.target.value })}
                                    />
                                  </td>
                                  <td className="px-1 py-1 border-t border-ink-100">
                                    <input
                                      type="number"
                                      min={0}
                                      className="w-full bg-transparent border-0 rounded px-1.5 py-1.5 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-brand-400"
                                      value={item.quantidade}
                                      onChange={(e) =>
                                        handlePatchItemImportado(index, { quantidade: Number(e.target.value) || 0 })
                                      }
                                      onFocus={selecionarTudoAoFocar}
                                    />
                                  </td>
                                  <td className="px-1 py-1 border-t border-ink-100">
                                    <CelulaObservacao
                                      valor={item.observacao ?? ''}
                                      onChange={(observacao) => handlePatchItemImportado(index, { observacao })}
                                      idLinha={`importado-${index}`}
                                      descricaoItem={item.referencia.trim() || item.descricao.trim() || `item ${index + 1}`}
                                    />
                                  </td>
                                  <td className="px-1 py-1 border-t border-ink-100 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveItemImportado(index)}
                                      aria-label="Remover item"
                                      className="h-6 w-6 rounded-full text-xs leading-none text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition"
                                    >
                                      ×
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={resetImportacao}>
                        Cancelar
                      </Button>
                      <Button variant="primary" onClick={handleConfirmarImportacao} disabled={confirmandoImport}>
                        Criar cotação com esses itens
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-4">Cotações por status</h2>

        {loading ? (
          <p className="text-sm text-ink-400 text-center py-6">Carregando…</p>
        ) : grupos.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-6">Nenhuma cotação criada ainda.</p>
        ) : (
          <div className="space-y-6">
            {grupos.map((grupo) => (
              <GrupoCotacoesCard
                key={grupo.status}
                grupo={grupo}
                corDoStatus={corDoStatus}
                currentAdmin={currentAdmin}
                onOpenQuote={onOpenQuote}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>

      {pedidoModalRecord && (
        <PedidoCompraModal
          quote={pedidoModalRecord}
          onConfirm={handleConfirmPedidoCompra}
          onCancel={() => setPedidoModalRecord(undefined)}
        />
      )}

      {mostrarAvisoCotar && <AvisoImportacaoCotar onFechar={() => setMostrarAvisoCotar(false)} />}
    </div>
  )
}
