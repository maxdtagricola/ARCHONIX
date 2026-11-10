import { useEffect, useMemo, useState } from 'react'
import { listQuotes } from '../db/analysesRepo'
import { getStatusColors } from '../db/configRepo'
import { SelectField } from '../components/ui/Field'
import { KpiCard, IconCheck, IconDocumento, IconTendencia } from '../components/KpiCard'
import { formatCurrency } from '../utils'
import { COR_OUTROS, PALETA_CATEGORICA, corPadraoDoStatus } from '../statusColors'
import { DonutChart, type DonutDatum } from '../components/DonutChart'
import { LineChart, type LineDatum, type LineSeries } from '../components/LineChart'
import { BarChart, type BarDatum } from '../components/BarChart'
import { PERIODOS, inicioPeriodo, type Periodo } from '../periodo'
import { VENDEDORES } from '../types'
import { nomeDoStatus, ordemComExtras } from '../statusConfig'
import type { QuoteRecord } from '../types'
import { avisar } from '../dialogs'
import { SeletorMesReferencia, intervaloDoMes, mesesDisponiveis } from '../components/SeletorMesReferencia'
import { chaveMes, labelDoMes } from '../notasFiscaisHelpers'

const NOMES_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Os últimos `n` meses até `ate` (o mês atual, se não vier), do mais antigo pro mais recente —
 * janela fixa, não segue o filtro de Período da página, senão o gráfico de tendência fica sem graça
 * no "Mês". Com um mês de referência escolhido, a janela termina nele. */
function ultimosMeses(n: number, ate?: string): { inicio: number; fim: number; label: string }[] {
  const fimDaJanela = ate ? new Date(intervaloDoMes(ate).inicio) : new Date()
  const meses: { inicio: number; fim: number; label: string }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(fimDaJanela.getFullYear(), fimDaJanela.getMonth() - i, 1)
    const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    meses.push({ inicio: d.getTime(), fim: fim.getTime(), label: `${NOMES_MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` })
  }
  return meses
}

/** `veFinanceiro`: o valor faturado só aparece pra administrador (ver financeiroPorUsuario.ts). */
export function AnalyticsPage({ veFinanceiro }: { veFinanceiro: boolean }) {
  const [records, setRecords] = useState<QuoteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  // "AAAA-MM": mostra só esse mês (no lugar do Período); vazio = vale o Período
  const [mesReferencia, setMesReferencia] = useState('')
  const [coresStatus, setCoresStatus] = useState<Record<string, string>>({})

  useEffect(() => {
    listQuotes()
      .then(setRecords)
      .catch((err) => void avisar(err instanceof Error ? err.message : 'Erro ao carregar cotações do servidor.'))
      .finally(() => setLoading(false))
    getStatusColors()
      .then(setCoresStatus)
      .catch(() => {
        // cores customizadas são só um extra visual — se o servidor falhar, usa a paleta padrão
      })
  }, [])

  const meses = useMemo(() => mesesDisponiveis(records.map((r) => chaveMes(new Date(r.createdAt)))), [records])

  const filtrados = useMemo(() => {
    const { inicio, fim } = mesReferencia ? intervaloDoMes(mesReferencia) : { inicio: inicioPeriodo(periodo), fim: Infinity }
    return records.filter((r) => r.createdAt >= inicio && r.createdAt < fim && (!vendedorFiltro || r.vendedor === vendedorFiltro))
  }, [records, periodo, mesReferencia, vendedorFiltro])

  const statusData: DonutDatum[] = useMemo(() => {
    const contagens = ordemComExtras('cotacoes', filtrados.map((r) => r.status)).map((status) => ({
      label: nomeDoStatus(status),
      value: filtrados.filter((r) => r.status === status).length,
      color: coresStatus[status] || corPadraoDoStatus(status),
    }))
    // se mais de 8 status estiverem ativos ao mesmo tempo, dobra o excedente em "Outros"
    const comValor = contagens.filter((d) => d.value > 0)
    if (comValor.length <= PALETA_CATEGORICA.length) return comValor
    const principais = comValor.slice(0, PALETA_CATEGORICA.length - 1)
    const resto = comValor.slice(PALETA_CATEGORICA.length - 1)
    return [
      ...principais,
      { label: `Outros (${resto.length} status)`, value: resto.reduce((s, d) => s + d.value, 0), color: COR_OUTROS },
    ]
  }, [filtrados, coresStatus])

  const valorTotalGeral = filtrados.reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0)
  const fechadas = useMemo(() => filtrados.filter((r) => r.status === 'FATURADO'), [filtrados])
  const valorFechado = fechadas.reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0)
  const ticketMedio = filtrados.length > 0 ? valorTotalGeral / filtrados.length : 0

  const janelaTendencia = useMemo(() => ultimosMeses(6, mesReferencia || undefined), [mesReferencia])
  const { tendenciaData, tendenciaSeries } = useMemo(() => {
    const base = vendedorFiltro ? records.filter((r) => r.vendedor === vendedorFiltro) : records
    const contagemPorStatus = new Map<string, number>()
    for (const r of base) contagemPorStatus.set(r.status, (contagemPorStatus.get(r.status) ?? 0) + 1)
    const statusOrdenados = Array.from(contagemPorStatus.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s)
    const principais = statusOrdenados.slice(0, 3)
    const temOutros = statusOrdenados.length > 3
    const series: LineSeries[] = principais.map((s, i) => ({
      key: s,
      label: nomeDoStatus(s),
      color: PALETA_CATEGORICA[i % PALETA_CATEGORICA.length],
    }))
    if (temOutros) series.push({ key: '__outros', label: 'Outros', color: COR_OUTROS })

    const data: LineDatum[] = janelaTendencia.map(({ inicio, fim, label }) => {
      const doMes = base.filter((r) => r.createdAt >= inicio && r.createdAt < fim)
      const values: Record<string, number> = {}
      for (const s of principais) values[s] = doMes.filter((r) => r.status === s).length
      if (temOutros) values.__outros = doMes.filter((r) => !principais.includes(r.status)).length
      return { label, values }
    })
    return { tendenciaData: data, tendenciaSeries: series }
  }, [records, vendedorFiltro, janelaTendencia])

  const vendedorData: BarDatum[] = useMemo(
    () =>
      VENDEDORES.map((v) => ({
        label: v,
        value: filtrados.filter((r) => r.vendedor === v).reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0),
      })).filter((d) => d.value > 0),
    [filtrados],
  )

  const vendedorOptions = [{ value: '', label: 'Todos' }, ...VENDEDORES.map((v) => ({ value: v, label: v }))]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink-900">Dashboard</h2>
          <p className="text-sm text-ink-400">
            Visão geral das cotações{mesReferencia ? ` — só ${labelDoMes(mesReferencia).toLowerCase()}` : ''}
          </p>
        </div>
        {!loading && (
          <div className={`grid grid-cols-1 ${veFinanceiro ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3 w-full sm:w-auto`}>
            <KpiCard
              icon={<IconDocumento />}
              value={String(filtrados.length)}
              label={mesReferencia ? 'Cotações no mês' : 'Cotações no período'}
              tone="agua"
            />
            <KpiCard icon={<IconTendencia />} value={formatCurrency(valorTotalGeral)} label="Valor total das cotações" tone="amarelo" />
            {veFinanceiro && <KpiCard icon={<IconCheck />} value={formatCurrency(valorFechado)} label="Valor faturado" tone="laranja" />}
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
              <SelectField label="Vendedor" value={vendedorFiltro} onChange={setVendedorFiltro} options={vendedorOptions} />
            </div>

            <div className="card">
              <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Status das cotações</h3>
              <p className="text-xs text-ink-400 mb-4">Quantidade em cada status, no período selecionado.</p>
              <DonutChart
                data={statusData}
                centerValue={String(filtrados.length)}
                centerLabel="Cotações"
                valueFormatter={(v) => String(v)}
                emptyText="Nenhuma cotação nesse período."
                compact
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="card">
              <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Cotações por mês</h3>
              <p className="text-xs text-ink-400 mb-4">
                {mesReferencia ? `6 meses até ${labelDoMes(mesReferencia).toLowerCase()}` : 'Últimos 6 meses'}, pelos status mais
                frequentes{vendedorFiltro ? ` de ${vendedorFiltro}` : ''}.
              </p>
              <LineChart
                data={tendenciaData}
                series={tendenciaSeries}
                valueFormatter={(v) => String(v)}
                emptyText="Nenhuma cotação registrada ainda."
              />
            </div>

            <div className={`grid grid-cols-1 ${veFinanceiro ? 'lg:grid-cols-2' : ''} gap-6`}>
              <div className="card">
                <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Valor por vendedor</h3>
                <p className="text-xs text-ink-400 mb-4">{mesReferencia ? 'No mês selecionado.' : 'No período selecionado.'}</p>
                <BarChart data={vendedorData} valueFormatter={formatCurrency} color="#2a78d6" emptyText="Nenhuma cotação com vendedor definido nesse período." />
              </div>

              {veFinanceiro && (
              <div className="card flex flex-col justify-center">
                <p className="text-sm text-ink-400 mb-1">{mesReferencia ? 'Valor faturado no mês' : 'Valor faturado no período'}</p>
                <p className="font-display text-4xl font-bold text-ink-900 tabular-nums">{formatCurrency(valorFechado)}</p>
                <div className="mt-3 pt-3 border-t border-ink-100 text-sm text-ink-500 space-y-1">
                  <p>{fechadas.length} cotaç{fechadas.length === 1 ? 'ão faturada' : 'ões faturadas'}</p>
                  <p>
                    Ticket médio: <span className="font-mono text-ink-800">{formatCurrency(ticketMedio)}</span>
                  </p>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
