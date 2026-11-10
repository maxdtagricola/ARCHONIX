import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { deleteQuote, listQuotes, updateQuoteStatus } from '../db/analysesRepo'
import { Badge } from '../components/ui/Basics'
import { PedidoCompraModal } from '../components/PedidoCompraModal'
import { formatCurrency, formatDate } from '../utils'
import { ADMINS, VENDEDORES } from '../types'
import { OpcoesDeStatus } from '../components/OpcoesDeStatus'
import { nomeDoStatus } from '../statusConfig'
import type { PedidoCompraInfo, QuoteRecord, QuoteStatus } from '../types'
import { avisar, confirmar } from '../dialogs'
import { perguntarAntesDoStatus } from '../mudancaDeStatus'

function chaveMes(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function labelMes(chave: string): string {
  const [ano, mes] = chave.split('-').map(Number)
  const texto = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function corresponde(r: QuoteRecord, q: string): boolean {
  return (
    r.cliente.toLowerCase().includes(q) ||
    r.maquina.toLowerCase().includes(q) ||
    r.items.some((item) => {
      const p = item.product
      return (
        p.referencia.toLowerCase().includes(q) ||
        p.descricao.toLowerCase().includes(q) ||
        p.fornecedor.toLowerCase().includes(q) ||
        p.marca.toLowerCase().includes(q) ||
        p.ncm.toLowerCase().includes(q)
      )
    })
  )
}

function FolderCard({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card text-left hover:border-brand-300 hover:shadow-sm transition flex items-center justify-between"
    >
      <span className="font-medium text-ink-900">{label}</span>
      <Badge tone="neutral">{count}</Badge>
    </button>
  )
}

export function HistoryPage({
  refreshKey,
  currentAdmin,
  onLoad,
}: {
  refreshKey: number
  currentAdmin: string
  onLoad: (record: QuoteRecord) => void
}) {
  const [records, setRecords] = useState<QuoteRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined)
  const [pedidoModalRecord, setPedidoModalRecord] = useState<QuoteRecord | undefined>(undefined)

  // navegação em pastas: admin > vendedor > mês > cotações
  const [verTudo, setVerTudo] = useState(false)
  const [adminSel, setAdminSel] = useState<string | undefined>(undefined)
  const [vendedorSel, setVendedorSel] = useState<string | undefined>(undefined)
  const [mesSel, setMesSel] = useState<string | undefined>(undefined)

  async function refresh() {
    setLoading(true)
    try {
      const all = await listQuotes()
      setRecords(all)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao carregar o histórico do servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [refreshKey])

  const buscando = query.trim().length > 0

  const resultadoBusca = useMemo(() => {
    if (!buscando) return []
    const q = query.trim().toLowerCase()
    return records.filter((r) => corresponde(r, q))
  }, [records, query, buscando])

  const porAdmin = useMemo(() => (adminSel ? records.filter((r) => r.criadoPor === adminSel) : []), [records, adminSel])
  const porVendedor = useMemo(
    () => (vendedorSel ? porAdmin.filter((r) => r.vendedor === vendedorSel) : []),
    [porAdmin, vendedorSel],
  )
  const porMes = useMemo(() => (mesSel ? porVendedor.filter((r) => chaveMes(r.createdAt) === mesSel) : []), [porVendedor, mesSel])

  const mesesDisponiveis = useMemo(() => {
    const chaves = new Set(porVendedor.map((r) => chaveMes(r.createdAt)))
    return Array.from(chaves).sort((a, b) => (a < b ? 1 : -1))
  }, [porVendedor])

  function abrirAdmin(nome: string) {
    setVerTudo(false)
    setAdminSel(nome)
    setVendedorSel(undefined)
    setMesSel(undefined)
  }
  function abrirVendedor(nome: string) {
    setVendedorSel(nome)
    setMesSel(undefined)
  }
  function voltarParaAdmins() {
    setVerTudo(false)
    setAdminSel(undefined)
    setVendedorSel(undefined)
    setMesSel(undefined)
  }
  function voltarParaVendedores() {
    setVendedorSel(undefined)
    setMesSel(undefined)
  }
  function voltarParaMeses() {
    setMesSel(undefined)
  }

  async function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation()
    if (!(await confirmar('Excluir esta cotação salva? Essa ação não pode ser desfeita.'))) return
    try {
      await deleteQuote(id, currentAdmin)
      refresh()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao excluir a cotação.')
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
      await updateQuoteStatus(record.id, novoStatus, currentAdmin, undefined, respostas.arquivamento, respostas.producao, {
        atualizarValoresDoVendedor: respostas.atualizarValoresDoVendedor,
      })
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

  function renderCard(r: QuoteRecord) {
    const first = r.items[0]
    const extras = Math.max(r.items.length - 1, 0)
    const expandido = expandedId === r.id
    const travadaPorOutro = r.status !== 'PENDENTE' && !!r.responsavelStatus && r.responsavelStatus !== currentAdmin
    return (
      <div key={r.id} className="card hover:border-brand-300 hover:shadow-sm transition group relative">
        <div onClick={() => onLoad(r)} className="cursor-pointer">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              {r.codigo && <p className="text-[11px] font-mono text-ink-400">{r.codigo}</p>}
              <p className="font-medium text-ink-900 truncate">
                {r.cliente || first?.product.descricao || '(sem descrição)'}
              </p>
              {r.maquina && <p className="text-xs text-ink-500 truncate">Máquina: {r.maquina}</p>}
              <p className="text-xs text-ink-400 truncate">
                {first ? (
                  <>Ref. {first.product.referencia || '—'} · NCM {first.product.ncm || '—'}</>
                ) : (
                  <>{r.itensPreRegistro.length} item{r.itensPreRegistro.length === 1 ? '' : 's'} a cotar</>
                )}
              </p>
            </div>
            <Badge tone="neutral">
              {r.summary.totalItens} {r.summary.totalItens === 1 ? 'item' : 'itens'}
            </Badge>
          </div>

          <div className="text-xs text-ink-400 mb-3 space-y-0.5">
            <p>Solicitado em: {formatDate(r.createdAt)}</p>
            <p>Criado por: {r.criadoPor || '—'}{r.vendedor ? ` · Vendedor: ${r.vendedor}` : ''}</p>
            {first && <p>Fornecedor: {first.product.fornecedor || '—'}</p>}
            {extras > 0 && <p>+ {extras} outro{extras > 1 ? 's' : ''} item{extras > 1 ? 's' : ''} nesta cotação</p>}
            {r.pedidoCompra && (
              <p>
                Pedido de compra:{' '}
                {r.pedidoCompra.tipo === 'completo' ? 'completo' : `${r.pedidoCompra.itemIds.length} de ${r.items.length} itens`}
              </p>
            )}
            {r.responsavelStatus && <p>Em análise por: {r.responsavelStatus}</p>}
          </div>
        </div>

        <div className="mb-3" onClick={(e) => e.stopPropagation()}>
          <select
            value={r.status}
            disabled={travadaPorOutro}
            onChange={(e) => handleStatusChange(r, e.target.value as QuoteStatus)}
            className={`field-input text-xs py-1.5 ${travadaPorOutro ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={travadaPorOutro ? `Em análise por ${r.responsavelStatus} — só ele(a) pode mudar` : undefined}
          >
            <OpcoesDeStatus tipo="cotacoes" atual={r.status} />
          </select>
        </div>

        <div onClick={() => onLoad(r)} className="cursor-pointer flex items-center justify-between border-t border-ink-100 pt-3">
          <div>
            <p className="text-[11px] text-ink-400">Total da cotação</p>
            <p className="font-mono font-semibold text-ink-900 tabular-nums">{formatCurrency(r.summary.precoVendaTotalGeral)}</p>
          </div>
          <div className="text-right">
            <span className={`text-[11px] text-ink-400 ${travadaPorOutro ? '' : 'group-hover:hidden'}`}>
              {formatDate(r.updatedAt)}
            </span>
            {!travadaPorOutro && (
              <span
                onClick={(e) => handleDelete(r.id, e)}
                className="hidden group-hover:inline text-[11px] font-medium text-rose-600 hover:text-rose-700"
              >
                Excluir cotação
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpandedId(expandido ? undefined : r.id)
          }}
          className="mt-2 text-[11px] font-medium text-ink-400 hover:text-ink-600"
        >
          {expandido ? 'Ocultar histórico de status' : 'Ver histórico de status'}
        </button>

        {expandido && (
          <ul className="mt-2 space-y-1 border-t border-ink-100 pt-2">
            {r.statusHistory.map((h, i) => (
              <li key={i} className="flex items-center justify-between text-[11px] text-ink-500">
                <span>
                  {nomeDoStatus(h.status)}
                  {h.por && <span className="text-ink-400"> · {h.por}</span>}
                </span>
                <span>{formatDate(h.changedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // decide o que mostrar abaixo da busca/pastas
  let conteudo: JSX.Element
  let vazio = false

  if (buscando) {
    vazio = resultadoBusca.length === 0
    conteudo = <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{resultadoBusca.map(renderCard)}</div>
  } else if (verTudo) {
    vazio = records.length === 0
    conteudo = <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{records.map(renderCard)}</div>
  } else if (!adminSel) {
    conteudo = (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FolderCard label="Ver todas as cotações" count={records.length} onClick={() => setVerTudo(true)} />
        {ADMINS.map((nome) => (
          <FolderCard
            key={nome}
            label={nome}
            count={records.filter((r) => r.criadoPor === nome).length}
            onClick={() => abrirAdmin(nome)}
          />
        ))}
      </div>
    )
  } else if (!vendedorSel) {
    conteudo = (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {VENDEDORES.map((nome) => (
          <FolderCard
            key={nome}
            label={nome}
            count={porAdmin.filter((r) => r.vendedor === nome).length}
            onClick={() => abrirVendedor(nome)}
          />
        ))}
      </div>
    )
  } else if (!mesSel) {
    vazio = mesesDisponiveis.length === 0
    conteudo = (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {mesesDisponiveis.map((chave) => (
          <FolderCard
            key={chave}
            label={labelMes(chave)}
            count={porVendedor.filter((r) => chaveMes(r.createdAt) === chave).length}
            onClick={() => setMesSel(chave)}
          />
        ))}
      </div>
    )
  } else {
    vazio = porMes.length === 0
    conteudo = <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{porMes.map(renderCard)}</div>
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-4">Histórico</h2>

        {!buscando && (verTudo || adminSel) && (
          <div className="flex flex-wrap items-center gap-1 mb-4 text-sm">
            <button type="button" onClick={voltarParaAdmins} className="text-ink-500 hover:text-ink-800 font-medium">
              ← Voltar
            </button>
            <span className="text-ink-300 mx-1">|</span>
            {verTudo ? (
              <span className="text-ink-600">Todas as cotações</span>
            ) : (
              <>
                <button type="button" onClick={voltarParaAdmins} className="text-ink-500 hover:text-ink-800">
                  {adminSel}
                </button>
                {vendedorSel && (
                  <>
                    <span className="text-ink-300">/</span>
                    <button type="button" onClick={voltarParaVendedores} className="text-ink-500 hover:text-ink-800">
                      {vendedorSel}
                    </button>
                  </>
                )}
                {mesSel && (
                  <>
                    <span className="text-ink-300">/</span>
                    <button type="button" onClick={voltarParaMeses} className="text-ink-500 hover:text-ink-800">
                      {labelMes(mesSel)}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <input
          type="text"
          className="field-input max-w-sm"
          placeholder="Buscar por cliente, máquina, referência, descrição, fornecedor, marca ou NCM…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {buscando && <p className="text-xs text-ink-400 mt-2">A busca olha em todas as pastas, não só na atual.</p>}
      </div>

      {loading ? (
        <div className="card text-center text-sm text-ink-400 py-10">Carregando…</div>
      ) : vazio ? (
        <div className="card text-center py-12">
          <h3 className="font-display font-semibold text-ink-800 mb-1">
            {records.length === 0 ? 'Nenhuma cotação salva ainda' : 'Nada encontrado'}
          </h3>
          <p className="text-sm text-ink-400">
            {records.length === 0 ? 'Crie uma cotação na aba Cotações para vê-la aqui.' : 'Tente outro termo de busca ou outra pasta.'}
          </p>
        </div>
      ) : (
        conteudo
      )}

      {pedidoModalRecord && (
        <PedidoCompraModal
          quote={pedidoModalRecord}
          onConfirm={handleConfirmPedidoCompra}
          onCancel={() => setPedidoModalRecord(undefined)}
        />
      )}
    </div>
  )
}
