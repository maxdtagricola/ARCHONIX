import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { listQuotes, updateQuoteStatus } from '../db/analysesRepo'
import { PedidoCompraModal } from '../components/PedidoCompraModal'
import { avisar, pedirMotivoArquivamento } from '../dialogs'
import { DIAS_PARA_RETORNO, cotacoesEsperandoRetorno, diasDesdeOEnvio } from '../retornoCotacao'
import { ResumoTransporteDaCotacao, SelosPrevisao, previsaoDaCotacao, situacaoDaPrevisao } from '../components/TransporteFornecedor'
import { SeloProducao } from '../components/SeloProducao'
import { previsoesDeEntrega, previsoesDeProducao } from '../fornecedoresDoPedido'
import { itensDoPedidoDeCompra } from '../mudancaDeStatus'
import { getStatusColors } from '../db/configRepo'
import { listNotasFiscais } from '../db/notasFiscaisRepo'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { prejuizoAutomatico, valoresPorResultado } from '../notasFiscaisHelpers'
import { formatCurrency } from '../utils'
import { diasUteisDesde, textoDiasUteis, useVersaoFeriados } from '../diasUteis'
import { STATUS_DO_SISTEMA, nomeDoStatus, ordemComExtras, statusDe, type TipoStatus } from '../statusConfig'
import { estaACaminho, mercadoriaRecebida } from '../avisosEntrega'
import type { NotaFiscal, PedidoCompraInfo, QuoteRecord, QuoteStatus } from '../types'
import type { TabKey } from '../components/Layout'
import { useEstadoPersistente } from '../estadoPersistente'
import type { ParteTelaInicial } from '../telaInicialPorUsuario'

// -----------------------------------------------------------------------
// Tela Inicial — a fila de trabalho de quem cota: as pendentes (esperando
// alguém pegar), as que estão em andamento com o usuário, as que estão em
// transporte e o que a equipe fez por último. Os números e gráficos do
// período ficam no Dashboard. O que aparece pra cada um o Max escolhe em
// Configurações › Usuários (ver telaInicialPorUsuario.ts).
// -----------------------------------------------------------------------

/** A cotação já terminou (ENTREGUE em diante, ou ARQUIVO) — não aparece mais como trabalho em andamento. */
function terminou(status: QuoteStatus): boolean {
  return status === 'ARQUIVO' || mercadoriaRecebida(status)
}
/** Bloco EM ANDAMENTO: a cotação em si, depois de PENDENTE e antes de ENVIADO (AGUARDANDO FORNECEDOR,
 * ANALISANDO VALORES e os criados entre eles) — de ENVIADO em diante (resposta do cliente, pedido,
 * transporte…) já é outro processo; PENDENTE tem o bloco dela. */
function emAndamentoNaCotacao(status: QuoteStatus): boolean {
  const lista = statusDe('cotacoes')
  const i = lista.indexOf(status)
  return i > lista.indexOf('PENDENTE') && i < lista.indexOf('ENVIADO')
}
/** Bloco EM TRANSPORTE: o que está a caminho — inclusive o que já chegou só em parte (CADASTRO DE
 * PRODUTO fica de fora; os criados entre EM TRANSPORTE e ENTREGUE entram). */
function noBlocoEmTransporte(status: QuoteStatus): boolean {
  if (!estaACaminho(status)) return false
  return !STATUS_DO_SISTEMA.cotacoes.includes(status) || status === 'EM TRANSPORTE' || status === 'PARCIALMENTE ENTREGUE'
}
/** PENDENTE há mais dias úteis que isso fica marcado como atrasado. */
const DIAS_PENDENTE_ALERTA = 2
/** Produção com previsão de finalização a até esse tanto de dias úteis (ou já atrasada) vira aviso no topo. */
const DIAS_AVISO_PRODUCAO = 1
const ITENS_POR_BLOCO = 6

const DIA = 24 * 60 * 60 * 1000

function inicioDoDia(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Dias de calendário entre a data e hoje (0 = hoje, 1 = ontem). */
function diasDesde(ms: number, agora: number): number {
  return Math.round((inicioDoDia(agora) - inicioDoDia(ms)) / DIA)
}

function haQuanto(ms: number, agora: number): string {
  const minutos = Math.floor((agora - ms) / 60000)
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `há ${minutos} min`
  const dias = diasDesde(ms, agora)
  if (dias === 0) return `há ${Math.floor(minutos / 60)} h`
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}

/** Quando a cotação entrou no status em que está agora. */
function desdeStatusAtual(r: QuoteRecord): number {
  for (let i = r.statusHistory.length - 1; i >= 0; i--) {
    if (r.statusHistory[i].status === r.status) return r.statusHistory[i].changedAt
  }
  return r.createdAt
}

/** Quando o cliente pediu (ou, sem essa data, quando a cotação foi criada). */
function dataDoPedido(r: QuoteRecord): number {
  return r.dataSolicitacao ?? r.createdAt
}

/** "há 3 dias úteis" / "hoje" — fim de semana e feriado não contam (ver diasUteis.ts). */
function haDiasUteis(ms: number, agora: number): string {
  const dias = diasUteisDesde(ms, agora)
  return dias === 0 ? 'hoje' : `há ${textoDiasUteis(dias)}`
}

function saudacao(agora: number): string {
  const hora = new Date(agora).getHours()
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
}

interface Evento {
  chave: string
  quando: number
  cotacao: QuoteRecord
  texto: string
  quem: string
}

export function TelaInicialPage({
  nomeExibido,
  currentAdmin,
  cotacaoAberta,
  onOpenQuote,
  onNovaCotacao,
  onContinuar,
  onIrPara,
  podeVer,
  veFinanceiro,
  partes,
  onAbrirPedido,
}: {
  /** Nome de login (ex.: "MÁXIMUS"), pra saudação. */
  nomeExibido: string
  /** Como o app conhece o usuário (ex.: "Max") — é o responsável gravado nas cotações. */
  currentAdmin: string
  /** Cotação aberta agora na Precificação, se houver — vira o atalho "Continuar". */
  cotacaoAberta?: { codigo: string; cliente: string }
  onOpenQuote: (r: QuoteRecord) => void
  onNovaCotacao: (modo: 'manual' | 'importar') => void
  onContinuar: () => void
  onIrPara: (tab: TabKey) => void
  /** As abas do usuário — os atalhos e o bloco de Transferências só aparecem pra quem tem a aba. */
  podeVer: (tab: TabKey) => boolean
  /** Administrador: o aviso de prejuízo das transferências só aparece pra quem vê prejuízo e faturamento. */
  veFinanceiro: boolean
  /** As partes da Tela Inicial deste usuário; null = ainda chegando do servidor. */
  partes: ParteTelaInicial[] | null
  /** "Abrir pedido" na janela de transporte: Pedido de Compra com essa cotação aberta. */
  onAbrirPedido: (cotacaoId: string) => void
}) {
  const [cotacoes, setCotacoes] = useState<QuoteRecord[]>([])
  // "Fechou" no bloco de retorno do cliente: a mesma janela de sempre (pedido completo ou só alguns itens)
  const [pedidoDoRetorno, setPedidoDoRetorno] = useState<QuoteRecord | undefined>(undefined)
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [coresStatus, setCoresStatus] = useState<Record<string, string>>({})
  const [agora] = useState(() => Date.now())
  useVersaoFeriados()
  // clique num pedido EM TRANSPORTE: a mesma janela do Pedido de Compra (NF, transportadora, rastreio, previsão)
  const [transporteAbertoId, setTransporteAbertoId] = useState<string | undefined>(undefined)
  const transporteAberto = cotacoes.find((c) => c.id === transporteAbertoId)
  const ve = (parte: ParteTelaInicial) => !!partes?.includes(parte)
  const veTransferencias = podeVer('acompanhamentoNotas') && ve('transferencias')
  const veAlgumBloco = (['pendentes', 'emAndamento', 'emProducao', 'emTransporte', 'atividade'] as const).some(ve) || veTransferencias

  useEffect(() => {
    listQuotes()
      .then(setCotacoes)
      .catch((err) => setErro(err instanceof Error ? err.message : 'Erro ao carregar as cotações do servidor.'))
      .finally(() => setCarregando(false))
    getStatusColors()
      .then(setCoresStatus)
      .catch(() => {
        // cores customizadas são só um extra visual — sem elas, usa a paleta padrão
      })
    if (veTransferencias) {
      listNotasFiscais()
        .then(setNotas)
        .catch(() => {
          // o bloco de transferências é um extra — sem o servidor, ele só não aparece
        })
    }
  }, [veTransferencias])

  const hoje = inicioDoDia(agora)
  const blocos = useMemo(() => {
    const emAndamento = cotacoes.filter((r) => !terminou(r.status))
    const pendentes = emAndamento.filter((r) => r.status === 'PENDENTE').sort((a, b) => dataDoPedido(a) - dataDoPedido(b))
    const minhas = emAndamento
      .filter((r) => emAndamentoNaCotacao(r.status) && r.responsavelStatus === currentAdmin)
      .sort((a, b) => statusDe('cotacoes').indexOf(a.status) - statusDe('cotacoes').indexOf(b.status) || desdeStatusAtual(a) - desdeStatusAtual(b))
    // com previsão de entrega primeiro (a mais próxima/atrasada no topo), depois as sem previsão
    const emTransporte = cotacoes
      .filter((r) => noBlocoEmTransporte(r.status))
      .sort((a, b) => {
        const pa = previsaoDaCotacao(a)
        const pb = previsaoDaCotacao(b)
        if (pa && pb) return pa.localeCompare(pb)
        if (pa || pb) return pa ? -1 : 1
        return desdeStatusAtual(a) - desdeStatusAtual(b)
      })

    // pedidos confirmados (em produção no fornecedor): com previsão de finalização primeiro, a mais
    // próxima/atrasada no topo
    // a mais próxima entre os fornecedores do pedido
    const previsaoProducao = (r: QuoteRecord) => previsoesDeProducao(r)[0]?.previsao || ''
    const emProducao = cotacoes
      .filter((r) => r.status === 'PEDIDO CONFIRMADO')
      .sort((a, b) => {
        const pa = previsaoProducao(a)
        const pb = previsaoProducao(b)
        if (pa && pb) return pa.localeCompare(pb)
        if (pa || pb) return pa ? -1 : 1
        return desdeStatusAtual(a) - desdeStatusAtual(b)
      })
    const producaoChegando = emProducao.filter(
      (r) => previsaoProducao(r) && situacaoDaPrevisao(previsaoProducao(r), agora, 'producao').diasUteis <= DIAS_AVISO_PRODUCAO,
    )

    const eventos: Evento[] = []
    for (const r of cotacoes) {
      eventos.push({ chave: `${r.id}-criada`, quando: r.createdAt, cotacao: r, texto: 'criada', quem: r.criadoPor })
      r.statusHistory.forEach((h, i) => {
        if (i === 0 && h.status === 'PENDENTE') return // é a própria criação
        // o status só muda pelas mãos do responsável (quem tirou de PENDENTE), então é ele quem mudou
        eventos.push({ chave: `${r.id}-${i}`, quando: h.changedAt, cotacao: r, texto: h.status, quem: h.status === 'PENDENTE' ? '' : r.responsavelStatus })
      })
    }
    eventos.sort((a, b) => b.quando - a.quando)

    const algumaVez = (r: QuoteRecord, status: QuoteStatus, desde: number) => r.statusHistory.some((h) => h.status === status && h.changedAt >= desde)
    return {
      retorno: cotacoesEsperandoRetorno(cotacoes, currentAdmin, agora),
      pendentes,
      minhas,
      emProducao,
      producaoChegando,
      emTransporte,
      atividade: eventos.slice(0, 8),
      novasHoje: cotacoes.filter((r) => r.createdAt >= hoje).length,
      enviadasHoje: cotacoes.filter((r) => algumaVez(r, 'ENVIADO', hoje)).length,
      confirmadosSemana: cotacoes.filter((r) => algumaVez(r, 'PEDIDO CONFIRMADO', agora - 7 * DIA)).length,
    }
  }, [cotacoes, currentAdmin, agora, hoje])

  const transferencias = useMemo(() => {
    const abertas = notas.filter((n) => n.status !== 'CONCLUIDO' && n.status !== 'DEVOLUÇÃO')
    const porStatus = ordemComExtras('notas', abertas.map((n) => n.status)).map((status) => ({ status, quantidade: abertas.filter((n) => n.status === status).length })).filter(
      (s) => s.quantidade > 0,
    )
    // o prejuízo só pra administrador (ver financeiroPorUsuario.ts)
    const emPrejuizo = veFinanceiro ? notas.filter((n) => prejuizoAutomatico(n) && valoresPorResultado(n).parado > 0) : []
    return {
      abertas: abertas.length,
      porStatus,
      prejuizo: emPrejuizo.reduce((s, n) => s + valoresPorResultado(n).parado, 0),
      notasEmPrejuizo: emPrejuizo.length,
    }
  }, [notas, veFinanceiro])

  async function recarregar() {
    try {
      setCotacoes(await listQuotes())
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar as cotações do servidor.')
    }
  }

  async function handleNaoFechou(r: QuoteRecord) {
    const arquivamento = await pedirMotivoArquivamento(`Por que a cotação ${r.codigo || ''} não foi fechada?`)
    if (!arquivamento) return
    try {
      await updateQuoteStatus(r.id, 'ARQUIVO', currentAdmin, undefined, arquivamento)
      await recarregar()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao arquivar a cotação.')
    }
  }

  async function handleFechouConfirmado(info: PedidoCompraInfo) {
    const r = pedidoDoRetorno
    if (!r) return
    try {
      await updateQuoteStatus(r.id, 'PEDIDO DE COMPRA', currentAdmin, info)
      setPedidoDoRetorno(undefined)
      await recarregar()
      void avisar(`${r.codigo || 'A cotação'} seguiu para o Pedido de Compra.`)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar o status.')
    }
  }

  function corDoStatus(status: string, lista: readonly string[] = statusDe('cotacoes')): string {
    return coresStatus[status] || corPadraoDoStatus(status, lista)
  }

  // os avisos (produção, retorno) só aparecem quando há o que avisar
  const veAlgumaParte =
    veAlgumBloco ||
    ve('numeros') ||
    (ve('avisoProducao') && blocos.producaoChegando.length > 0) ||
    (ve('retorno') && blocos.retorno.length > 0)

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold text-ink-900">
            {saudacao(agora)}, {nomeExibido}
          </h2>
          <p className="text-sm text-ink-600">O que precisa de atenção nas cotações hoje.</p>
        </div>
        {ve('atalhos') && (
          <div className="flex flex-wrap gap-2">
            {podeVer('cotacoes') && (
              <>
                <button
                  type="button"
                  onClick={() => onNovaCotacao('manual')}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
                >
                  Nova cotação
                </button>
                <button
                  type="button"
                  onClick={() => onNovaCotacao('importar')}
                  className="rounded-lg border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
                >
                  Importar cotação
                </button>
              </>
            )}
            {cotacaoAberta && podeVer('dashboard') && (
              <button
                type="button"
                onClick={onContinuar}
                title={cotacaoAberta.cliente}
                className="rounded-lg border border-ink-200 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
              >
                Continuar {cotacaoAberta.codigo || 'cotação aberta'}
              </button>
            )}
          </div>
        )}
      </div>

      {erro && <p className="card text-sm text-rose-600">{erro}</p>}

      {carregando || partes === null ? (
        <div className="card text-center text-sm text-ink-400 py-10">Carregando…</div>
      ) : !veAlgumaParte ? (
        <div className="card py-10 text-center text-sm text-ink-400">
          Nada pra mostrar aqui — o administrador escolhe o que aparece na sua Tela Inicial. Use o menu ao lado.
        </div>
      ) : (
        <>
          {ve('avisoProducao') && blocos.producaoChegando.length > 0 && (
            <Topico
              id="producao"
              titulo="Produção — previsão de finalização"
              total={blocos.producaoChegando.length}
              className="card border-sky-300 bg-sky-50/60"
              classeContagem="bg-sky-200 text-sky-900"
              extra={
                <button type="button" onClick={() => onIrPara('pedidoCompra')} className="text-xs font-medium text-ink-500 hover:text-ink-800">
                  Ver no Pedido de Compra →
                </button>
              }
            >
              <p className="mb-3 text-sm text-ink-600">
                Pedidos confirmados com a produção ficando pronta {DIAS_AVISO_PRODUCAO === 1 ? 'até o próximo dia útil' : `em até ${DIAS_AVISO_PRODUCAO} dias úteis`}
                {' '}ou já atrasada — confirme com o fornecedor.
              </p>
              <div className="space-y-1">
                {blocos.producaoChegando.map((r) => (
                  <LinhaCotacao
                    key={r.id}
                    r={r}
                    onClick={() => onOpenQuote(r)}
                    direita={
                      <span className="flex flex-col items-end gap-0.5">
                        <SelosPrevisao
                          previsoes={previsoesDeProducao(r).filter((p) => situacaoDaPrevisao(p.previsao, agora, 'producao').diasUteis <= DIAS_AVISO_PRODUCAO)}
                          agora={agora}
                          tipo="producao"
                        />
                      </span>
                    }
                  />
                ))}
              </div>
            </Topico>
          )}

          {ve('numeros') && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Numero valor={blocos.novasHoje} rotulo={blocos.novasHoje === 1 ? 'cotação nova hoje' : 'cotações novas hoje'} />
              <Numero valor={blocos.enviadasHoje} rotulo={blocos.enviadasHoje === 1 ? 'enviada ao cliente hoje' : 'enviadas ao cliente hoje'} />
              <Numero
                valor={blocos.confirmadosSemana}
                rotulo={blocos.confirmadosSemana === 1 ? 'pedido confirmado nos últimos 7 dias' : 'pedidos confirmados nos últimos 7 dias'}
              />
            </div>
          )}

          {veAlgumBloco && (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 sm:gap-6 items-start">
              {ve('pendentes') && (
                <Bloco
                  titulo="Pendentes"
                  total={blocos.pendentes.length}
                  vazio="Nenhuma cotação esperando — tudo já tem responsável."
                  onVerTodas={() => onIrPara('cotacoes')}
                >
                  {blocos.pendentes.slice(0, ITENS_POR_BLOCO).map((r) => {
                    const dias = diasUteisDesde(dataDoPedido(r), agora)
                    return (
                      <LinhaCotacao
                        key={r.id}
                        r={r}
                        onClick={() => onOpenQuote(r)}
                        direita={<Idade texto={dias === 0 ? 'pedida hoje' : `pendente há ${textoDiasUteis(dias)}`} alerta={dias > DIAS_PENDENTE_ALERTA} />}
                      />
                    )
                  })}
                </Bloco>
              )}

              {ve('emAndamento') && (
                <Bloco
                  titulo="EM ANDAMENTO"
                  total={blocos.minhas.length}
                  vazio="Nenhuma cotação com você agora."
                  onVerTodas={() => onIrPara('cotacoes')}
                >
                  {blocos.minhas.slice(0, ITENS_POR_BLOCO).map((r) => (
                    <LinhaCotacao
                      key={r.id}
                      r={r}
                      onClick={() => onOpenQuote(r)}
                      direita={
                        <span className="flex flex-col items-end gap-0.5">
                          <SeloStatus status={r.status} cor={corDoStatus(r.status)} />
                          <span className="text-[11px] text-ink-400">{haDiasUteis(desdeStatusAtual(r), agora)}</span>
                        </span>
                      }
                    />
                  ))}
                </Bloco>
              )}

              {ve('emProducao') && (
                <Bloco
                  titulo="EM PRODUÇÃO"
                  total={blocos.emProducao.length}
                  vazio="Nenhum pedido confirmado em produção."
                  onVerTodas={() => onIrPara('pedidoCompra')}
                  rotuloVerTodas="Ver no Pedido de Compra"
                >
                  {blocos.emProducao.slice(0, ITENS_POR_BLOCO).map((r) => (
                    <LinhaCotacao
                      key={r.id}
                      r={r}
                      onClick={() => onOpenQuote(r)}
                      direita={
                        <span className="flex flex-col items-end gap-0.5">
                          {r.producao ? (
                            <SeloProducao producao={r.producao} totalItens={itensDoPedidoDeCompra(r).length} agora={agora} previsoes={previsoesDeProducao(r)} />
                          ) : (
                            <span className="text-[11px] text-ink-400">produção não informada · {haDiasUteis(desdeStatusAtual(r), agora)}</span>
                          )}
                          {r.producao && previsoesDeProducao(r).length === 0 && <span className="text-[11px] text-ink-400">sem previsão</span>}
                        </span>
                      }
                    />
                  ))}
                </Bloco>
              )}

              {ve('emTransporte') && (
                <Bloco
                  titulo="EM TRANSPORTE"
                  total={blocos.emTransporte.length}
                  vazio="Nada em transporte."
                  onVerTodas={() => onIrPara('pedidoCompra')}
                  rotuloVerTodas="Ver no Pedido de Compra"
                >
                  {blocos.emTransporte.slice(0, ITENS_POR_BLOCO).map((r) => {
                    const previsoes = previsoesDeEntrega(r)
                    return (
                      <LinhaCotacao
                        key={r.id}
                        r={r}
                        onClick={() => setTransporteAbertoId(r.id)}
                        direita={
                          <span className="flex flex-col items-end gap-0.5">
                            <SeloStatus status={r.status} cor={corDoStatus(r.status)} />
                            {previsoes.length > 0 ? (
                              <SelosPrevisao previsoes={previsoes} agora={agora} />
                            ) : (
                              <span className="text-[11px] text-ink-400">sem previsão · {haDiasUteis(desdeStatusAtual(r), agora)}</span>
                            )}
                          </span>
                        }
                      />
                    )
                  })}
                </Bloco>
              )}

              {ve('atividade') && (
                <Bloco
                  titulo="Atividade recente da equipe"
                  total={blocos.atividade.length}
                  vazio="Nenhuma atividade ainda."
                >
                  {blocos.atividade.map((e) => (
                    <button
                      key={e.chave}
                      type="button"
                      onClick={() => onOpenQuote(e.cotacao)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-ink-50"
                    >
                      <span className="font-mono text-xs text-ink-500">{e.cotacao.codigo || '—'}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-700">
                        {e.texto === 'criada' ? (
                          <>criada{e.quem ? <> por <strong className="font-medium">{e.quem}</strong></> : null}</>
                        ) : (
                          <>
                            <SeloStatus status={e.texto} cor={corDoStatus(e.texto)} />
                            {e.quem && <span className="ml-1.5 text-ink-500">· resp. {e.quem}</span>}
                          </>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-400">{haQuanto(e.quando, agora)}</span>
                    </button>
                  ))}
                </Bloco>
              )}

              {veTransferencias && (
                <Bloco
                  titulo="Transferências fiscais"
                  total={transferencias.abertas + transferencias.notasEmPrejuizo}
                  vazio="Nenhuma transferência em aberto."
                  onVerTodas={() => onIrPara('acompanhamentoNotas')}
                  rotuloVerTodas="Ir para Transferências"
                >
                  {transferencias.porStatus.map((s) => (
                    <div key={s.status} className="flex items-center justify-between px-2 py-1 text-sm">
                      <SeloStatus status={s.status} tipo="notas" cor={corDoStatus(s.status, statusDe('notas'))} />
                      <span className="font-semibold text-ink-800">{s.quantidade}</span>
                    </div>
                  ))}
                  {transferencias.notasEmPrejuizo > 0 && (
                    <p className="mt-1 rounded-lg bg-[#e34948]/10 px-3 py-2 text-sm text-[#b52d2c] dark:text-[#f19c9b]">
                      {transferencias.notasEmPrejuizo} nota{transferencias.notasEmPrejuizo === 1 ? '' : 's'} com prejuízo até vender:{' '}
                      <strong>{formatCurrency(transferencias.prejuizo)}</strong> — marque como faturado o que for vendido.
                    </p>
                  )}
                </Bloco>
              )}
            </div>
          )}

          {/* por último, depois de todos os blocos */}
          {ve('retorno') && blocos.retorno.length > 0 && (
            <Topico
              id="retorno"
              titulo="Retorno do cliente"
              total={blocos.retorno.length}
              className="card border-amber-300 bg-amber-50/60"
              classeContagem="bg-amber-200 text-amber-900"
            >
              <p className="mb-3 text-sm text-ink-600">
                Enviadas por você há {DIAS_PARA_RETORNO} dias ou mais — atualize: se fechou, siga pro pedido de compra; se não
                fechou, arquive com o motivo.
              </p>
              <div className="space-y-1">
                {blocos.retorno.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenQuote(r)}
                      title="Abrir na Precificação"
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm text-ink-900">
                        <span className="font-mono text-xs text-ink-500">{r.codigo || '—'}</span>{' '}
                        <span className="font-medium">{r.cliente || '(sem cliente)'}</span>
                      </span>
                      <span className="block text-[11px] font-semibold text-amber-800">enviada há {diasDesdeOEnvio(r, agora)} dias</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPedidoDoRetorno(r)}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      Fechou
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleNaoFechou(r)}
                      className="rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50"
                    >
                      Não fechou
                    </button>
                  </div>
                ))}
              </div>
            </Topico>
          )}
        </>
      )}

      {pedidoDoRetorno && (
        <PedidoCompraModal quote={pedidoDoRetorno} onConfirm={handleFechouConfirmado} onCancel={() => setPedidoDoRetorno(undefined)} />
      )}

      {transporteAberto && (
        <ResumoTransporteDaCotacao
          cotacao={transporteAberto}
          corDoStatus={corDoStatus}
          onAbrirPedido={() => {
            setTransporteAbertoId(undefined)
            onAbrirPedido(transporteAberto.id)
          }}
          onFechar={() => setTransporteAbertoId(undefined)}
        />
      )}
    </div>
    </>
  )
}

// --- pedaços --------------------------------------------------------------------------------

function Numero({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    // no celular, os três lado a lado: número em cima, texto embaixo
    <div className="card flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-baseline sm:gap-3 sm:px-5 sm:py-4">
      <span className="font-display text-2xl font-bold tabular-nums text-ink-900 sm:text-3xl">{valor}</span>
      <span className="text-xs leading-tight text-ink-500 sm:text-sm">{rotulo}</span>
    </div>
  )
}

function Bloco({
  titulo,
  total,
  vazio,
  onVerTodas,
  rotuloVerTodas = 'Ver em Cotações',
  children,
}: {
  titulo: string
  total: number
  vazio: string
  onVerTodas?: () => void
  rotuloVerTodas?: string
  children: ReactNode
}) {
  return (
    <Topico
      id={titulo}
      titulo={titulo}
      total={total}
      extra={
        onVerTodas &&
        total > ITENS_POR_BLOCO && (
          <button type="button" onClick={onVerTodas} className="shrink-0 text-xs text-ink-800 underline-offset-2 hover:underline">
            {rotuloVerTodas} (+{total - ITENS_POR_BLOCO})
          </button>
        )
      }
    >
      {total === 0 ? <p className="py-4 text-center text-sm text-ink-400">{vazio}</p> : <div className="space-y-1">{children}</div>}
    </Topico>
  )
}

/** Quadro da Tela Inicial que recolhe (fica só o título e a contagem) clicando no título — cada um
 * lembra, neste aparelho, se estava recolhido. */
function Topico({
  id,
  titulo,
  total,
  className = 'card',
  classeContagem = 'bg-ink-100 text-ink-600',
  extra,
  children,
}: {
  id: string
  titulo: string
  total: number
  className?: string
  classeContagem?: string
  /** O que fica à direita do título (ex.: "Ver no Pedido de Compra →"). */
  extra?: ReactNode
  children: ReactNode
}) {
  const [recolhido, setRecolhido] = useEstadoPersistente(`telaInicial:recolhido:${id}`, false)
  return (
    <section className={className} aria-label={titulo}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${recolhido ? '' : 'mb-3'}`}>
        <h3 className="min-w-0 font-display text-base font-semibold text-ink-900">
          <button
            type="button"
            onClick={() => setRecolhido((v) => !v)}
            aria-expanded={!recolhido}
            title={recolhido ? 'Mostrar' : 'Recolher'}
            className="flex min-w-0 items-center gap-2 rounded text-left transition hover:text-ink-700"
          >
            <span aria-hidden className={`text-sm text-ink-400 transition-transform ${recolhido ? '-rotate-90' : ''}`}>
              ▾
            </span>
            <span className="min-w-0">{titulo}</span>
            {total > 0 && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${classeContagem}`}>{total}</span>}
          </button>
        </h3>
        {!recolhido && extra}
      </div>
      {!recolhido && children}
    </section>
  )
}

function LinhaCotacao({ r, direita, onClick }: { r: QuoteRecord; direita: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Abrir na Precificação"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left transition hover:bg-ink-50"
    >
      <span className="min-w-[10rem] flex-1">
        <span className="block truncate text-sm text-ink-900">
          <span className="font-mono text-xs text-ink-500">{r.codigo || '—'}</span> <span className="font-medium">{r.cliente || '(sem cliente)'}</span>
        </span>
        <span className="block truncate text-[11px] text-ink-400">
          {[r.vendedor, r.maquina].filter(Boolean).join(' · ') || '—'}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-right">{direita}</span>
    </button>
  )
}

function SeloStatus({ status, cor, tipo = 'cotacoes' }: { status: string; cor: string; tipo?: TipoStatus }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ backgroundColor: cor, color: corTexto(cor) }}>
      {nomeDoStatus(status, tipo)}
    </span>
  )
}

function Idade({ texto, alerta = false }: { texto: string; alerta?: boolean }) {
  return (
    <span
      className={`text-[11px] ${alerta ? 'font-semibold text-amber-700' : 'text-ink-400'}`}
      title={alerta ? `Pendente há mais de ${DIAS_PENDENTE_ALERTA} dias úteis` : undefined}
    >
      {alerta && '⚠ '}
      {texto}
    </span>
  )
}
