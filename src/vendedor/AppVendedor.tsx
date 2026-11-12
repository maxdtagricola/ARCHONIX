import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { dbGet } from '../db/db'
import { sair } from '../auth'
import { DialogHost } from '../components/DialogHost'
import { MinhaContaModal } from '../components/MinhaContaModal'
import { guardarMinutosDoVendedor } from '../components/SaidaAutomatica'
import { getStatusColors } from '../db/configRepo'
import { avisar } from '../dialogs'
import { BotaoTema } from '../components/BotaoTema'
import { BotaoNotificacoes } from '../components/NotificacoesDoSistema'
import { notificar } from '../notificacoesDoSistema'
import { caminhoSemVoltas, carregarStatusConfig, nomeDoStatus, ordemComExtras, statusDe, useVersaoStatus } from '../statusConfig'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { formatCurrency, formatDate, makeId } from '../utils'
import type { UsuarioLogado } from '../sessaoUsuario'
import {
  abrirAnexo,
  itensDaLista,
  listarCotacoesDoVendedor,
  listarMinhasCotacoes,
  podeAlterar,
  salvarMinhaCotacao,
  type ArquivoParaAnexar,
  type CotacaoDoVendedor,
  type DadosDaCotacaoDoVendedor,
  type ItemPedido,
  type ValoresParaOVendedor,
} from './cotacaoDoVendedor'
import { ImportarItens, type ResultadoImportacao } from './ImportarItens'
import type { FormatoDaCotacao } from './PlanilhaDoVendedor'
import { CONFIG_TELA_VENDEDOR_PADRAO, getConfigTelaVendedor, type ConfigTelaVendedor, type FormaDeImportar, type ParteDaTelaVendedor } from './telaVendedor'
import type { ItemValorEnviado } from '../types'

// O site do vendedor: só as cotações que estão no nome dele. Ele registra a cotação (cliente, máquina,
// os itens — digitados ou importados de planilha, foto/print, PDF ou texto), acompanha o andamento e,
// depois que a cotação foi enviada, vê os itens com marca, prazo e os valores que mandamos — em
// planilha ou em texto, pra mandar ao cliente. Pode alterar as dele (ali mesmo, no cartão) até antes
// do PEDIDO DE COMPRA: cada alteração fica registrada na cotação, quem está cotando é avisado e os
// itens entram na Precificação (o servidor é quem registra, filtra e trava — ver "vendedores" no
// server.js; itensDoVendedor.ts). O que aparece, o Max escolhe (telaVendedor.ts) — vendo esta mesma
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

// "valores novos": a versão dos valores de cada cotação que ele já abriu, guardada no aparelho
const chaveDosVistos = (login: string) => `vendedor:valoresVistos:${login}`
const versaoDosValores = (v?: ValoresParaOVendedor) => (v ? (v.versao ?? `${v.total}|${v.atualizada ? 1 : 0}`) : '')
function lerVistos(login: string): Record<string, string> | null {
  try {
    const texto = localStorage.getItem(chaveDosVistos(login))
    return texto ? (JSON.parse(texto) as Record<string, string>) : null
  } catch {
    return null
  }
}
function gravarVistos(login: string, vistos: Record<string, string>) {
  try {
    localStorage.setItem(chaveDosVistos(login), JSON.stringify(vistos))
  } catch {
    // sem armazenamento: o aviso volta na próxima vez, nada de mais
  }
}

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
    itens(itensDaLista(c)) === itens(d.itensPreRegistro)
  )
}

const codigoComparavel = (s: string) => s.replace(/[\s.-]+/g, '').toUpperCase()

/** O valor enviado de um item da lista dele: pelo id do item ou, nos enviados antes de ter id, pelo código. */
function valorDoItem(valores: ValoresParaOVendedor, i: ItemPedido): ItemValorEnviado | undefined {
  const codigo = codigoComparavel(i.referencia || i.interno)
  return valores.itens.find((v) => v.id === i.id) ?? (codigo ? valores.itens.find((v) => !v.id && codigoComparavel(v.referencia) === codigo) : undefined)
}

/** A lista dele mudou depois do envio (os valores que ele vê são de outra lista)? */
function mudouDepoisDoEnvio(lista: ItemPedido[], valores: ValoresParaOVendedor): boolean {
  const chaves = (xs: { referencia: string; interno?: string; descricao: string; quantidade: number }[]) =>
    xs
      .filter((i) => i.referencia || i.interno || i.descricao)
      .map((i) => `${codigoComparavel(i.referencia || i.interno || i.descricao)}|${i.quantidade}`)
      .sort()
      .join(',')
  return chaves(lista) !== chaves(valores.itens)
}

export function AppVendedor({ usuario, previa }: { usuario: UsuarioLogado; previa?: PreviaDaTela }) {
  const [cotacoes, setCotacoes] = useState<CotacaoDoVendedor[] | null>(null)
  const [cores, setCores] = useState<Record<string, string>>({})
  const [novaAberta, setNovaAberta] = useState(false)
  // a cotação sendo alterada (o formulário abre no próprio cartão dela)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [mostrarMinhaConta, setMostrarMinhaConta] = useState(false)
  const [configSalva, setConfigSalva] = useState<ConfigTelaVendedor>(CONFIG_TELA_VENDEDOR_PADRAO)
  useVersaoStatus()
  const config = previa?.config ?? configSalva
  const vendedor = previa?.vendedor ?? usuario.vendedor ?? ''
  const ehPrevia = !!previa

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
    // a dele (Usuários › Permissões) ou a de todos; servidor de antes desta configuração: recusa ler —
    // fica o padrão (pode tudo, aparece tudo)
    getConfigTelaVendedor(vendedor)
      .then((c) => {
        setConfigSalva(c)
        // o tempo da saída automática dele (na visualização do Max, não mexe no do Max)
        if (!ehPrevia) guardarMinutosDoVendedor(c.minutosSaida)
      })
      .catch(() => {})
    const intervalo = window.setInterval(() => void recarregar(), INTERVALO_BUSCA_MS)
    const aoFocar = () => void recarregar()
    window.addEventListener('focus', aoFocar)
    return () => {
      window.clearInterval(intervalo)
      window.removeEventListener('focus', aoFocar)
    }
  }, [recarregar, vendedor, ehPrevia])

  // na primeira vez neste aparelho, o que já estava lá não conta como novo
  const [vistos, setVistos] = useState<Record<string, string> | null>(() => (previa ? {} : lerVistos(usuario.login)))
  useEffect(() => {
    if (previa || vistos !== null || cotacoes === null) return
    const iniciais = Object.fromEntries(cotacoes.filter((c) => c.valoresEnviados).map((c) => [c.id, versaoDosValores(c.valoresEnviados)]))
    gravarVistos(usuario.login, iniciais)
    setVistos(iniciais)
  }, [previa, vistos, cotacoes, usuario.login])
  const comValoresNovos = useMemo(
    () => (previa || !vistos ? [] : (cotacoes ?? []).filter((c) => c.valoresEnviados && vistos[c.id] !== versaoDosValores(c.valoresEnviados))),
    [previa, vistos, cotacoes],
  )
  // também no canto da tela do sistema (se ele ligou o sino do topo): um aviso por envio novo; clicar
  // traz o site pra frente, já no cartão da cotação
  useEffect(() => {
    for (const c of comValoresNovos) {
      notificar(`valores:${c.id}:${versaoDosValores(c.valoresEnviados)}`, {
        titulo: `Chegaram os valores da ${c.codigo}`,
        texto: `${c.cliente}${c.maquina ? ` · ${c.maquina}` : ''} — marca, prazo e valores de venda. Abra a cotação pra ver e mandar ao cliente.`,
        etiqueta: `valores:${c.id}`,
        aoClicar: () => document.querySelector(`article[aria-label="Cotação ${c.codigo}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      })
    }
  }, [comValoresNovos])
  function marcarVisto(c: CotacaoDoVendedor) {
    if (previa || !vistos || !c.valoresEnviados || vistos[c.id] === versaoDosValores(c.valoresEnviados)) return
    const novos = { ...vistos, [c.id]: versaoDosValores(c.valoresEnviados) }
    gravarVistos(usuario.login, novos)
    setVistos(novos)
  }

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
            {/* os valores novos também no canto da tela do sistema — vale só neste aparelho */}
            <BotaoNotificacoes />
            {/* o mesmo modo claro/escuro do menu da equipe — vale só neste aparelho */}
            <BotaoTema />
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
        {comValoresNovos.length > 0 && (
          <p role="status" aria-label="Valores novos" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {comValoresNovos.length === 1 ? 'Chegaram os valores da ' : 'Chegaram valores da equipe: '}
            <span className="font-semibold">{comValoresNovos.map((c) => c.codigo).join(', ')}</span>
            {comValoresNovos.length === 1 ? '.' : ''} Abra a cotação pra ver os itens com marca, prazo e valores, a planilha e o texto pro cliente.
          </p>
        )}
        {novaAberta ? (
          <FormularioCotacao
            formas={config.importar}
            previa={!!previa}
            onCancelar={() => setNovaAberta(false)}
            onSalva={async (mensagem) => {
              setNovaAberta(false)
              await recarregar()
              void avisar(mensagem)
            }}
          />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            {/* registrar cotação nova: só se o Max liberou (o servidor também confere) */}
            {config.pode.registrar && (
              <button
                type="button"
                disabled={!!editandoId}
                title={editandoId ? 'Salve ou cancele a alteração aberta antes' : undefined}
                onClick={() => setNovaAberta(true)}
                className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-surface transition hover:opacity-90 disabled:opacity-50"
              >
                + Nova cotação
              </button>
            )}
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
            {cotacoes.length > 0
              ? 'Nenhuma cotação com esse filtro.'
              : config.pode.registrar
                ? 'Nenhuma cotação no seu nome ainda. Clique em "+ Nova cotação" pra registrar a primeira.'
                : 'Nenhuma cotação no seu nome ainda.'}
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
                liberadoAlterar={config.pode.alterar}
                novo={comValoresNovos.includes(c)}
                onAbrir={() => marcarVisto(c)}
                onEditar={editandoId || novaAberta ? undefined : () => setEditandoId(c.id)}
                formulario={
                  editandoId === c.id ? (
                    <FormularioCotacao
                      cotacao={c}
                      formas={config.importar}
                      previa={!!previa}
                      valores={config.partes.valores ? c.valoresEnviados : undefined}
                      embutido
                      onCancelar={() => setEditandoId(null)}
                      onSalva={async (mensagem) => {
                        setEditandoId(null)
                        await recarregar()
                        void avisar(mensagem)
                      }}
                    />
                  ) : undefined
                }
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
  liberadoAlterar = true,
  novo = false,
  onAbrir,
  onEditar,
  formulario,
}: {
  c: CotacaoDoVendedor
  cor: string
  corDoStatus: (status: string) => string
  /** O que o Max escolheu mostrar (telaVendedor.ts). */
  partes: Record<ParteDaTelaVendedor, boolean>
  /** O Max deixa ele alterar as cotações (telaVendedor.ts, `pode.alterar`). */
  liberadoAlterar?: boolean
  /** Chegaram valores (novos) que ele ainda não abriu. */
  novo?: boolean
  /** Abriu o cartão (os valores contam como vistos). */
  onAbrir?: () => void
  onEditar?: () => void
  /** Sendo alterada: o formulário aparece aqui, no lugar dos detalhes. */
  formulario?: ReactNode
}) {
  const [abertoAgora, setAberto] = useState(false)
  const aberto = abertoAgora || !!formulario
  const [janela, setJanela] = useState<{ formato?: FormatoDaCotacao } | null>(null)
  const v = partes.valores ? c.valoresEnviados : undefined
  const anexos = c.anexosVendedor ?? []
  // só pra frente: as voltas (de ANALISANDO VALORES pra AGUARDANDO FORNECEDOR, por exemplo) não aparecem
  // pra ele — o servidor já manda assim; aqui vale pros servidores de antes
  const andamento = caminhoSemVoltas([...c.statusHistory.map((h) => h.status), c.status])
  const itensPedidos = itensDaLista(c)
  const mudouDepois = !!v && partes.itens && mudouDepoisDoEnvio(itensPedidos, v)
  const producao = [...new Set(c.previsoesDeProducao)].sort()
  const previsoesEntrega = [...new Set(c.entregas.filter((e) => !e.entregueEm && e.previsaoEntrega).map((e) => e.previsaoEntrega))].sort()
  const entregue = c.entregas.length > 0 && c.entregas.every((e) => e.entregueEm)

  return (
    <article className="card !p-0" aria-label={`Cotação ${c.codigo}`}>
      <button
        type="button"
        onClick={() => {
          if (formulario) return
          setAberto((a) => !a)
          onAbrir?.()
        }}
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
        {novo && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">valores novos</span>}
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
          {formulario}
          {!formulario && (
          <>
          {c.observacao && (
            <div>
              <p className="field-label">Observação</p>
              <p className="whitespace-pre-wrap text-ink-700">{c.observacao}</p>
            </div>
          )}

          {(partes.itens || v) && (
          <section aria-label="Itens">
            <p className="field-label">{v ? `Itens com marca, prazo e valores de venda (${v.itens.length})` : `Itens pedidos (${itensPedidos.length})`}</p>
            {(v ? v.itens.length : itensPedidos.length) === 0 ? (
              <p className="text-xs text-ink-400">Nenhum item.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ink-100">
                <table className="w-full text-xs">
                  <thead className="bg-ink-50 text-left text-ink-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Código</th>
                      <th className="px-2 py-1.5 font-medium">Descrição</th>
                      {v && <th className="px-2 py-1.5 font-medium">Marca</th>}
                      {v && <th className="px-2 py-1.5 font-medium">Prazo</th>}
                      <th className="px-2 py-1.5 text-right font-medium">Qtd</th>
                      {v && <th className="px-2 py-1.5 text-right font-medium">Vlr unt</th>}
                      {v && <th className="px-2 py-1.5 text-right font-medium">Vlr total</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {v
                      ? v.itens.map((i, n) => (
                          <tr key={n}>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono">{i.referencia || '—'}</td>
                            <td className="px-2 py-1.5">{i.descricao}</td>
                            <td className="px-2 py-1.5">{i.marca || '—'}</td>
                            <td className="px-2 py-1.5">{i.entrega || '—'}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{i.quantidade}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(i.valorUnitario)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(i.valorTotal)}</td>
                          </tr>
                        ))
                      : itensPedidos.map((i, n) => (
                          <tr key={n}>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono text-ink-600">{i.referencia || i.interno || '—'}</td>
                            <td className="px-2 py-1.5 text-ink-800">{i.descricao}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink-600">{i.quantidade}</td>
                          </tr>
                        ))}
                  </tbody>
                  {v && (
                    <tfoot>
                      <tr className="border-t border-ink-200 font-semibold">
                        <td colSpan={6} className="px-2 py-1.5 text-right">
                          Total
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(v.total)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
            {v ? (
              <>
                {/* quando foi enviada (e quando mudou) não aparece pro vendedor — só se os valores foram atualizados */}
                <p className="mt-1 text-xs text-ink-400">
                  Valores que a equipe enviou{v.atualizada || v.atualizadoEm ? ' · valores atualizados pela equipe' : ''}
                </p>
                {mudouDepois && (
                  <details className="mt-1 text-xs text-amber-800">
                    <summary className="cursor-pointer">Os itens mudaram depois do envio: os valores acima são os do envio (a equipe já foi avisada).</summary>
                    <ul className="mt-1 space-y-0.5 text-ink-700" aria-label="Itens pedidos agora">
                      {itensPedidos.map((i, n) => (
                        <li key={n}>
                          <span className="font-mono">{i.referencia || i.interno || '—'}</span> {i.descricao} · qtd {i.quantidade}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setJanela({ formato: c.planilhaCliente ? 'cliente' : 'padrao' })}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
                  >
                    Ver em planilha
                  </button>
                  <button
                    type="button"
                    onClick={() => setJanela({ formato: 'texto' })}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
                  >
                    Ver em texto
                  </button>
                  <button
                    type="button"
                    onClick={() => setJanela({})}
                    className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90"
                  >
                    Compartilhar
                  </button>
                </div>
                {janela && (
                  <Suspense fallback={null}>
                    <PlanilhaDoVendedor c={c} valores={v} formatoInicial={janela.formato} onFechar={() => setJanela(null)} />
                  </Suspense>
                )}
              </>
            ) : (
              partes.valores && <p className="mt-1 text-xs text-ink-400">Marca, prazo e valores de venda aparecem aqui quando a cotação for enviada.</p>
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

          {/* do PEDIDO DE COMPRA em diante, só a equipe mexe (o servidor também recusa) */}
          {!liberadoAlterar ? (
            <p className="text-xs text-ink-500">🔒 Alterar as cotações não está liberado pra você. Se precisar mudar algo, fale com quem está cotando.</p>
          ) : !podeAlterar(c) ? (
            <p className="text-xs text-ink-500">🔒 A cotação já chegou ao Pedido de Compra: daqui em diante não dá mais pra alterar. Fale com quem está cotando.</p>
          ) : (
            onEditar && (
              <button
                type="button"
                onClick={onEditar}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
              >
                Alterar esta cotação
              </button>
            )
          )}
          </>
          )}
        </div>
      )}
    </article>
  )
}

/** Marca, prazo e valor que a equipe enviou pro item — embaixo da linha dele no formulário. */
function ValorDoItem({ valores, item, n }: { valores?: ValoresParaOVendedor; item: ItemPedido; n: number }) {
  if (!valores) return null
  const v = valorDoItem(valores, item)
  if (!v) {
    if (!itemTemDados(item)) return null
    return <p className="col-span-2 -mt-1 text-[11px] text-ink-400 sm:col-span-5">Sem valor enviado pra esse item ainda.</p>
  }
  return (
    <p className="col-span-2 -mt-1 text-[11px] text-ink-600 sm:col-span-5" aria-label={`Valor enviado do item ${n + 1}`}>
      Marca: {v.marca || '—'} · Prazo: {v.entrega || '—'} · {formatCurrency(v.valorUnitario)} cada · total {formatCurrency(v.valorTotal)}
    </p>
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

/** Registrar uma cotação nova ou alterar uma das minhas (no próprio cartão dela, com tudo que ela já tem). */
function FormularioCotacao({
  cotacao,
  formas,
  previa,
  valores,
  embutido = false,
  onCancelar,
  onSalva,
}: {
  cotacao?: CotacaoDoVendedor
  /** Como dá pra importar os itens (o Max escolhe). */
  formas: Record<FormaDeImportar, boolean>
  /** Visualização do Max: tudo funciona, mas nada é salvo. */
  previa: boolean
  /** Os valores enviados (marca, prazo e valor de cada item aparecem junto do item). */
  valores?: ValoresParaOVendedor
  /** Dentro do cartão da cotação (sem a moldura própria). */
  embutido?: boolean
  onCancelar: () => void
  onSalva: (mensagem: string) => Promise<void>
}) {
  const [cliente, setCliente] = useState(cotacao?.cliente ?? '')
  const [maquina, setMaquina] = useState(cotacao?.maquina ?? '')
  const [data, setData] = useState(dataParaCampo(cotacao?.dataSolicitacao ?? (cotacao ? undefined : Date.now())))
  const [observacao, setObservacao] = useState(cotacao?.observacao ?? '')
  // os itens que a cotação já tem — os que ele mandou ou os que a equipe lançou na precificação
  const [itens, setItens] = useState<ItemPedido[]>(() => {
    const atuais = cotacao ? itensDaLista(cotacao) : []
    return atuais.length > 0 ? atuais.map((i) => ({ ...i })) : [itemVazio()]
  })
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
    <section
      className={embutido ? 'space-y-4 rounded-lg border border-sky-200 bg-sky-50/40 p-3' : 'card space-y-4'}
      aria-label={cotacao ? `Alterar a cotação ${cotacao.codigo}` : 'Nova cotação'}
    >
      <div>
        <h2 className={`font-display font-semibold text-ink-900 ${embutido ? 'text-base' : 'text-lg'}`}>{cotacao ? `Alterando a ${cotacao.codigo}` : 'Nova cotação'}</h2>
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
              <ValorDoItem valores={valores} item={i} n={n} />
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
