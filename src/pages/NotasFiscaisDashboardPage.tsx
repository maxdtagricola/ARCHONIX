import { useEffect, useMemo, useState } from 'react'
import { DonutChart, limitarComOutros, type DonutDatum } from '../components/DonutChart'
import { GroupedBarChart } from '../components/BarChart'
import { GraficoFaturamentoPrejuizo, type MesFaturamentoPrejuizo } from '../components/GraficoFaturamentoPrejuizo'
import { KpiCard, IconCaminhao, IconDocumento, IconTendencia } from '../components/KpiCard'
import { listNotasFiscais } from '../db/notasFiscaisRepo'
import { getStatusColors } from '../db/configRepo'
import { corPadraoDoStatus } from '../statusColors'
import { formatCurrency } from '../utils'
import { PERIODOS, inicioPeriodo, type Periodo } from '../periodo'
import { NOTA_FISCAL_TIPOS } from '../types'
import { nomeDoStatus, ordemComExtras, statusDe } from '../statusConfig'
import type { NotaFiscal, NotaFiscalTipo } from '../types'
import {
  COR_FATURADO,
  COR_PREJUIZO,
  chaveMesDaNota,
  corDoTipo,
  labelCurtoDoMes,
  labelDoMes,
  labelDoTipo,
  partesDoItem,
  valoresPorResultado,
} from '../notasFiscaisHelpers'
import { formatarNumeroCurtoBR } from '../numeros'
import { avisar } from '../dialogs'
import { SeletorMesReferencia, mesesDisponiveis } from '../components/SeletorMesReferencia'

interface ProdutoNoResultado {
  chave: string
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  valor: number
  notas: Set<string>
}

/** Os produtos que mais pesaram num resultado (faturado ou parado no estoque), por valor — o
 * parcialmente faturado entra nos dois, cada um com a sua parte. */
function rankingDeProdutos(notas: NotaFiscal[], resultado: 'FATURADO' | 'ESTOQUE', limite = 5): ProdutoNoResultado[] {
  const porProduto = new Map<string, ProdutoNoResultado>()
  for (const n of notas) {
    for (const item of n.itens ?? []) {
      const partes = partesDoItem(item, n)
      const quantidade = resultado === 'FATURADO' ? partes.qtdFaturada : partes.qtdParada
      const valor = resultado === 'FATURADO' ? partes.faturado : partes.parado
      if (!(valor > 0) && !(quantidade > 0)) continue
      const chave = (item.codigo.trim() || item.descricao.trim()).toUpperCase()
      if (!chave) continue
      const atual = porProduto.get(chave) ?? {
        chave,
        codigo: item.codigo.trim(),
        descricao: item.descricao.trim(),
        quantidade: 0,
        unidade: item.unidade,
        valor: 0,
        notas: new Set<string>(),
      }
      atual.quantidade += quantidade
      atual.valor += valor
      atual.notas.add(n.id)
      porProduto.set(chave, atual)
    }
  }
  return Array.from(porProduto.values())
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limite)
}

function ListaRanking({ titulo, cor, produtos, vazio }: { titulo: string; cor: string; produtos: ProdutoNoResultado[]; vazio: string }) {
  return (
    <div>
      <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-900">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cor }} />
        {titulo}
      </p>
      {produtos.length === 0 ? (
        <p className="text-xs text-ink-400">{vazio}</p>
      ) : (
        <ol className="space-y-1.5">
          {produtos.map((p, i) => (
            <li key={p.chave} className="flex items-baseline gap-2 text-xs">
              <span className="w-4 shrink-0 text-right text-ink-400">{i + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink-800" title={p.descricao}>
                  {p.codigo ? <span className="font-mono text-ink-500">{p.codigo} · </span> : null}
                  {p.descricao || '—'}
                </span>
                <span className="text-[11px] text-ink-400">
                  {formatarNumeroCurtoBR(p.quantidade, 3)} {p.unidade} em {p.notas.size} nota{p.notas.size === 1 ? '' : 's'}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-ink-900">{formatCurrency(p.valor)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-3">
      <p className="text-xs text-ink-400 mb-1">{titulo}</p>
      <p className="font-mono text-base font-semibold tabular-nums text-ink-900">{valor}</p>
      {detalhe && <p className="mt-0.5 text-[11px] text-ink-500">{detalhe}</p>}
    </div>
  )
}

const tipoOptions = NOTA_FISCAL_TIPOS

/** Versão curta do valor pra caber dentro da fatia do gráfico (a legenda ao lado mostra o valor completo). */
function formatCurrencyCompacto(v: number): string {
  if (Math.abs(v) < 1000) return formatCurrency(v)
  return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
}

/** Mesmo layout do Dashboard de cotações (ver AnalyticsPage): título + KPIs coloridos no topo,
 * sidebar de filtros com o donut de status compacto, área principal com o resto dos gráficos. O
 * faturamento × prejuízo e os produtos faturados e parados só aparecem pra administrador
 * (`veFinanceiro`, ver financeiroPorUsuario.ts). */
export function NotasFiscaisDashboardPage({ veFinanceiro }: { veFinanceiro: boolean }) {
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [loading, setLoading] = useState(true)
  const [coresStatus, setCoresStatus] = useState<Record<string, string>>({})
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | NotaFiscalTipo>('TODOS')
  // "AAAA-MM" (mês de referência da nota: o da emissão — o mesmo das pastas de Transferências
  // Fiscais): mostra só esse mês, no lugar do Período; vazio = vale o Período
  const [mesReferencia, setMesReferencia] = useState('')

  useEffect(() => {
    setLoading(true)
    listNotasFiscais()
      .then(setNotas)
      .catch((err) => {
        void avisar(err instanceof Error ? err.message : 'Erro ao carregar notas fiscais do servidor.')
      })
      .finally(() => setLoading(false))
    getStatusColors()
      .then(setCoresStatus)
      .catch(() => {
        // cores customizadas são só um extra visual — se o servidor falhar, usa a paleta padrão
      })
  }, [])

  function corDoStatus(status: string): string {
    return coresStatus[status] || corPadraoDoStatus(status, statusDe('notas'))
  }

  const meses = useMemo(() => mesesDisponiveis(notas.map(chaveMesDaNota)), [notas])

  const notasDoPeriodo = useMemo(() => {
    const inicio = inicioPeriodo(periodo)
    return notas.filter(
      (n) =>
        (mesReferencia ? chaveMesDaNota(n) === mesReferencia : n.createdAt >= inicio) &&
        (tipoFiltro === 'TODOS' || (n.tipo ?? 'PECAS') === tipoFiltro),
    )
  }, [notas, periodo, mesReferencia, tipoFiltro])

  /** Gráficos mês a mês: os últimos 6 meses — até o mês de referência, quando escolhido. */
  function ultimosSeisMeses<T extends { mesKey: string }>(lista: T[]): T[] {
    return lista.filter((m) => !mesReferencia || m.mesKey <= mesReferencia).slice(-6)
  }

  const statusData: DonutDatum[] = useMemo(
    () =>
      ordemComExtras('notas', notasDoPeriodo.map((n) => n.status)).map((status) => ({
        label: nomeDoStatus(status, 'notas'),
        value: notasDoPeriodo.filter((n) => n.status === status).length,
        color: corDoStatus(status),
      })).filter((d) => d.value > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notasDoPeriodo, coresStatus],
  )

  const valorTotalNotas = notasDoPeriodo.reduce((s, n) => s + n.valorNota, 0)
  const valorTotalFrete = notasDoPeriodo.reduce((s, n) => s + n.valorFrete, 0)

  // valores de transferência — soma do valor das notas por filial (recebedor) no período
  const valorPorRecebedorData: DonutDatum[] = useMemo(() => {
    const porRecebedor = new Map<string, number>()
    for (const n of notasDoPeriodo) {
      const chave = n.recebedor || '(sem recebedor)'
      porRecebedor.set(chave, (porRecebedor.get(chave) ?? 0) + n.valorNota)
    }
    return limitarComOutros(
      Array.from(porRecebedor.entries()).map(([label, value]) => ({ label, value })),
      7,
    )
  }, [notasDoPeriodo])

  // registros por mês (últimos 6 meses de referência), diferenciando peças de implementos —
  // tendência independente do período selecionado acima
  const notasPorMesData = useMemo(() => {
    const porMes = new Map<string, Record<NotaFiscalTipo, { quantidade: number; valor: number }>>()
    for (const n of notas) {
      const chave = chaveMesDaNota(n)
      const tipo: NotaFiscalTipo = n.tipo ?? 'PECAS'
      if (!porMes.has(chave)) {
        porMes.set(chave, { PECAS: { quantidade: 0, valor: 0 }, IMPLEMENTOS: { quantidade: 0, valor: 0 } })
      }
      const atual = porMes.get(chave)![tipo]
      atual.quantidade += 1
      atual.valor += n.valorNota
    }
    return ultimosSeisMeses(
      Array.from(porMes.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([mesKey, porTipo]) => ({ mesKey, porTipo })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, mesReferencia])

  const tipoSeries = tipoOptions.map((t) => ({ key: t.value, label: t.label, color: corDoTipo(t.value) }))

  const registrosPorMesChartData = notasPorMesData.map((d) => ({
    label: labelCurtoDoMes(d.mesKey),
    values: { PECAS: d.porTipo.PECAS.quantidade, IMPLEMENTOS: d.porTipo.IMPLEMENTOS.quantidade },
  }))

  const valoresPorMesChartData = notasPorMesData.map((d) => ({
    label: labelCurtoDoMes(d.mesKey),
    values: { PECAS: d.porTipo.PECAS.valor, IMPLEMENTOS: d.porTipo.IMPLEMENTOS.valor },
  }))

  const tipoFiltroOptions = ['TODOS', ...tipoOptions.map((t) => t.value)] as const

  // faturamento × prejuízo — no período escolhido (indicadores e ranking de produtos) e mês a mês
  // (últimos meses, como os outros gráficos de tendência), respeitando o filtro de tipo
  const resultadosDoPeriodo = useMemo(
    () =>
      notasDoPeriodo.reduce(
        (acc, n) => {
          const v = valoresPorResultado(n)
          return {
            faturado: acc.faturado + v.faturado,
            parado: acc.parado + v.parado,
            freteParado: acc.freteParado + v.freteParado,
            semResultado: acc.semResultado + v.semResultado,
          }
        },
        { faturado: 0, parado: 0, freteParado: 0, semResultado: 0 },
      ),
    [notasDoPeriodo],
  )
  const baseAproveitamento = resultadosDoPeriodo.faturado + resultadosDoPeriodo.parado
  const aproveitamentoDoPeriodo =
    baseAproveitamento > 0 ? `${Math.round((resultadosDoPeriodo.faturado / baseAproveitamento) * 100)}%` : '—'

  const mesesFaturamento: MesFaturamentoPrejuizo[] = useMemo(() => {
    const porMes = new Map<string, MesFaturamentoPrejuizo>()
    for (const n of notas) {
      if (tipoFiltro !== 'TODOS' && (n.tipo ?? 'PECAS') !== tipoFiltro) continue
      const mesKey = chaveMesDaNota(n)
      const atual = porMes.get(mesKey) ?? {
        mesKey,
        rotulo: labelCurtoDoMes(mesKey),
        faturado: 0,
        parado: 0,
        freteParado: 0,
        semResultado: 0,
      }
      const v = valoresPorResultado(n)
      atual.faturado += v.faturado
      atual.parado += v.parado
      atual.freteParado += v.freteParado
      atual.semResultado += v.semResultado
      porMes.set(mesKey, atual)
    }
    return ultimosSeisMeses(Array.from(porMes.values()).sort((a, b) => (a.mesKey < b.mesKey ? -1 : 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, tipoFiltro, mesReferencia])

  const maisParados = useMemo(() => rankingDeProdutos(notasDoPeriodo, 'ESTOQUE'), [notasDoPeriodo])
  const maisFaturados = useMemo(() => rankingDeProdutos(notasDoPeriodo, 'FATURADO'), [notasDoPeriodo])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink-900">Dashboard de Transferências</h2>
          <p className="text-sm text-ink-400">
            Visão geral das notas fiscais de transferência{mesReferencia ? ` — só ${labelDoMes(mesReferencia).toLowerCase()}` : ''}
          </p>
        </div>
        {!loading && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full sm:w-auto">
            <KpiCard
              icon={<IconDocumento />}
              value={String(notasDoPeriodo.length)}
              label={mesReferencia ? 'Notas no mês' : 'Notas no período'}
              tone="agua"
            />
            <KpiCard icon={<IconTendencia />} value={formatCurrency(valorTotalNotas)} label="Valor total das notas" tone="amarelo" />
            <KpiCard icon={<IconCaminhao />} value={formatCurrency(valorTotalFrete)} label="Valor total de frete" tone="laranja" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="card text-center text-sm text-ink-400 py-10">Carregando…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
          <div className="space-y-6">
            <div className="card">
              <h3 className="font-display text-sm font-semibold text-ink-900 mb-3">Filtros</h3>
              <p className="field-label mb-1.5">Período</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {PERIODOS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => {
                      setPeriodo(p.value)
                      setMesReferencia('')
                    }}
                    className={`pill-tab border ${
                      !mesReferencia && periodo === p.value
                        ? 'bg-ink-950 border-ink-950 text-white'
                        : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mb-4">
                <SeletorMesReferencia meses={meses} valor={mesReferencia} onChange={setMesReferencia} />
              </div>
              <p className="field-label mb-1.5">Tipo</p>
              <div className="flex flex-wrap gap-2">
                {tipoFiltroOptions.map((valor) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setTipoFiltro(valor)}
                    className={`pill-tab border ${
                      tipoFiltro === valor
                        ? 'bg-ink-950 border-ink-950 text-white'
                        : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                    }`}
                  >
                    {valor === 'TODOS' ? 'Todos' : labelDoTipo(valor)}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Status das notas</h3>
              <p className="text-xs text-ink-400 mb-4">Quantidade em cada status, no período selecionado.</p>
              <DonutChart
                data={statusData}
                centerValue={String(notasDoPeriodo.length)}
                centerLabel="Notas"
                valueFormatter={(v) => String(v)}
                emptyText="Nenhuma nota nesse período."
                compact
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="card">
              <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Valores de transferência</h3>
              <p className="text-xs text-ink-400 mb-4">
                Soma do valor das notas por filial (recebedor), no período selecionado.
              </p>
              <DonutChart
                data={valorPorRecebedorData}
                centerValue={formatCurrency(valorTotalNotas)}
                centerLabel="Total"
                valueFormatter={formatCurrency}
                chartValueFormatter={formatCurrencyCompacto}
                emptyText="Nenhuma nota com valor nesse período."
              />
            </div>

            {veFinanceiro && (
            <>
            <div className="card">
              <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Faturamento × prejuízo</h3>
              <p className="text-xs text-ink-400 mb-4">
                O que as transferências viraram: faturado (venda) ou parado no estoque — prejuízo, a transferência não gerou
                o lucro esperado. Assim que a nota dá entrada, o que não foi marcado como faturado conta como prejuízo, até
                ser marcado como vendido em Transferências Fiscais (na nota inteira ou em cada produto). Indicadores do
                período selecionado; gráfico dos últimos meses.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <Indicador titulo="Faturado" valor={formatCurrency(resultadosDoPeriodo.faturado)} />
                <Indicador titulo="Parado no estoque (prejuízo)" valor={formatCurrency(resultadosDoPeriodo.parado)} />
                <Indicador
                  titulo="Frete gasto com os parados"
                  valor={formatCurrency(resultadosDoPeriodo.freteParado)}
                  detalhe="parte do frete das notas, pelo valor dos produtos parados"
                />
                <Indicador
                  titulo="Virou venda"
                  valor={aproveitamentoDoPeriodo}
                  detalhe={
                    resultadosDoPeriodo.semResultado > 0
                      ? `${formatCurrency(resultadosDoPeriodo.semResultado)} ainda sem resultado`
                      : undefined
                  }
                />
              </div>
              <GraficoFaturamentoPrejuizo meses={mesesFaturamento} />
            </div>

            <div className="card">
              <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Produtos faturados e parados</h3>
              <p className="text-xs text-ink-400 mb-4">Os que mais pesaram em cada lado, por valor, no período selecionado.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ListaRanking
                  titulo="Mais parados no estoque"
                  cor={COR_PREJUIZO}
                  produtos={maisParados}
                  vazio="Nenhum produto marcado como parado no estoque no período."
                />
                <ListaRanking
                  titulo="Mais faturados"
                  cor={COR_FATURADO}
                  produtos={maisFaturados}
                  vazio="Nenhum produto marcado como faturado no período."
                />
              </div>
            </div>
            </>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card">
                <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Registros por mês</h3>
                <p className="text-xs text-ink-400 mb-4">Peças x implementos, últimos meses.</p>
                <GroupedBarChart
                  data={registrosPorMesChartData}
                  series={tipoSeries}
                  valueFormatter={(v) => String(v)}
                  emptyText="Nenhuma nota registrada ainda."
                />
              </div>

              <div className="card">
                <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Valores do mês</h3>
                <p className="text-xs text-ink-400 mb-4">Peças x implementos, últimos meses.</p>
                <GroupedBarChart
                  data={valoresPorMesChartData}
                  series={tipoSeries}
                  valueFormatter={formatCurrency}
                  chartValueFormatter={formatCurrencyCompacto}
                  emptyText="Nenhuma nota registrada ainda."
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
