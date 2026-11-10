import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { dbGet } from '../db/db'
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
  abrirAnexo,
  listarCotacoesDoVendedor,
  listarMinhasCotacoes,
  salvarMinhaCotacao,
  type ArquivoParaAnexar,
  type CotacaoDoVendedor,
  type DadosDaCotacaoDoVendedor,
  type ItemPedido,
} from './cotacaoDoVendedor'
import { ImportarItens, type ResultadoImportacao } from './ImportarItens'
import { CONFIG_TELA_VENDEDOR_PADRAO, getConfigTelaVendedor, type ConfigTelaVendedor, type FormaDeImportar, type ParteDaTelaVendedor } from './telaVendedor'

// O site do vendedor: só as cotações que estão no nome dele. Ele registra a cotação (cliente, máquina,
// os itens — digitados ou importados de planilha, foto/print, PDF ou texto), acompanha o andamento e,
// depois que a cotação foi enviada, vê os valores que mandamos. Pode alterar as dele: cada alteração
// fica registrada na cotação e quem está cotando é avisado (o servidor é quem registra e quem filtra —
// ver "vendedores" no server.js). O que aparece, o Max escolhe (telaVendedor.ts) — vendo esta mesma
// tela em `previa` (PreviaTelaVendedor), em que nada é salvo.

/** A tela vista pelo Max: as cotações de `vendedor` como ele vê, com a configuração sendo editada. */
export interface PreviaDaTela {
  vendedor: string
  config?: ConfigTelaVendedor
}

const MAX_BYTES_ENVIO = 14 * 1024 * 1024

// a planilha (e as bibliotecas de planilha) só vem quando o vendedor abre
const PlanilhaDoVendedor = lazy(() => import('./PlanilhaDoVendedor').then((m) => ({ default: m.PlanilhaDoVendedor })))

/** A planilha original do cliente, do jeito que veio. */
async function baixarPlanilhaOriginal(idCotacao: string, nomeArquivo: string) {
  try {
    const original = await dbGet<{ conteudoBase64: string }>('planilhasCliente', idCotacao, { semCache: true })
    if (!original) return void avisar('A planilha do cliente não foi encontrada no servidor.')
    const { baixarBlob, blobDoBase64 } = await import('../planilhaCliente')
    baixarBlob(blobDoBase64(original.conteudoBase64, nomeArquivo), nomeArquivo)
  } catch (err) {
    void avisar(err instanceof Error ? err.message : 'Não consegui baixar a planilha.')
  }
}

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

export function AppVendedor({ usuario, previa }: { usuario: UsuarioLogado; previa?: PreviaDaTela }) {
  const [cotacoes, setCotacoes] = useState<CotacaoDoVendedor[] | null>(null)
  const [cores, setCores] = useState<Record<string, string>>({})
  const [editando, setEditando] = useState<CotacaoDoVendedor | 'nova' | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [mostrarMinhaConta, setMostrarMinhaConta] = useState(false)
  const [configSalva, setConfigSalva] = useState<ConfigTelaVendedor>(CONFIG_TELA_VENDEDOR_PADRAO)
  useVersaoStatus()
  const config = previa?.config ?? configSalva
  const vendedor = previa?.vendedor ?? usuario.vendedor ?? ''

  const recarregar = useCallback(async () => {
    try {
      setCotacoes(await (previa ? listarCotacoesDoVendedor(previa.vendedor) : listarMinhasCotacoes()))
    } catch (err) {
      setCotacoes((atual) => atual ?? [])
      const naoAchou = err instanceof Error && err.message === 'not-found'
      void avisar(
        naoAchou && previa
          ? 'O servidor ainda não tem a visualização da tela dos vendedores — ela chega com a atualização do servidor (atualizar-servidor\\atualizar.cmd no PC 35).'
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar as cotações.',
      )
    }
  }, [previa?.vendedor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void recarregar()
    carregarStatusConfig().catch(() => {})
    getStatusColors()
      .then(setCores)
      .catch(() => {})
    // servidor de antes desta configuração: recusa ler — fica o padrão (tudo aparece)
    getConfigTelaVendedor()
      .then(setConfigSalva)
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
          <img src={`${import.meta.env.BASE_URL}logo-archonix.png`} alt="" className="h-12 w-auto dark:invert" />
          <div>
            <p className="font-display text-base font-semibold text-ink-900">Minhas cotações</p>
            <p className="text-xs text-ink-500">{previa ? `vendedor ${vendedor} · como ele vê` : `${usuario.exibicao} · vendedor ${vendedor}`}</p>
          </div>
        </div>
        {!previa && (
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setMostrarMinhaConta(true)} className="text-xs text-ink-500 underline hover:text-ink-700">
              Minha conta
            </button>
            <button type="button" onClick={() => void sair()} className="text-xs text-ink-500 underline hover:text-ink-700">
              Sair
            </button>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {config.mensagem.trim() && (
          <p role="note" aria-label="Recado para os vendedores" className="whitespace-pre-wrap rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {config.mensagem.trim()}
          </p>
        )}
        {editando ? (
          <FormularioCotacao
            cotacao={editando === 'nova' ? undefined : editando}
            formas={config.importar}
            previa={!!previa}
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
              <CartaoCotacao
                key={c.id}
                c={c}
                cor={corDoStatus(c.status)}
                corDoStatus={corDoStatus}
                partes={config.partes}
                onEditar={editando ? undefined : () => setEditando(c)}
              />
            ))}
          </div>
        )}
      </main>
      {/* na visualização do Max, as caixas de aviso são as do site dele */}
      {!previa && mostrarMinhaConta && <MinhaContaModal usuario={usuario} onFechar={() => setMostrarMinhaConta(false)} />}
      {!previa && <DialogHost />}
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
  partes,
  onEditar,
}: {
  c: CotacaoDoVendedor
  cor: string
  corDoStatus: (status: string) => string
  /** O que o Max escolheu mostrar (telaVendedor.ts). */
  partes: Record<ParteDaTelaVendedor, boolean>
  onEditar?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [planilhaAberta, setPlanilhaAberta] = useState(false)
  const v = partes.valores ? c.valoresEnviados : undefined
  const anexos = c.anexosVendedor ?? []
  // status repetidos em seguida (ida e volta registrada duas vezes) aparecem uma vez só
  const andamento = c.statusHistory.map((h) => h.status).filter((s, i, todos) => i === 0 || s !== todos[i - 1])
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
          {partes.quemCota && c.status !== 'PENDENTE' && c.responsavelStatus ? `com ${c.responsavelStatus} · ` : ''}
          {formatDate(c.createdAt).slice(0, 10)}
        </span>
        <span className="w-full text-right text-sm font-mono tabular-nums text-ink-800 sm:w-auto">{v ? formatCurrency(v.total) : ''}</span>
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-ink-100 px-4 pb-4 pt-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Dado rotulo="Registrada em" valor={formatDate(c.createdAt)} />
            <Dado rotulo="Pedido do cliente em" valor={c.dataSolicitacao ? formatDate(c.dataSolicitacao).slice(0, 10) : '—'} />
            {partes.quemCota && <Dado rotulo="Quem está cotando" valor={c.status !== 'PENDENTE' && c.responsavelStatus ? c.responsavelStatus : 'ainda ninguém'} />}
            <Dado rotulo="Registrada por" valor={c.criadoPor || '—'} />
          </div>
          {c.observacao && (
            <div>
              <p className="field-label">Observação</p>
              <p className="whitespace-pre-wrap text-ink-700">{c.observacao}</p>
            </div>
          )}

          {partes.valores && (
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
                {/* quando foi enviada (e quando mudou) não aparece pro vendedor — só se os valores foram atualizados */}
                <p className="mt-1 text-xs text-ink-400">
                  Valores que a equipe enviou{v.atualizada || v.atualizadoEm ? ' · valores atualizados pela equipe' : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPlanilhaAberta(true)}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
                  >
                    Ver em planilha
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlanilhaAberta(true)}
                    className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90"
                  >
                    Compartilhar
                  </button>
                </div>
                {planilhaAberta && (
                  <Suspense fallback={null}>
                    <PlanilhaDoVendedor c={c} valores={v} onFechar={() => setPlanilhaAberta(false)} />
                  </Suspense>
                )}
              </>
            ) : (
              <p className="text-xs text-ink-400">Os valores aparecem aqui quando a cotação for enviada.</p>
            )}
          </section>
          )}

          {partes.itens && (
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
          )}

          {(partes.andamento || partes.previsoes) && (
          <section aria-label="Andamento">
            <p className="field-label">Andamento</p>
            {/* só a sequência dos status, sem quando cada um mudou */}
            {partes.andamento && (
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="Status pelos quais a cotação passou">
              {andamento.map((status, n) => (
                <li key={n} className="flex items-center gap-1.5">
                  {n > 0 && (
                    <span aria-hidden className="text-ink-300">
                      →
                    </span>
                  )}
                  <SeloStatus status={status} cor={corDoStatus(status)} />
                </li>
              ))}
            </ol>
            )}
            {partes.previsoes && (producao.length > 0 || previsoesEntrega.length > 0 || entregue) && (
              <p className="mt-2 text-xs text-ink-600">
                {producao.length > 0 && `Produção prevista pra ${producao.map(diaBR).join(', ')}. `}
                {previsoesEntrega.length > 0 && `Entrega prevista pra ${previsoesEntrega.map(diaBR).join(', ')}. `}
                {entregue && 'Mercadoria entregue.'}
              </p>
            )}
            {!partes.andamento && partes.previsoes && producao.length === 0 && previsoesEntrega.length === 0 && !entregue && (
              <p className="text-xs text-ink-400">Ainda sem previsão.</p>
            )}
          </section>
          )}

          {partes.anexos && (anexos.length > 0 || c.planilhaCliente) && (
            <section aria-label="Arquivos da cotação">
              <p className="field-label">Arquivos da cotação</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {/* a planilha do cliente fica anexada como veio (a equipe preenche em cima dela) */}
                {c.planilhaCliente && (
                  <li>
                    <button
                      type="button"
                      onClick={() => void baixarPlanilhaOriginal(c.id, c.planilhaCliente!)}
                      className="rounded-lg border border-ink-200 px-2 py-1 text-ink-700 transition hover:bg-ink-50"
                    >
                      📊 Planilha do cliente (original): {c.planilhaCliente}
                    </button>
                  </li>
                )}
                {anexos.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => void abrirAnexo(c.id, a).catch((err) => avisar(err instanceof Error ? err.message : 'Não consegui abrir o arquivo.'))}
                      className="rounded-lg border border-ink-200 px-2 py-1 text-ink-700 transition hover:bg-ink-50"
                    >
                      {a.tipo === 'application/pdf' ? '📄' : '🖼'} {a.nome}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {partes.alteracoes && c.alteracoesVendedor.length > 0 && (
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
  formas,
  previa,
  onCancelar,
  onSalva,
}: {
  cotacao?: CotacaoDoVendedor
  /** Como dá pra importar os itens (o Max escolhe). */
  formas: Record<FormaDeImportar, boolean>
  /** Visualização do Max: tudo funciona, mas nada é salvo. */
  previa: boolean
  onCancelar: () => void
  onSalva: (mensagem: string) => Promise<void>
}) {
  const [cliente, setCliente] = useState(cotacao?.cliente ?? '')
  const [maquina, setMaquina] = useState(cotacao?.maquina ?? '')
  const [data, setData] = useState(dataParaCampo(cotacao?.dataSolicitacao ?? (cotacao ? undefined : Date.now())))
  const [observacao, setObservacao] = useState(cotacao?.observacao ?? '')
  const [itens, setItens] = useState<ItemPedido[]>(() => (cotacao && cotacao.itensPreRegistro.length > 0 ? cotacao.itensPreRegistro : [itemVazio()]))
  const [anexos, setAnexos] = useState<ArquivoParaAnexar[]>([])
  const [planilha, setPlanilha] = useState<{ nomeArquivo: string; conteudoBase64: string } | null>(null)
  const [importados, setImportados] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)

  const mudarItem = (id: string, campo: Partial<ItemPedido>) => setItens((lista) => lista.map((i) => (i.id === id ? { ...i, ...campo } : i)))

  function aoImportar(r: ResultadoImportacao) {
    const novos = r.itens.map((i) => ({ id: makeId(), interno: '', referencia: i.referencia, descricao: i.descricao, quantidade: i.quantidade }))
    // a linha em branco do começo dá lugar aos importados
    setItens((lista) => [...lista.filter(itemTemDados), ...novos].concat(lista.some(itemTemDados) || novos.length ? [] : [itemVazio()]))
    if (r.cliente && !cliente.trim()) setCliente(r.cliente)
    if (r.maquina && !maquina.trim()) setMaquina(r.maquina)
    if (r.anexo) setAnexos((lista) => [...lista, r.anexo!])
    if (r.planilha) setPlanilha(r.planilha)
    setImportados((lista) => [
      ...lista,
      `${r.itens.length === 1 ? '1 item lido' : `${r.itens.length} itens lidos`} de “${r.origem}”${r.itens.length === 0 ? ' — nenhum item reconhecido, digite abaixo' : ''}${r.aviso ? `. ${r.aviso}` : ''}`,
    ])
  }

  async function salvar() {
    if (!cliente.trim()) return void avisar('Informe o cliente.')
    const validos = itens.filter(itemTemDados)
    // (a cotação que a equipe lançou direto na precificação não tem itens pedidos — dá pra alterar o resto dela)
    if (!cotacao && validos.length === 0) return void avisar('Informe pelo menos um item (interno, referência ou descrição).')
    const dados: DadosDaCotacaoDoVendedor = {
      id: cotacao?.id ?? makeId(),
      cliente: cliente.trim(),
      maquina: maquina.trim(),
      observacao: observacao.trim(),
      dataSolicitacao: campoParaData(data),
      itensPreRegistro: validos.map((i) => ({ ...i, quantidade: Number(i.quantidade) || 0 })),
      ...(anexos.length ? { anexosNovos: anexos } : {}),
      ...(planilha ? { planilhaCliente: planilha } : {}),
    }
    if (cotacao && !anexos.length && !planilha && semMudanca(cotacao, dados)) {
      onCancelar()
      return void avisar('Nada foi alterado.')
    }
    if (previa) return void avisar('Na visualização, nada é salvo — é só pra ver como fica pro vendedor.')
    const tamanho = [...anexos.map((a) => a.conteudoBase64), planilha?.conteudoBase64 ?? ''].reduce((s, b) => s + b.length, 0)
    if (tamanho > MAX_BYTES_ENVIO) return void avisar('Os arquivos juntos passam do limite de envio. Tire algum e salve de novo (dá pra mandar o resto numa alteração).')
    setSalvando(true)
    try {
      const resposta = await salvarMinhaCotacao(dados)
      // servidor de antes dos anexos: salva os itens e ignora os arquivos
      const arquivosFicaram = !(anexos.length || planilha) || !resposta || resposta.anexosVendedor !== undefined
      await onSalva(
        (cotacao
          ? `Alteração da ${cotacao.codigo} salva. Ela fica registrada na cotação e quem está cotando é avisado.`
          : 'Cotação registrada — ela já aparece pra equipe que cota.') +
          (arquivosFicaram ? '' : '\n\nOs arquivos originais não foram guardados: o servidor ainda precisa da atualização.'),
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

      <ImportarItens formas={formas} onImportado={aoImportar} />
      {importados.length > 0 && (
        <ul role="status" aria-label="O que foi importado" className="space-y-0.5 text-xs text-ink-600">
          {importados.map((t, n) => (
            <li key={n}>✓ {t}</li>
          ))}
          <li className="text-ink-400">Confira a lista de itens abaixo antes de salvar.</li>
        </ul>
      )}
      {(anexos.length > 0 || planilha) && (
        <div aria-label="Arquivos que vão junto" className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-500">Vão junto com a cotação:</span>
          {planilha && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-ink-700">
              {planilha.nomeArquivo}
              <button type="button" aria-label={`Não mandar ${planilha.nomeArquivo}`} onClick={() => setPlanilha(null)} className="text-ink-400 hover:text-rose-600">
                ✕
              </button>
            </span>
          )}
          {anexos.map((a, n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-ink-700">
              {a.nome}
              <button
                type="button"
                aria-label={`Não mandar ${a.nome}`}
                onClick={() => setAnexos((lista) => lista.filter((_, i) => i !== n))}
                className="text-ink-400 hover:text-rose-600"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

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
