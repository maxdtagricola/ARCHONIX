import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { listQuotes } from '../db/analysesRepo'
import { getStatusColors } from '../db/configRepo'
import { IconCheck, IconDocumento, IconTendencia } from '../components/KpiCard'
import { formatCurrency, formatNumber } from '../utils'
import { COR_OUTROS, PALETA_CATEGORICA, corPadraoDoStatus } from '../statusColors'
import { LineChart, type LineDatum, type LineSeries } from '../components/LineChart'
import {
  AnelDeProgresso,
  BarraDeProporcao,
  BarraHorizontal,
  GraficoLinha,
  GraficoPirulitos,
  NumeroAnimado,
  Segmentado,
  Sparkline,
  type PontoDoGrafico,
} from '../components/GraficosAnimados'
import { PERIODOS, inicioPeriodo, type Periodo } from '../periodo'
import { VENDEDORES } from '../types'
import { nomeDoStatus, ordemComExtras, statusAntesDe } from '../statusConfig'
import type { QuoteRecord } from '../types'
import { avisar } from '../dialogs'
import { SeletorMesReferencia, intervaloDoMes, mesesDisponiveis } from '../components/SeletorMesReferencia'
import { chaveMes, labelDoMes } from '../notasFiscaisHelpers'

const NOMES_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES_DO_PERIODO: Record<Periodo, number> = { mes: 1, bimestre: 2, semestre: 6, anual: 12 }
const NOME_DO_PERIODO: Record<Periodo, string> = { mes: 'mês', bimestre: 'bimestre', semestre: 'semestre', anual: 'ano' }

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

/** O mesmo instante `n` meses antes/depois — dia 31 num mês de 30 vira o dia 30. */
function somarMeses(ts: number, n: number): number {
  const d = new Date(ts)
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), ultimoDia), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime()
}

type Grao = 'dia' | 'semana' | 'mes'
const NOME_DO_GRAO: Record<Grao, [string, string]> = { dia: ['dia', 'dias'], semana: ['semana', 'semanas'], mes: ['mês', 'meses'] }

interface Faixa {
  inicio: number
  fim: number
  rotulo: string
  rotuloLongo: string
  hoje: boolean
}

const diaMes = (ts: number) => {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Os dias (ou semanas, ou meses) do período, até hoje — um pirulito pra cada. */
function faixasDoPeriodo(inicio: number, fim: number, grao: Grao, agora: number): Faixa[] {
  const faixas: Faixa[] = []
  let d = new Date(inicio)
  while (d.getTime() < fim) {
    const prox =
      grao === 'dia'
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
        : grao === 'semana'
          ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
          : new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const fimDaFaixa = Math.min(prox.getTime(), fim)
    faixas.push({
      inicio: d.getTime(),
      fim: fimDaFaixa,
      rotulo: grao === 'dia' ? String(d.getDate()) : grao === 'semana' ? diaMes(d.getTime()) : NOMES_MESES[d.getMonth()],
      rotuloLongo:
        grao === 'dia'
          ? `${DIAS_DA_SEMANA[d.getDay()]}, ${diaMes(d.getTime())}`
          : grao === 'semana'
            ? `semana de ${diaMes(d.getTime())} a ${diaMes(fimDaFaixa - 1)}`
            : labelDoMes(chaveMes(d)).toLowerCase(),
      hoje: agora >= d.getTime() && agora < fimDaFaixa,
    })
    d = prox
  }
  return faixas
}

const compacto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const formatarCompacto = (v: number) => compacto.format(v)
const inteiro = (v: number) => String(Math.round(v))
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Daqui em diante a cotação virou pedido (o arquivo é a que não fechou). */
const virouPedido = (status: string) => status !== 'ARQUIVO' && !statusAntesDe(status, 'PEDIDO DE COMPRA')

const corDoVendedor = (v: string) => {
  const i = VENDEDORES.indexOf(v)
  return i === -1 ? COR_OUTROS : PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]
}
const OUTROS = 'Outros'
const vendedorDaCotacao = (r: QuoteRecord) => (VENDEDORES.includes(r.vendedor) ? r.vendedor : OUTROS)

/** Os cartões entram um depois do outro (index.css, .surgir). */
const atraso = (ms: number) => ({ '--atraso': `${ms}ms` }) as CSSProperties

/** ↑ 12% / ↓ 8% em relação ao período anterior. `sobreCor`: em cima do cartão laranja. */
function Variacao({ atual, anterior, comparacao, sobreCor }: { atual: number; anterior: number; comparacao: string; sobreCor?: boolean }) {
  if (anterior <= 0) {
    if (atual <= 0) return null
    return (
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${sobreCor ? 'bg-white/20 text-white' : 'bg-sky-50 text-sky-700'}`} title={`Nada ${comparacao}`}>
        novo
      </span>
    )
  }
  const v = (atual - anterior) / anterior
  const sobe = v >= 0
  const cor = sobreCor ? 'bg-white/20 text-white' : sobe ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
  const pct = Math.abs(v * 100)
  // de 3 vezes pra cima, "12×" lê melhor que "1100%"
  const texto = atual >= anterior * 3 ? `${formatNumber(atual / anterior, atual >= anterior * 10 ? 0 : 1)}×` : `${pct >= 10 ? Math.round(pct) : formatNumber(pct, 1)}%`
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${cor}`}
      title={`Em relação ao que era ${comparacao} (até o mesmo dia, se o período ainda não acabou)`}
    >
      {sobe ? '↑' : '↓'} {texto}
    </span>
  )
}

/** Cartão de número de cima. O rótulo e o valor ficam no mesmo bloco (os testes leem o cartão pelo rótulo). */
function CartaoNumero({ icone, rotulo, children, rodape, ms }: { icone: ReactNode; rotulo: string; children: ReactNode; rodape: ReactNode; ms: number }) {
  return (
    <div className="card surgir !p-4 2xl:!p-5 flex flex-col justify-between gap-3" style={atraso(ms)}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-500 [&>svg]:h-4 [&>svg]:w-4">
        {icone}
        {rotulo}
      </p>
      <p className="font-display text-2xl 2xl:text-[1.7rem] font-bold leading-none text-ink-900 tabular-nums truncate">{children}</p>
      <div className="flex items-end justify-between gap-2 min-h-[28px]">{rodape}</div>
    </div>
  )
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
  const [medida, setMedida] = useState<'quantidade' | 'valor'>('quantidade')
  const [vendedorFoco, setVendedorFoco] = useState('')

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
  // "agora" fixo enquanto a tela está aberta: o período e a comparação não mudam sozinhos
  const agora = useMemo(() => Date.now(), [records])

  // o período mostrado e o anterior do mesmo tamanho, até o mesmo ponto (o mês até hoje × o mês passado
  // até o mesmo dia) — comparar o mês pela metade com o mês inteiro anterior sempre daria queda
  const intervalo = useMemo(() => {
    const n = mesReferencia ? 1 : MESES_DO_PERIODO[periodo]
    const { inicio, fim } = mesReferencia
      ? intervaloDoMes(mesReferencia)
      : { inicio: inicioPeriodo(periodo), fim: somarMeses(inicioPeriodo(periodo), MESES_DO_PERIODO[periodo]) }
    const hoje = new Date(agora)
    const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1).getTime()
    const fimEfetivo = Math.min(fim, agora)
    const grao: Grao = n === 1 ? 'dia' : n === 12 ? 'mes' : 'semana'
    return {
      inicio,
      fim,
      grao,
      parcial: fim > agora,
      anteriorInicio: somarMeses(inicio, -n),
      anteriorFim: Math.min(somarMeses(fimEfetivo, -n), inicio),
      faixas: faixasDoPeriodo(inicio, Math.min(fim, amanha), grao, agora),
    }
  }, [mesReferencia, periodo, agora])

  const doVendedor = (r: QuoteRecord) => !vendedorFiltro || r.vendedor === vendedorFiltro
  const filtrados = useMemo(
    () => records.filter((r) => r.createdAt >= intervalo.inicio && r.createdAt < intervalo.fim && doVendedor(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, intervalo, vendedorFiltro],
  )
  const anteriores = useMemo(
    () => records.filter((r) => r.createdAt >= intervalo.anteriorInicio && r.createdAt < intervalo.anteriorFim && doVendedor(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, intervalo, vendedorFiltro],
  )

  // como se fala do período anterior nas comparações (no período atual, sempre até o mesmo dia)
  const comparacao = mesReferencia
    ? `em ${labelDoMes(chaveMes(new Date(intervalo.anteriorInicio))).toLowerCase()}`
    : `no ${NOME_DO_PERIODO[periodo]} ${periodo === 'mes' ? 'passado' : 'anterior'}`

  function numeros(lista: QuoteRecord[]) {
    const valor = lista.reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0)
    const faturadas = lista.filter((r) => r.status === 'FATURADO')
    return {
      qtd: lista.length,
      valor,
      ticket: lista.length > 0 ? valor / lista.length : 0,
      faturadas: faturadas.length,
      faturado: faturadas.reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0),
      pedidos: lista.filter((r) => virouPedido(r.status)).length,
    }
  }
  const atual = useMemo(() => numeros(filtrados), [filtrados])
  const antes = useMemo(() => numeros(anteriores), [anteriores])
  const conversao = atual.qtd > 0 ? atual.pedidos / atual.qtd : 0
  const conversaoAntes = antes.qtd > 0 ? antes.pedidos / antes.qtd : 0

  // cada cotação na sua faixa (dia/semana/mês) — pros pirulitos, as linhas e as linhazinhas dos cartões
  const porFaixa = useMemo(() => {
    const faixas = intervalo.faixas.map(() => ({ qtd: 0, valor: 0, faturado: 0, pedidos: 0, porVendedor: {} as Record<string, number> }))
    for (const r of filtrados) {
      const i = intervalo.faixas.findIndex((f) => r.createdAt >= f.inicio && r.createdAt < f.fim)
      if (i === -1) continue
      const f = faixas[i]
      const v = r.summary.precoVendaTotalGeral
      f.qtd++
      f.valor += v
      if (r.status === 'FATURADO') f.faturado += v
      if (virouPedido(r.status)) f.pedidos++
      const vend = vendedorDaCotacao(r)
      f.porVendedor[vend] = (f.porVendedor[vend] ?? 0) + v
    }
    return faixas
  }, [filtrados, intervalo])

  const [grao1, grao2] = NOME_DO_GRAO[intervalo.grao]
  const pirulitos: PontoDoGrafico[] = intervalo.faixas.map((f, i) => ({
    rotulo: f.rotulo,
    rotuloLongo: f.rotuloLongo,
    valor: medida === 'quantidade' ? porFaixa[i].qtd : porFaixa[i].valor,
    detalhe: medida === 'quantidade' ? formatCurrency(porFaixa[i].valor) : plural(porFaixa[i].qtd, 'cotação', 'cotações'),
    hoje: f.hoje,
  }))
  const formatarMedida = medida === 'quantidade' ? (v: number) => plural(Math.round(v), 'cotação', 'cotações') : formatCurrency
  const media = pirulitos.length > 0 ? pirulitos.reduce((s, p) => s + p.valor, 0) / pirulitos.length : 0
  const acimaDaMedia = pirulitos.filter((p) => p.valor > 0 && p.valor >= media).length
  const melhor = pirulitos.reduce<PontoDoGrafico | null>((m, p) => (p.valor > (m?.valor ?? 0) ? p : m), null)

  // ticket médio acumulado ao longo do período (o de cada dia sozinho pula demais)
  const ticketAcumulado = useMemo(() => {
    let qtd = 0
    let valor = 0
    return porFaixa.map((f) => {
      qtd += f.qtd
      valor += f.valor
      return qtd > 0 ? valor / qtd : 0
    })
  }, [porFaixa])

  const statusLista = useMemo(
    () =>
      ordemComExtras('cotacoes', filtrados.map((r) => r.status))
        .map((status) => ({
          status,
          nome: nomeDoStatus(status),
          qtd: filtrados.filter((r) => r.status === status).length,
          cor: coresStatus[status] || corPadraoDoStatus(status),
        }))
        .filter((s) => s.qtd > 0),
    [filtrados, coresStatus],
  )

  // vendedores: na ordem fixa (a cor é de cada um, não da posição), quem não é da lista vira "Outros"
  const vendedores = useMemo(() => {
    const soma = (lista: QuoteRecord[], v: string) => lista.filter((r) => vendedorDaCotacao(r) === v)
    return [...VENDEDORES, OUTROS]
      .map((nome) => {
        const deAgora = soma(filtrados, nome)
        const deAntes = soma(anteriores, nome)
        return {
          nome,
          cor: corDoVendedor(nome),
          qtd: deAgora.length,
          valor: deAgora.reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0),
          valorAntes: deAntes.reduce((s, r) => s + r.summary.precoVendaTotalGeral, 0),
        }
      })
      .filter((v) => v.valor > 0 || v.valorAntes > 0)
  }, [filtrados, anteriores])
  const vendedoresAgora = vendedores.filter((v) => v.valor > 0)
  const maiorVendedor = vendedoresAgora.reduce<(typeof vendedoresAgora)[number] | null>((m, v) => (v.valor > (m?.valor ?? 0) ? v : m), null)
  const foco = vendedoresAgora.find((v) => v.nome === vendedorFoco) ?? maiorVendedor
  const maiorDosDois = Math.max(1e-9, ...vendedores.map((v) => Math.max(v.valor, v.valorAntes)))

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

  const pendentes = filtrados.filter((r) => r.status === 'PENDENTE').length
  const desde = mesReferencia
    ? `em ${labelDoMes(mesReferencia).toLowerCase()}`
    : `desde ${new Date(intervalo.inicio).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}`
  const tituloComparacao = mesReferencia
    ? `${labelDoMes(mesReferencia)} × ${labelDoMes(chaveMes(new Date(intervalo.anteriorInicio))).toLowerCase()}`
    : `Este ${NOME_DO_PERIODO[periodo]} × o ${periodo === 'mes' ? 'passado' : 'anterior'}`
  const diasCorridos = Math.max(1, Math.ceil((Math.min(intervalo.fim, agora) - intervalo.inicio) / 86400000))

  return (
    <div className="space-y-6">
      <div className="surgir">
        <h2 className="font-display text-2xl font-bold text-ink-900">Dashboard</h2>
        <p className="text-sm text-ink-400">
          Visão geral das cotações{mesReferencia ? ` — só ${labelDoMes(mesReferencia).toLowerCase()}` : ''}
        </p>
        {!loading && (
          <p className="mt-1 text-sm text-ink-600">
            <span className="font-semibold text-ink-900">{plural(atual.qtd, 'cotação', 'cotações')}</span> {desde} ·{' '}
            {formatarCompacto(atual.valor)} cotados · {plural(pendentes, 'pendente', 'pendentes')} ·{' '}
            {atual.pedidos === 1 ? '1 virou pedido' : `${atual.pedidos} viraram pedido`}
          </p>
        )}
      </div>

      {/* filtros numa linha só, em cima de tudo */}
      <div className="surgir flex flex-wrap items-end gap-x-4 gap-y-3" style={atraso(40)}>
        <div>
          <p className="field-label mb-1.5">Período</p>
          <Segmentado
            rotulo="Período"
            opcoes={PERIODOS.map((p) => ({ valor: p.value, rotulo: p.label }))}
            valor={mesReferencia ? '' : periodo}
            onChange={(p) => {
              setPeriodo(p)
              setMesReferencia('')
            }}
          />
        </div>
        <div className="w-56">
          <SeletorMesReferencia meses={meses} valor={mesReferencia} onChange={setMesReferencia} textoVazio="— usar o período —" />
        </div>
        <label className="block w-44">
          <span className="field-label mb-1.5 block">Vendedor</span>
          <select className={`field-input py-1.5 text-sm ${vendedorFiltro ? 'border-ink-400 bg-ink-100 font-semibold' : ''}`} value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)}>
            <option value="">Todos</option>
            {VENDEDORES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="card text-center text-sm text-ink-400 py-10">Carregando…</div>
      ) : (
        <>
          {/* números de cima */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div
              className="surgir rounded-2xl p-4 2xl:p-5 text-white flex flex-col justify-between gap-3 shadow-[0_10px_30px_-12px_rgba(194,65,12,0.65)]"
              style={{ ...atraso(80), backgroundImage: 'linear-gradient(135deg, #c2410c 0%, #b93a0b 55%, #9a330c 100%)' }}
            >
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/85 [&>svg]:h-4 [&>svg]:w-4">
                <IconTendencia />
                Valor total das cotações
              </p>
              <p className="font-display text-[1.7rem] 2xl:text-3xl font-bold leading-none tabular-nums truncate">
                <NumeroAnimado valor={atual.valor} formatar={formatCurrency} />
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-white/85">
                  <Variacao atual={atual.valor} anterior={antes.valor} comparacao={comparacao} sobreCor />
                  <span className="truncate">
                    {antes.valor > 0 ? `${formatarCompacto(antes.valor)} ${comparacao}` : `nada ${comparacao}`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/25 overflow-hidden" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-1000 ease-out motion-reduce:transition-none"
                    style={{ width: `${antes.valor > 0 ? Math.min(100, (atual.valor / antes.valor) * 100) : atual.valor > 0 ? 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            <CartaoNumero
              ms={140}
              icone={<IconDocumento />}
              rotulo={mesReferencia ? 'Cotações no mês' : 'Cotações no período'}
              rodape={
                <>
                  <Variacao atual={atual.qtd} anterior={antes.qtd} comparacao={comparacao} />
                  <Sparkline valores={porFaixa.map((f) => f.qtd)} />
                </>
              }
            >
              <NumeroAnimado valor={atual.qtd} formatar={inteiro} />
            </CartaoNumero>

            <CartaoNumero
              ms={200}
              icone={<IconDocumento />}
              rotulo="Ticket médio"
              rodape={
                <>
                  <Variacao atual={atual.ticket} anterior={antes.ticket} comparacao={comparacao} />
                  <Sparkline valores={ticketAcumulado} />
                </>
              }
            >
              <NumeroAnimado valor={atual.ticket} formatar={formatCurrency} />
            </CartaoNumero>

            {veFinanceiro ? (
              <CartaoNumero
                ms={260}
                icone={<IconCheck />}
                rotulo="Valor faturado"
                rodape={
                  <>
                    <span className="text-xs text-ink-500">{atual.faturadas === 1 ? '1 cotação faturada' : `${atual.faturadas} cotações faturadas`}</span>
                    <Sparkline valores={porFaixa.map((f) => f.faturado)} />
                  </>
                }
              >
                <NumeroAnimado valor={atual.faturado} formatar={formatCurrency} />
              </CartaoNumero>
            ) : (
              <CartaoNumero
                ms={260}
                icone={<IconCheck />}
                rotulo="Viraram pedido"
                rodape={
                  <>
                    <Variacao atual={conversao} anterior={conversaoAntes} comparacao={comparacao} />
                    <Sparkline valores={porFaixa.map((f) => f.pedidos)} />
                  </>
                }
              >
                <NumeroAnimado valor={conversao * 100} formatar={(v) => `${formatNumber(v, 1)}%`} />
              </CartaoNumero>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
            {/* pirulitos: cada dia do período contra a média */}
            <div className="card surgir" style={atraso(320)}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-ink-900">Cotações por {grao1}</h3>
                  <p className="text-xs text-ink-400">Cada pirulito é um {grao1} — laranja quando passou da média do período.</p>
                </div>
                <Segmentado
                  rotulo="Medida do gráfico"
                  opcoes={[
                    { valor: 'quantidade', rotulo: 'Quantidade' },
                    { valor: 'valor', rotulo: 'Valor' },
                  ]}
                  valor={medida}
                  onChange={setMedida}
                />
              </div>
              <div className="mt-4 mb-2 flex flex-wrap items-end gap-x-8 gap-y-2">
                <div>
                  <p className="text-xs text-ink-400">{medida === 'quantidade' ? 'Cotações' : 'Valor cotado'}</p>
                  <p className="font-display text-3xl font-bold text-ink-900 tabular-nums leading-tight">
                    <NumeroAnimado valor={medida === 'quantidade' ? atual.qtd : atual.valor} formatar={medida === 'quantidade' ? inteiro : formatCurrency} />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-400">Acima da média</p>
                  <p className="text-sm text-ink-900">
                    <span className="font-semibold tabular-nums">{acimaDaMedia}</span> de {plural(pirulitos.length, grao1, grao2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-400">
                    <span className="mr-1 inline-block w-3 border-t-2 border-dashed border-[#eb6834] align-middle" />
                    Média
                  </p>
                  <p className="text-sm text-ink-900 tabular-nums">
                    <span className="font-semibold">{medida === 'quantidade' ? formatNumber(media, 1) : formatarCompacto(media)}</span> por {grao1}
                  </p>
                </div>
                {melhor && (
                  <div>
                    <p className="text-xs text-ink-400">Melhor {grao1}</p>
                    <p className="text-sm text-ink-900 tabular-nums">
                      <span className="font-semibold">{medida === 'quantidade' ? inteiro(melhor.valor) : formatarCompacto(melhor.valor)}</span>{' '}
                      <span className="text-ink-500">{melhor.rotuloLongo}</span>
                    </p>
                  </div>
                )}
              </div>
              {filtrados.length === 0 ? (
                <p className="text-sm text-ink-400 text-center py-16">Nenhuma cotação nesse período.</p>
              ) : (
                <GraficoPirulitos
                  pontos={pirulitos}
                  referencia={media}
                  rotuloReferencia="média"
                  formatar={formatarMedida}
                  formatarEixo={medida === 'quantidade' ? inteiro : formatarCompacto}
                />
              )}
            </div>

            {/* status: o anel de conversão e a lista */}
            <div className="card surgir" style={atraso(380)}>
              <h3 className="font-display text-base font-semibold text-ink-900">Status das cotações</h3>
              <p className="text-xs text-ink-400 mb-4">Quantas viraram pedido e onde estão as outras.</p>
              {filtrados.length === 0 ? (
                <p className="text-sm text-ink-400 text-center py-8">Nenhuma cotação nesse período.</p>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <AnelDeProgresso fracao={conversao} tamanho={150}>
                      <p className="font-display text-3xl font-bold text-ink-900 tabular-nums leading-none">
                        <NumeroAnimado valor={conversao * 100} formatar={(v) => `${Math.round(v)}%`} />
                      </p>
                      <p className="mt-1 text-[11px] text-ink-500">viraram pedido</p>
                    </AnelDeProgresso>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-xs text-ink-400">Pedidos</p>
                        <p className="font-semibold text-ink-900 tabular-nums">
                          {atual.pedidos} <span className="font-normal text-ink-500">de {atual.qtd}</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-400">Pendentes</p>
                        <p className="font-semibold text-ink-900 tabular-nums">{pendentes}</p>
                      </div>
                    </div>
                  </div>
                  <ul className="mt-5 space-y-2.5">
                    {statusLista.map((s) => (
                      <li key={s.status}>
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span className="flex items-center gap-1.5 text-ink-700 min-w-0">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.cor }} />
                            <span className="truncate">{s.nome}</span>
                          </span>
                          <span className="font-semibold text-ink-900 tabular-nums">{s.qtd}</span>
                        </div>
                        <BarraHorizontal fracao={s.qtd / Math.max(1, atual.qtd)} cor={s.cor} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* de onde veio o valor: um cartão por vendedor; escolher um muda a linha de baixo */}
          <div className="card surgir" style={atraso(440)}>
            <h3 className="font-display text-base font-semibold text-ink-900">De onde veio o valor</h3>
            <p className="text-xs text-ink-400 mb-4">
              {formatarCompacto(atual.valor)} entre {plural(vendedoresAgora.length, 'vendedor', 'vendedores')} — clique num para ver a evolução dele.
            </p>
            {vendedoresAgora.length === 0 ? (
              <p className="text-sm text-ink-400 text-center py-6">Nenhuma cotação com vendedor nesse período.</p>
            ) : (
              <>
                <BarraDeProporcao partes={vendedoresAgora.map((v) => ({ chave: v.nome, valor: v.valor, cor: v.cor, titulo: `${v.nome}: ${formatCurrency(v.valor)}` }))} />
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3">
                  {vendedoresAgora.map((v) => {
                    const escolhido = foco?.nome === v.nome
                    return (
                      <button
                        key={v.nome}
                        type="button"
                        aria-pressed={escolhido}
                        onClick={() => setVendedorFoco(v.nome)}
                        className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0 ${escolhido ? 'bg-ink-50' : 'border-ink-100'}`}
                        style={escolhido ? { borderColor: v.cor, boxShadow: `0 0 0 1px ${v.cor}` } : undefined}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: v.cor }} />
                          {v.nome}
                        </span>
                        <span className="mt-1.5 block font-display text-lg font-bold text-ink-900 tabular-nums truncate">
                          <NumeroAnimado valor={v.valor} formatar={formatarCompacto} />
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                          <Variacao atual={v.valor} anterior={v.valorAntes} comparacao={comparacao} />
                          {Math.round((v.valor / Math.max(1e-9, atual.valor)) * 100)}% · {plural(v.qtd, 'cotação', 'cotações')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            <div className="card surgir" style={atraso(500)}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-ink-900">{foco ? `${foco.nome}: valor por ${grao1}` : 'Valor por vendedor'}</h3>
                  <p className="text-xs text-ink-400">Escolha um vendedor aqui ou nos cartões acima — a linha muda junto.</p>
                </div>
                {vendedoresAgora.length > 1 && (
                  <Segmentado rotulo="Vendedor do gráfico" opcoes={vendedoresAgora.map((v) => ({ valor: v.nome, rotulo: v.nome }))} valor={foco?.nome ?? ''} onChange={setVendedorFoco} />
                )}
              </div>
              {foco ? (
                <GraficoLinha
                  pontos={intervalo.faixas.map((f, i) => ({
                    rotulo: f.rotulo,
                    rotuloLongo: f.rotuloLongo,
                    valor: porFaixa[i].porVendedor[foco.nome] ?? 0,
                  }))}
                  cor={foco.cor}
                  formatar={formatCurrency}
                  formatarEixo={formatarCompacto}
                />
              ) : (
                <p className="text-sm text-ink-400 text-center py-16">Nenhuma cotação com vendedor nesse período.</p>
              )}
            </div>

            <div className="card surgir" style={atraso(560)}>
              <h3 className="font-display text-base font-semibold text-ink-900">{tituloComparacao}</h3>
              <p className="text-xs text-ink-400 mb-4">
                {!intervalo.parcial ? 'O período inteiro' : intervalo.grao === 'dia' ? `Os primeiros ${plural(diasCorridos, 'dia', 'dias')} de cada` : 'Até a mesma data em cada um'} —
                cinza é o anterior.
              </p>
              {vendedores.length === 0 ? (
                <p className="text-sm text-ink-400 text-center py-6">Nada em nenhum dos dois.</p>
              ) : (
                <ul className="space-y-3">
                  {vendedores.map((v) => (
                    <li key={v.nome} className="grid grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-3 text-xs">
                      <span className="text-ink-700 truncate">{v.nome}</span>
                      <BarraHorizontal fracao={v.valor / maiorDosDois} fantasma={v.valorAntes / maiorDosDois} cor={v.cor} />
                      <span className="text-right font-semibold text-ink-900 tabular-nums" title={`Antes: ${formatCurrency(v.valorAntes)}`}>
                        {formatarCompacto(v.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="mt-5 pt-4 border-t border-ink-100 space-y-2 text-sm">
                {[
                  ['Cotações', String(atual.qtd), String(antes.qtd)],
                  ['Ticket médio', formatarCompacto(atual.ticket), formatarCompacto(antes.ticket)],
                  ['Viraram pedido', `${Math.round(conversao * 100)}%`, `${Math.round(conversaoAntes * 100)}%`],
                ].map(([rotulo, agoraTexto, antesTexto]) => (
                  <div key={rotulo} className="flex items-baseline justify-between gap-2">
                    <dt className="text-ink-500">{rotulo}</dt>
                    <dd className="tabular-nums">
                      <span className="font-semibold text-ink-900">{agoraTexto}</span> <span className="text-xs text-ink-400">antes {antesTexto}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="card surgir" style={atraso(620)}>
            <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Cotações por mês</h3>
            <p className="text-xs text-ink-400 mb-4">
              {mesReferencia ? `6 meses até ${labelDoMes(mesReferencia).toLowerCase()}` : 'Últimos 6 meses'}, pelos status mais
              frequentes{vendedorFiltro ? ` de ${vendedorFiltro}` : ''}.
            </p>
            <LineChart data={tendenciaData} series={tendenciaSeries} valueFormatter={(v) => String(v)} emptyText="Nenhuma cotação registrada ainda." />
          </div>
        </>
      )}
    </div>
  )
}
