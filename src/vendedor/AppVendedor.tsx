import { useCallback, useEffect, useMemo, useState } from 'react'
import { sair } from '../auth'
import { DialogHost } from '../components/DialogHost'
import { MinhaContaModal } from '../components/MinhaContaModal'
import { getStatusColors } from '../db/configRepo'
import { avisar } from '../dialogs'
import { carregarStatusConfig, nomeDoStatus, ordemComExtras, statusDe, useVersaoStatus } from '../statusConfig'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { formatCurrency, formatDate, makeId } from '../utils'
import type { UsuarioLogado } from '../sessaoUsuario'
import {
  listarMinhasCotacoes,
  salvarMinhaCotacao,
  type CotacaoDoVendedor,
  type DadosDaCotacaoDoVendedor,
  type ItemPedido,
} from './cotacaoDoVendedor'

// O site do vendedor: só as cotações que estão no nome dele. Ele registra a cotação (cliente, máquina,
// os itens), acompanha o andamento e, depois que a cotação foi enviada, vê os valores que mandamos.
// Pode alterar as dele: cada alteração fica registrada na cotação e quem está cotando é avisado (o
// servidor é quem registra e quem filtra — ver "vendedores" no server.js).

const INTERVALO_BUSCA_MS = 5 * 60 * 1000

const textoBusca = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** "AAAA-MM-DD" ↔ data (meio-dia, pra nenhum fuso trocar o dia). */
function dataParaCampo(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function campoParaData(valor: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime() : undefined
}
const diaBR = (iso: string) => iso.split('-').reverse().join('/')

const itemVazio = (): ItemPedido => ({ id: makeId(), interno: '', referencia: '', descricao: '', quantidade: 1 })
const itemTemDados = (i: ItemPedido) => !!(i.interno.trim() || i.referencia.trim() || i.descricao.trim())

/** O mesmo que já estava (com a limpeza que o servidor faz: espaços e o dia da data)? */
function semMudanca(c: CotacaoDoVendedor, d: DadosDaCotacaoDoVendedor): boolean {
  const t = (s: string) => s.replace(/\s+/g, ' ').trim()
  const itens = (lista: ItemPedido[]) =>
    JSON.stringify(lista.filter(itemTemDados).map((i) => [i.id, t(i.interno), t(i.referencia), t(i.descricao), Number(i.quantidade) || 0]))
  return (
    t(c.cliente) === t(d.cliente) &&
    t(c.maquina) === t(d.maquina) &&
    c.observacao.trim() === d.observacao.trim() &&
    dataParaCampo(c.dataSolicitacao) === dataParaCampo(d.dataSolicitacao) &&
    itens(c.itensPreRegistro) === itens(d.itensPreRegistro)
  )
}

export function AppVendedor({ usuario }: { usuario: UsuarioLogado }) {
  const [cotacoes, setCotacoes] = useState<CotacaoDoVendedor[] | null>(null)
  const [cores, setCores] = useState<Record<string, string>>({})
  const [editando, setEditando] = useState<CotacaoDoVendedor | 'nova' | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [mostrarMinhaConta, setMostrarMinhaConta] = useState(false)
  useVersaoStatus()

  const recarregar = useCallback(async () => {
    try {
      setCotacoes(await listarMinhasCotacoes())
    } catch (err) {
      setCotacoes((atual) => atual ?? [])
      void avisar(err instanceof Error ? err.message : 'Erro ao carregar as cotações.')
    }
  }, [])

  useEffect(() => {
    void recarregar()
    carregarStatusConfig().catch(() => {})
    getStatusColors()
      .then(setCores)
      .catch(() => {})
    const intervalo = window.setInterval(() => void recarregar(), INTERVALO_BUSCA_MS)
    const aoFocar = () => void recarregar()
    window.addEventListener('focus', aoFocar)
    return () => {
      window.clearInterval(intervalo)
      window.removeEventListener('focus', aoFocar)
    }
  }, [recarregar])

  const corDoStatus = (status: string) => cores[status] || corPadraoDoStatus(status, statusDe('cotacoes'))

  const filtradas = useMemo(() => {
    const termos = textoBusca(busca).split(/\s+/).filter(Boolean)
    return (cotacoes ?? []).filter((c) => {
      if (filtroStatus && c.status !== filtroStatus) return false
      const texto = textoBusca(`${c.codigo} ${c.cliente} ${c.maquina}`)
      return termos.every((t) => texto.includes(t))
    })
  }, [cotacoes, busca, filtroStatus])

  const statusPresentes = ordemComExtras('cotacoes', (cotacoes ?? []).map((c) => c.status)).filter((s) => (cotacoes ?? []).some((c) => c.status === s))

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo-archonix.png`} alt="" className="h-8 w-8 object-contain dark:invert" />
          <div>
            <p className="font-display text-base font-semibold text-ink-900">Minhas cotações</p>
            <p className="text-xs text-ink-500">
              {usuario.exibicao} · vendedor {usuario.vendedor}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setMostrarMinhaConta(true)} className="text-xs text-ink-500 underline hover:text-ink-700">
            Minha conta
          </button>
          <button type="button" onClick={() => void sair()} className="text-xs text-ink-500 underline hover:text-ink-700">
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {editando ? (
          <FormularioCotacao
            cotacao={editando === 'nova' ? undefined : editando}
            onCancelar={() => setEditando(null)}
            onSalva={async (mensagem) => {
              setEditando(null)
              await recarregar()
              void avisar(mensagem)
            }}
          />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={() => setEditando('nova')}
              className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-surface transition hover:opacity-90"
            >
              + Nova cotação
            </button>
            <label className="min-w-[12rem] flex-1">
              <span className="field-label">Buscar</span>
              <input
                className="field-input"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Código, cliente ou máquina"
                aria-label="Buscar nas minhas cotações"
              />
            </label>
            <label>
              <span className="field-label">Status</span>
              <select className="field-input w-auto" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Filtrar pelo status">
                <option value="">Todos</option>
                {statusPresentes.map((s) => (
                  <option key={s} value={s}>
                    {nomeDoStatus(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {cotacoes === null ? (
          <p className="py-10 text-center text-sm text-ink-400">Carregando…</p>
        ) : filtradas.length === 0 ? (
          <p className="card py-10 text-center text-sm text-ink-400">
            {cotacoes.length === 0 ? 'Nenhuma cotação no seu nome ainda. Clique em "+ Nova cotação" pra registrar a primeira.' : 'Nenhuma cotação com esse filtro.'}
          </p>
        ) : (
          <div className="space-y-2" aria-label="Lista das minhas cotações">
            {filtradas.map((c) => (
              <CartaoCotacao key={c.id} c={c} cor={corDoStatus(c.status)} corDoStatus={corDoStatus} onEditar={editando ? undefined : () => setEditando(c)} />
            ))}
          </div>
        )}
      </main>
      {mostrarMinhaConta && <MinhaContaModal usuario={usuario} onFechar={() => setMostrarMinhaConta(false)} />}
      <DialogHost />
    </div>
  )
}

function SeloStatus({ status, cor }: { status: string; cor: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: cor, color: corTexto(cor) }}>
      {nomeDoStatus(status)}
    </span>
  )
}

function CartaoCotacao({
  c,
  cor,
  corDoStatus,
  onEditar,
}: {
  c: CotacaoDoVendedor
  cor: string
  corDoStatus: (status: string) => string
  onEditar?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const v = c.valoresEnviados
  const itensPedidos = c.itensPreRegistro.length > 0 ? c.itensPreRegistro : c.itensDaCotacao
  const producao = [...new Set(c.previsoesDeProducao)].sort()
  const previsoesEntrega = [...new Set(c.entregas.filter((e) => !e.entregueEm && e.previsaoEntrega).map((e) => e.previsaoEntrega))].sort()
  const entregue = c.entregas.length > 0 && c.entregas.every((e) => e.entregueEm)

  return (
    <article className="card !p-0" aria-label={`Cotação ${c.codigo}`}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <span aria-hidden className={`text-ink-400 transition-transform ${aberto ? 'rotate-90' : ''}`}>
          ▸
        </span>
        <span className="font-mono text-sm text-ink-500">{c.codigo || '—'}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
          {c.cliente || '(sem cliente)'}
          {c.maquina && <span className="font-normal text-ink-500"> · {c.maquina}</span>}
        </span>
        <SeloStatus status={c.status} cor={cor} />
        <span className="text-xs text-ink-400">
          {c.status !== 'PENDENTE' && c.responsavelStatus ? `com ${c.responsavelStatus} · ` : ''}
          {formatDate(c.createdAt).slice(0, 10)}
        </span>
        <span className="w-full text-right text-sm font-mono tabular-nums text-ink-800 sm:w-auto">{v ? formatCurrency(v.total) : ''}</span>
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-ink-100 px-4 pb-4 pt-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Dado rotulo="Registrada em" valor={formatDate(c.createdAt)} />
            <Dado rotulo="Pedido do cliente em" valor={c.dataSolicitacao ? formatDate(c.dataSolicitacao).slice(0, 10) : '—'} />
            <Dado rotulo="Quem está cotando" valor={c.status !== 'PENDENTE' && c.responsavelStatus ? c.responsavelStatus : 'ainda ninguém'} />
            <Dado rotulo="Registrada por" valor={c.criadoPor || '—'} />
          </div>
          {c.observacao && (
            <div>
              <p className="field-label">Observação</p>
              <p className="whitespace-pre-wrap text-ink-700">{c.observacao}</p>
            </div>
          )}

          <section aria-label="Valores">
            <p className="field-label">Valores</p>
            {v ? (
              <>
                <div className="overflow-x-auto rounded-lg border border-ink-100">
                  <table className="w-full text-xs">
                    <thead className="bg-ink-50 text-left text-ink-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Referência</th>
                        <th className="px-2 py-1.5 font-medium">Descrição</th>
                        <th className="px-2 py-1.5 font-medium">Marca</th>
                        <th className="px-2 py-1.5 font-medium">Entrega</th>
                        <th className="px-2 py-1.5 text-right font-medium">Qtd</th>
                        <th className="px-2 py-1.5 text-right font-medium">Vlr unt</th>
                        <th className="px-2 py-1.5 text-right font-medium">Vlr total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {v.itens.map((i, n) => (
                        <tr key={n}>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{i.referencia || '—'}</td>
                          <td className="px-2 py-1.5">{i.descricao}</td>
                          <td className="px-2 py-1.5">{i.marca}</td>
                          <td className="px-2 py-1.5">{i.entrega}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{i.quantidade}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(i.valorUnitario)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(i.valorTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-ink-200 font-semibold">
                        <td colSpan={6} className="px-2 py-1.5 text-right">
                          Total
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(v.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  Enviada em {formatDate(v.enviadoEm)} por {v.enviadoPor}
                  {v.atualizadoEm ? ` · valores atualizados em ${formatDate(v.atualizadoEm)} por ${v.atualizadoPor}` : ''}
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-400">Os valores aparecem aqui quando a cotação for enviada.</p>
            )}
          </section>

          <section aria-label="Itens pedidos">
            <p className="field-label">Itens pedidos ({itensPedidos.length})</p>
            {itensPedidos.length === 0 ? (
              <p className="text-xs text-ink-400">Nenhum item.</p>
            ) : (
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100 text-xs">
                {itensPedidos.map((i, n) => (
                  <li key={n} className="flex flex-wrap gap-x-3 px-2 py-1.5">
                    <span className="font-mono text-ink-600">{i.referencia || i.interno || '—'}</span>
                    <span className="min-w-0 flex-1 text-ink-800">{i.descricao}</span>
                    <span className="tabular-nums text-ink-600">qtd {i.quantidade}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Andamento">
            <p className="field-label">Andamento</p>
            <ol className="space-y-1">
              {c.statusHistory.map((h, n) => (
                <li key={n} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 text-ink-400">{formatDate(h.changedAt)}</span>
                  <SeloStatus status={h.status} cor={corDoStatus(h.status)} />
                </li>
              ))}
            </ol>
            {(producao.length > 0 || previsoesEntrega.length > 0 || entregue) && (
              <p className="mt-2 text-xs text-ink-600">
                {producao.length > 0 && `Produção prevista pra ${producao.map(diaBR).join(', ')}. `}
                {previsoesEntrega.length > 0 && `Entrega prevista pra ${previsoesEntrega.map(diaBR).join(', ')}. `}
                {entregue && 'Mercadoria entregue.'}
              </p>
            )}
          </section>

          {c.alteracoesVendedor.length > 0 && (
            <section aria-label="Minhas alterações">
              <p className="field-label">Alterações que você fez</p>
              <ul className="space-y-1.5 text-xs">
                {[...c.alteracoesVendedor].reverse().map((a) => (
                  <li key={a.id} className="rounded-lg bg-ink-50 px-2 py-1.5">
                    <span className="text-ink-400">{formatDate(a.em)}</span>
                    <ul className="mt-0.5 space-y-0.5">
                      {a.campos.map((campo, n) => (
                        <li key={n} className="text-ink-700">
                          <span className="font-medium">{campo.campo}:</span> {campo.antes || '—'} → {campo.depois || '—'}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {onEditar && (
            <button
              type="button"
              onClick={onEditar}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
            >
              Alterar esta cotação
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{rotulo}</p>
      <p className="text-ink-800">{valor}</p>
    </div>
  )
}

/** Registrar uma cotação nova ou alterar uma das minhas. */
function FormularioCotacao({
  cotacao,
  onCancelar,
  onSalva,
}: {
  cotacao?: CotacaoDoVendedor
  onCancelar: () => void
  onSalva: (mensagem: string) => Promise<void>
}) {
  const [cliente, setCliente] = useState(cotacao?.cliente ?? '')
  const [maquina, setMaquina] = useState(cotacao?.maquina ?? '')
  const [data, setData] = useState(dataParaCampo(cotacao?.dataSolicitacao ?? (cotacao ? undefined : Date.now())))
  const [observacao, setObservacao] = useState(cotacao?.observacao ?? '')
  const [itens, setItens] = useState<ItemPedido[]>(() => (cotacao && cotacao.itensPreRegistro.length > 0 ? cotacao.itensPreRegistro : [itemVazio()]))
  const [salvando, setSalvando] = useState(false)

  const mudarItem = (id: string, campo: Partial<ItemPedido>) => setItens((lista) => lista.map((i) => (i.id === id ? { ...i, ...campo } : i)))

  async function salvar() {
    if (!cliente.trim()) return void avisar('Informe o cliente.')
    const validos = itens.filter(itemTemDados)
    // (a cotação que a equipe lançou direto na precificação não tem itens pedidos — dá pra alterar o resto dela)
    if (!cotacao && validos.length === 0) return void avisar('Informe pelo menos um item (interno, referência ou descrição).')
    const dados = {
      id: cotacao?.id ?? makeId(),
      cliente: cliente.trim(),
      maquina: maquina.trim(),
      observacao: observacao.trim(),
      dataSolicitacao: campoParaData(data),
      itensPreRegistro: validos.map((i) => ({ ...i, quantidade: Number(i.quantidade) || 0 })),
    }
    if (cotacao && semMudanca(cotacao, dados)) {
      onCancelar()
      return void avisar('Nada foi alterado.')
    }
    setSalvando(true)
    try {
      await salvarMinhaCotacao(dados)
      await onSalva(
        cotacao
          ? `Alteração da ${cotacao.codigo} salva. Ela fica registrada na cotação e quem está cotando é avisado.`
          : 'Cotação registrada — ela já aparece pra equipe que cota.',
      )
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="card space-y-4" aria-label={cotacao ? `Alterar a cotação ${cotacao.codigo}` : 'Nova cotação'}>
      <div>
        <h2 className="font-display text-lg font-semibold text-ink-900">{cotacao ? `Alterar a ${cotacao.codigo}` : 'Nova cotação'}</h2>
        {cotacao && <p className="text-xs text-ink-500">O que você mudar fica registrado na cotação, e quem está cotando recebe um aviso.</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          <span className="field-label">Cliente</span>
          <input className="field-input" value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={200} />
        </label>
        <label>
          <span className="field-label">Máquina</span>
          <input className="field-input" value={maquina} onChange={(e) => setMaquina(e.target.value)} maxLength={200} />
        </label>
        <label>
          <span className="field-label">Data do pedido do cliente</span>
          <input type="date" className="field-input" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend className="field-label">Itens</legend>
        <div className="space-y-2">
          {itens.map((i, n) => (
            <div key={i.id} className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_10rem_1fr_6rem_auto]" aria-label={`Item ${n + 1}`}>
              <input className="field-input" placeholder="Interno" aria-label={`Interno do item ${n + 1}`} value={i.interno} onChange={(e) => mudarItem(i.id, { interno: e.target.value })} />
              <input
                className="field-input"
                placeholder="Referência"
                aria-label={`Referência do item ${n + 1}`}
                value={i.referencia}
                onChange={(e) => mudarItem(i.id, { referencia: e.target.value })}
              />
              <input
                className="field-input col-span-2 sm:col-span-1"
                placeholder="Descrição"
                aria-label={`Descrição do item ${n + 1}`}
                value={i.descricao}
                onChange={(e) => mudarItem(i.id, { descricao: e.target.value })}
              />
              <input
                type="number"
                min={0}
                step="any"
                className="field-input"
                aria-label={`Quantidade do item ${n + 1}`}
                value={i.quantidade}
                onChange={(e) => mudarItem(i.id, { quantidade: Number(e.target.value) })}
              />
              <button
                type="button"
                onClick={() => setItens((lista) => (lista.length > 1 ? lista.filter((x) => x.id !== i.id) : [itemVazio()]))}
                aria-label={`Tirar o item ${n + 1}`}
                className="rounded-lg px-2 text-sm text-rose-600 transition hover:bg-rose-50"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItens((lista) => [...lista, itemVazio()])}
          className="mt-2 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
        >
          + Item
        </button>
      </fieldset>

      <label className="block">
        <span className="field-label">Observação</span>
        <textarea className="field-input min-h-[4rem]" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={2000} />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={salvando}
          onClick={() => void salvar()}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-surface transition hover:opacity-90 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : cotacao ? 'Salvar alteração' : 'Registrar cotação'}
        </button>
        <button type="button" onClick={onCancelar} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 transition hover:bg-ink-100">
          Cancelar
        </button>
      </div>
    </section>
  )
}
