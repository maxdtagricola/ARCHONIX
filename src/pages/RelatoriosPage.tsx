import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ControleFaturamentoRelatorio } from '../components/ControleFaturamentoRelatorio'
import { SeletorMesReferencia, intervaloDoMes, mesesDisponiveis } from '../components/SeletorMesReferencia'
import { Button } from '../components/ui/Basics'
import { listQuotes } from '../db/analysesRepo'
import { avisar } from '../dialogs'
import { useEstadoPersistente } from '../estadoPersistente'
import { chaveMes, labelDoMes } from '../notasFiscaisHelpers'
import { PERIODOS, inicioPeriodo, type Periodo } from '../periodo'
import {
  linhaDaCotacao,
  margem,
  montarRelatorio,
  textoDias,
  textoPercentual,
  type EtapaRelatorio,
  type Totais,
} from '../relatorioGeral'
import { corPadraoDoStatus, corTexto } from '../statusColors'
import { nomeDoStatus, useVersaoStatus } from '../statusConfig'
import { ADMINS, type QuoteRecord } from '../types'
import { formatCurrency } from '../utils'

// -----------------------------------------------------------------------
// Relatórios — dois: o geral, em que o admin escolhe o período e de quem (só
// as dele, ou as dos admins marcados), vê o resultado na tela e gera em PDF
// ou Excel pra passar aos supervisores; e o Controle de Cotações x
// Faturamento, no formato da planilha da empresa (ControleFaturamentoRelatorio). As contas ficam em relatorioGeral.ts; os arquivos, em
// relatorioArquivos.ts (carregado só ao gerar: PDF e Excel são pesados).
// -----------------------------------------------------------------------

const celula = 'px-2 py-1.5'
const celulaNumero = `${celula} text-right font-mono tabular-nums text-ink-900`

function Numero({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-ink-400 mb-1">{titulo}</p>
      <p className="font-display text-2xl font-semibold tabular-nums text-ink-900">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-ink-500">{detalhe}</p>}
    </div>
  )
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h3 className="font-display text-base font-semibold text-ink-900 mb-1">{titulo}</h3>
      {descricao && <p className="text-xs text-ink-400 mb-3">{descricao}</p>}
      {children}
    </section>
  )
}

/** Rola de lado no celular — com tabIndex, pelo teclado também. */
function Tabela({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-100" tabIndex={0} role="region" aria-label={rotulo}>
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  )
}

/** Margem no vermelho quando a venda fica abaixo do custo (o sinal de menos também aparece no número). */
function CelulaMargem({ valor, custo }: { valor: number; custo: number }) {
  const m = margem(valor, custo)
  return <td className={`${celulaNumero} ${m !== undefined && m < 0 ? 'text-rose-700 dark:text-rose-300' : ''}`}>{textoPercentual(m)}</td>
}

function CelulasDeTotais({ totais: t }: { totais: Totais }) {
  return (
    <>
      <td className={celulaNumero}>{t.quantidade}</td>
      <td className={celulaNumero}>{formatCurrency(t.valorCotado)}</td>
      <td className={celulaNumero}>{formatCurrency(t.custo)}</td>
      <CelulaMargem valor={t.valorCotado} custo={t.custo} />
      <td className={celulaNumero}>{formatCurrency(t.faturado)}</td>
      <CelulaMargem valor={t.faturado} custo={t.custoDoFaturado} />
      <td className={celulaNumero}>{t.aFaturar > 0 ? formatCurrency(t.aFaturar) : '—'}</td>
    </>
  )
}

function TitulosDeTotais({ primeira }: { primeira: string }) {
  return (
    <thead>
      <tr className="bg-ink-50 text-left text-ink-400">
        <th className={`${celula} font-medium`}>{primeira}</th>
        {['Cotações', 'Valor cotado', 'Custo', 'Margem', 'Faturado', 'Margem faturada', 'A faturar'].map((t) => (
          <th key={t} className={`${celula} font-medium text-right`}>
            {t}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function RelatoriosPage({ currentAdmin }: { currentAdmin: string }) {
  const [cotacoes, setCotacoes] = useState<QuoteRecord[]>([])
  const [carregando, setCarregando] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  // "AAAA-MM": mostra só esse mês (no lugar do Período); vazio = vale o Período
  const [mesReferencia, setMesReferencia] = useState('')
  const [admins, setAdmins] = useState<string[]>([currentAdmin])
  const [etapaFiltro, setEtapaFiltro] = useState<EtapaRelatorio | ''>('')
  const [gerando, setGerando] = useState<'pdf' | 'excel' | null>(null)
  const [qual, setQual] = useEstadoPersistente<'geral' | 'controle'>('relatorios:qual', 'geral')
  useVersaoStatus()

  useEffect(() => {
    listQuotes()
      .then(setCotacoes)
      .catch((err) => void avisar(err instanceof Error ? err.message : 'Erro ao carregar cotações do servidor.'))
      .finally(() => setCarregando(false))
  }, [])

  const todas = useMemo(() => cotacoes.map(linhaDaCotacao), [cotacoes])
  const meses = useMemo(() => mesesDisponiveis(todas.map((l) => chaveMes(new Date(l.criadaEm)))), [todas])
  // quem pode ser marcado vem das cotações: a lista de usuários, o servidor só entrega ao gestor
  const adminsDisponiveis = useMemo(
    () => [...new Set([...ADMINS, currentAdmin, ...todas.map((l) => l.admin)])].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [todas, currentAdmin],
  )

  const { inicio, fim } = mesReferencia ? intervaloDoMes(mesReferencia) : { inicio: inicioPeriodo(periodo), fim: Infinity }
  const relatorio = useMemo(() => montarRelatorio(todas, { inicio, fim, admins }), [todas, inicio, fim, admins])
  const { totais } = relatorio
  const linhasVisiveis = etapaFiltro ? relatorio.linhas.filter((l) => l.etapa === etapaFiltro) : relatorio.linhas

  const textoPeriodo = mesReferencia
    ? labelDoMes(mesReferencia)
    : `${PERIODOS.find((p) => p.value === periodo)?.label}, de ${new Date(inicio).toLocaleDateString('pt-BR')} até hoje`

  function alternarAdmin(admin: string) {
    setAdmins((atuais) => (atuais.includes(admin) ? atuais.filter((a) => a !== admin) : [...atuais, admin]))
  }

  async function gerar(tipo: 'pdf' | 'excel') {
    setGerando(tipo)
    try {
      const { baixarRelatorioExcel, baixarRelatorioPdf } = await import('../relatorioArquivos')
      const dados = { relatorio, periodo: textoPeriodo, admins, geradoPor: currentAdmin }
      if (tipo === 'pdf') baixarRelatorioPdf(dados)
      else await baixarRelatorioExcel(dados)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao gerar o relatório.')
    } finally {
      setGerando(null)
    }
  }

  const semCotacoes = relatorio.linhas.length === 0

  const escolha = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Qual relatório">
      {(
        [
          ['geral', 'Relatório geral'],
          ['controle', 'Controle de Cotações x Faturamento'],
        ] as const
      ).map(([id, nome]) => (
        <button
          key={id}
          type="button"
          aria-pressed={qual === id}
          onClick={() => setQual(id)}
          className={`pill-tab border ${qual === id ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 bg-surface text-ink-600 hover:bg-ink-50'}`}
        >
          {nome}
        </button>
      ))}
    </div>
  )

  if (qual === 'controle') {
    return (
      <div className="space-y-5">
        {escolha}
        <ControleFaturamentoRelatorio cotacoes={cotacoes} carregando={carregando} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {escolha}
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Relatórios</h2>
        <p className="text-sm text-ink-400 mb-4">
          Relatório geral pros supervisores: preço, prazo, valores e margens, das cotações não fechadas às faturadas. Entra a
          cotação criada ou faturada no período.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          <div>
            <p className="field-label mb-1.5">Período</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {PERIODOS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={!mesReferencia && periodo === p.value}
                  onClick={() => {
                    setPeriodo(p.value)
                    setMesReferencia('')
                  }}
                  className={`pill-tab border ${
                    !mesReferencia && periodo === p.value ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <SeletorMesReferencia meses={meses} valor={mesReferencia} onChange={setMesReferencia} />
          </div>

          <fieldset>
            <legend className="field-label mb-1.5">De quem</legend>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button type="button" className="px-3 py-1 text-xs" onClick={() => setAdmins([currentAdmin])}>
                Só as minhas
              </Button>
              <Button type="button" className="px-3 py-1 text-xs" onClick={() => setAdmins(adminsDisponiveis)}>
                Todos os admins
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {adminsDisponiveis.map((admin) => (
                <label key={admin} className="inline-flex items-center gap-1.5 text-sm text-ink-700">
                  <input type="checkbox" checked={admins.includes(admin)} onChange={() => alternarAdmin(admin)} />
                  {admin}
                  {admin === currentAdmin && <span className="text-xs text-ink-400">(você)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
          <Button type="button" variant="primary" disabled={semCotacoes || gerando !== null} onClick={() => void gerar('pdf')}>
            {gerando === 'pdf' ? 'Gerando…' : 'Gerar PDF'}
          </Button>
          <Button type="button" disabled={semCotacoes || gerando !== null} onClick={() => void gerar('excel')}>
            {gerando === 'excel' ? 'Gerando…' : 'Gerar Excel'}
          </Button>
          <span className="text-xs text-ink-400">{textoPeriodo}</span>
        </div>
      </div>

      {carregando ? (
        <div className="card text-center text-sm text-ink-400 py-10">Carregando…</div>
      ) : semCotacoes ? (
        <div className="card text-center text-sm text-ink-400 py-10">
          {admins.length === 0 ? 'Marque ao menos um admin.' : 'Nenhuma cotação nesse período pra quem foi marcado.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Numero
              titulo="Cotações"
              valor={String(totais.quantidade)}
              detalhe={`${relatorio.fechadas} fecharam (${textoPercentual(relatorio.fechadas / totais.quantidade)})`}
            />
            <Numero titulo="Valor cotado" valor={formatCurrency(totais.valorCotado)} detalhe={`Custo: ${formatCurrency(totais.custo)}`} />
            <Numero
              titulo="Margem cotada"
              valor={textoPercentual(margem(totais.valorCotado, totais.custo))}
              detalhe={`Definida na precificação: ${textoPercentual(totais.valorCotado > 0 ? totais.lucroDefinido / totais.valorCotado : undefined)}`}
            />
            <Numero
              titulo="Faturamento final"
              valor={formatCurrency(totais.faturado)}
              detalhe={`Margem faturada: ${textoPercentual(margem(totais.faturado, totais.custoDoFaturado))}${
                totais.aFaturar > 0 ? ` · a faturar: ${formatCurrency(totais.aFaturar)}` : ''
              }`}
            />
          </div>

          {relatorio.estimadas > 0 && (
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {relatorio.estimadas === 1 ? '1 cotação faturada está' : `${relatorio.estimadas} cotações faturadas estão`} sem o valor
              registrado na aba Faturamento: {relatorio.estimadas === 1 ? 'entra' : 'entram'} pelo preço passado na cotação.
            </p>
          )}

          <Secao titulo="Situação das cotações" descricao="Clique numa situação pra ver só as cotações dela, na lista lá embaixo.">
            <Tabela rotulo="Situação das cotações">
              <TitulosDeTotais primeira="Situação" />
              <tbody>
                {relatorio.porEtapa.map((e) => (
                  <tr key={e.etapa} className={`border-t border-ink-100 ${etapaFiltro === e.etapa ? 'bg-ink-100' : ''}`}>
                    <td className={celula}>
                      <button
                        type="button"
                        aria-pressed={etapaFiltro === e.etapa}
                        disabled={e.totais.quantidade === 0}
                        title={e.detalhe}
                        onClick={() => setEtapaFiltro((atual) => (atual === e.etapa ? '' : e.etapa))}
                        className="text-left font-medium text-ink-800 underline-offset-2 hover:underline disabled:text-ink-400 disabled:no-underline"
                      >
                        {e.nome}
                      </button>
                    </td>
                    <CelulasDeTotais totais={e.totais} />
                  </tr>
                ))}
                <tr className="border-t border-ink-200 font-semibold">
                  <td className={`${celula} text-ink-900`}>Total</td>
                  <CelulasDeTotais totais={totais} />
                </tr>
              </tbody>
            </Tabela>
          </Secao>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Secao titulo="Prazos médios" descricao="Em dias úteis, das cotações que já passaram por cada etapa.">
              <Tabela rotulo="Prazos médios">
                <thead>
                  <tr className="bg-ink-50 text-left text-ink-400">
                    <th className={`${celula} font-medium`}>Etapa</th>
                    <th className={`${celula} font-medium text-right`}>Média</th>
                    <th className={`${celula} font-medium text-right`}>Cotações medidas</th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio.prazos.map((p) => (
                    <tr key={p.rotulo} className="border-t border-ink-100">
                      <td className={celula}>
                        <span className="block font-medium text-ink-800">{p.rotulo}</span>
                        <span className="text-ink-400">{p.detalhe}</span>
                      </td>
                      <td className={celulaNumero}>{textoDias(p.media)}</td>
                      <td className={celulaNumero}>{p.cotacoes}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </Secao>

            <Secao titulo="Por que não fecharam" descricao="Motivo informado ao arquivar a cotação.">
              {relatorio.motivos.length === 0 ? (
                <p className="text-sm text-ink-400 py-4 text-center">Nenhuma cotação arquivada sem fechar.</p>
              ) : (
                <Tabela rotulo="Por que não fecharam">
                  <thead>
                    <tr className="bg-ink-50 text-left text-ink-400">
                      <th className={`${celula} font-medium`}>Motivo</th>
                      <th className={`${celula} font-medium text-right`}>Cotações</th>
                      <th className={`${celula} font-medium text-right`}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.motivos.map((m) => (
                      <tr key={m.motivo} className="border-t border-ink-100">
                        <td className={`${celula} text-ink-800`}>{m.motivo}</td>
                        <td className={celulaNumero}>{m.quantidade}</td>
                        <td className={celulaNumero}>{formatCurrency(m.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </div>

          {relatorio.porAdmin.length > 1 && (
            <Secao titulo="Por admin">
              <Tabela rotulo="Por admin">
                <TitulosDeTotais primeira="Admin" />
                <tbody>
                  {relatorio.porAdmin.map((a) => (
                    <tr key={a.admin} className="border-t border-ink-100">
                      <td className={`${celula} font-medium text-ink-800`}>{a.admin}</td>
                      <CelulasDeTotais totais={a.totais} />
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </Secao>
          )}

          <Secao
            titulo={`Cotações (${linhasVisiveis.length})`}
            descricao="Cotação fechada só com alguns itens conta só esses itens. Com o pedido fechado, o custo é o que fechou com o fornecedor."
          >
            <Tabela rotulo="Cotações do relatório">
              <thead>
                <tr className="bg-ink-50 text-left text-ink-400">
                  {['Cotação', 'Criada', 'Cliente', 'Admin', 'Status', 'Prazo'].map((t) => (
                    <th key={t} className={`${celula} font-medium`}>
                      {t}
                    </th>
                  ))}
                  {['Valor cotado', 'Custo', 'Margem', 'Faturado', 'A faturar'].map((t) => (
                    <th key={t} className={`${celula} font-medium text-right`}>
                      {t}
                    </th>
                  ))}
                  <th className={`${celula} font-medium`}>Nota</th>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((l) => {
                  const cor = corPadraoDoStatus(l.status)
                  return (
                    <tr key={l.id} className="border-t border-ink-100">
                      <td className={`${celula} whitespace-nowrap font-mono text-ink-800`}>{l.codigo}</td>
                      <td className={`${celula} whitespace-nowrap text-ink-600`}>{new Date(l.criadaEm).toLocaleDateString('pt-BR')}</td>
                      <td className={`${celula} max-w-[14rem] truncate text-ink-800`} title={l.cliente}>
                        {l.cliente || '—'}
                      </td>
                      <td className={`${celula} whitespace-nowrap text-ink-600`}>{l.admin}</td>
                      <td className={celula} title={l.motivo ? [l.motivo, l.motivoDetalhe].filter(Boolean).join(': ') : undefined}>
                        <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: cor, color: corTexto(cor) }}>
                          {nomeDoStatus(l.status)}
                        </span>
                      </td>
                      <td className={`${celula} max-w-[10rem] truncate text-ink-600`} title={l.prazoInformado}>
                        {l.prazoInformado || '—'}
                      </td>
                      <td className={celulaNumero}>{formatCurrency(l.valorCotado)}</td>
                      <td className={celulaNumero}>{formatCurrency(l.custo)}</td>
                      <CelulaMargem valor={l.valorCotado} custo={l.custo} />
                      <td className={celulaNumero} title={l.faturadoEstimado ? 'Sem valor registrado na aba Faturamento: é o preço passado na cotação' : undefined}>
                        {l.faturado > 0 ? `${formatCurrency(l.faturado)}${l.faturadoEstimado ? ' *' : ''}` : '—'}
                        {l.etapa === 'parcial' && l.partesFaturadas > 0 && (
                          <span className="block text-[10px] text-amber-700">em {l.partesFaturadas} parte{l.partesFaturadas === 1 ? '' : 's'}</span>
                        )}
                      </td>
                      <td className={celulaNumero}>{l.aFaturar > 0 ? formatCurrency(l.aFaturar) : '—'}</td>
                      <td className={`${celula} whitespace-nowrap text-ink-600`}>{l.notaFaturamento || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabela>
          </Secao>
        </>
      )}
    </div>
  )
}
