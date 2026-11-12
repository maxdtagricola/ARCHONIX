import { Fragment, useMemo, useState } from 'react'
import {
  AGRUPAMENTOS,
  COLUNA,
  COLUNAS,
  FORMATO_PADRAO,
  agrupar,
  fechamentoDaColuna,
  filtrar,
  formatoValido,
  linhasDaCotacao,
  ordenar,
  valorDaColuna,
  type Agrupamento,
  type DataDeReferencia,
  type FormatoDoControle,
  type IdColuna,
  type LinhaControle,
  type Situacao,
  type ValorDaCelula,
} from '../controleFaturamento'
import { avisar } from '../dialogs'
import { useEstadoPersistente } from '../estadoPersistente'
import { chaveMes, labelDoMes } from '../notasFiscaisHelpers'
import { formatarNumeroBR, formatarNumeroCurtoBR } from '../numeros'
import { PERIODOS, inicioPeriodo, type Periodo } from '../periodo'
import type { QuoteRecord } from '../types'
import { formatCurrency } from '../utils'
import { SeletorMesReferencia, intervaloDoMes, mesesDisponiveis } from './SeletorMesReferencia'
import { Button } from './ui/Basics'

// -----------------------------------------------------------------------
// Relatórios > Controle de Cotações x Faturamento: a planilha da empresa
// dentro do sistema, montada sozinha a partir das cotações. O formato
// (colunas, ordem, agrupamento) fica salvo neste aparelho; as linhas
// retiradas valem só pra esta visita e não mudam nada nas cotações. As contas
// ficam em controleFaturamento.ts; o Excel, em controleFaturamentoExcel.ts.
// -----------------------------------------------------------------------

const celula = 'px-2 py-1.5 align-top'
const pill = (ativo: boolean) => `pill-tab border ${ativo ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`

const SITUACOES: { id: Situacao; nome: string }[] = [
  { id: 'todas', nome: 'Todas' },
  { id: 'faturadas', nome: 'Faturadas' },
  { id: 'aFaturar', nome: 'A faturar' },
  // pedidos faturados em partes (o que chegou já foi, o resto a caminho ou a faturar)
  { id: 'emParte', nome: 'Faturadas em parte' },
]

function textoDaCelula(id: IdColuna, valor: ValorDaCelula): string {
  if (valor === undefined || valor === '') return ''
  const tipo = COLUNA[id].tipo
  if (typeof valor === 'string') return valor
  if (tipo === 'moeda') return formatCurrency(valor)
  if (tipo === 'percentual') return `${formatarNumeroBR(valor * 100, 2)}%`
  if (tipo === 'data') return new Date(valor).toLocaleDateString('pt-BR')
  if (tipo === 'quantidade') return formatarNumeroCurtoBR(valor, 3)
  if (tipo === 'dias') return formatarNumeroBR(valor, Number.isInteger(valor) ? 0 : 1)
  return String(valor)
}

const ehNumero = (id: IdColuna) => COLUNA[id].tipo !== 'texto' && COLUNA[id].tipo !== 'data'

/** Os textos longos quebram linha (com uma largura mínima); o resto fica numa linha só e a tabela rola de lado. */
const LARGURA_NA_TELA: Partial<Record<IdColuna, string>> = {
  cliente: 'min-w-[11rem]',
  descricao: 'min-w-[14rem]',
  observacao: 'min-w-[16rem]',
  fornecedor: 'min-w-[11rem]',
  maquina: 'min-w-[9rem]',
}

/** Margem final no vermelho quando dá prejuízo e em âmbar quando fica abaixo da prevista. */
function corDaCelula(id: IdColuna, l: LinhaControle): string {
  if (id !== 'margemFinal' && id !== 'margemBruta') return ''
  const v = valorDaColuna(l, id)
  if (typeof v !== 'number') return ''
  if (v < 0) return 'text-rose-700 dark:text-rose-300'
  if (id === 'margemFinal' && v < l.margemPrevista - 0.00005) return 'text-amber-700 dark:text-amber-300'
  return ''
}

function LinhaDeFechamento({ rotulo, linhas, colunas, destaque }: { rotulo: string; linhas: LinhaControle[]; colunas: IdColuna[]; destaque: string }) {
  return (
    <tr className={`${destaque} font-semibold text-ink-900`} data-fechamento={rotulo}>
      <td className={celula} />
      {colunas.map((id, i) => {
        const valor = fechamentoDaColuna(linhas, id)
        const rotuloAqui = i === colunas.findIndex((c) => COLUNA[c].tipo === 'texto' && !COLUNA[c].fechamento)
        return (
          <td key={id} className={`${celula} ${ehNumero(id) ? 'text-right font-mono tabular-nums' : ''} whitespace-nowrap`}>
            {rotuloAqui ? rotulo : textoDaCelula(id, valor)}
          </td>
        )
      })}
    </tr>
  )
}

export function ControleFaturamentoRelatorio({ cotacoes, carregando }: { cotacoes: QuoteRecord[]; carregando: boolean }) {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [mesReferencia, setMesReferencia] = useState('')
  const [dataDeReferencia, setDataDeReferencia] = useState<DataDeReferencia>('confirmacao')
  const [situacao, setSituacao] = useState<Situacao>('todas')
  const [vendedores, setVendedores] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [formatoSalvo, setFormatoSalvo] = useEstadoPersistente<FormatoDoControle>('relatorios:controleFaturamento:formato', FORMATO_PADRAO)
  const formato = formatoValido(formatoSalvo)
  const mudarFormato = (mudanca: Partial<FormatoDoControle>) => setFormatoSalvo({ ...formato, ...mudanca })
  const [retiradas, setRetiradas] = useState<Set<string>>(new Set())
  const [editandoColunas, setEditandoColunas] = useState(false)
  const [gerando, setGerando] = useState(false)

  const todas = useMemo(() => cotacoes.flatMap(linhasDaCotacao), [cotacoes])
  const meses = useMemo(
    () =>
      mesesDisponiveis(
        todas.flatMap((l) => {
          const data = dataDeReferencia === 'confirmacao' ? l.dataConfirmacao : l.dataFaturamento
          return data === undefined ? [] : [chaveMes(new Date(data))]
        }),
      ),
    [todas, dataDeReferencia],
  )
  const vendedoresDisponiveis = useMemo(() => [...new Set(todas.map((l) => l.vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [todas])

  const { inicio, fim } = mesReferencia ? intervaloDoMes(mesReferencia) : { inicio: inicioPeriodo(periodo), fim: Infinity }
  const filtradas = useMemo(
    () => ordenar(filtrar(todas, { inicio, fim, dataDeReferencia, situacao, vendedores, busca }), formato.ordem),
    [todas, inicio, fim, dataDeReferencia, situacao, vendedores, busca, formato.ordem],
  )
  const visiveis = filtradas.filter((l) => !retiradas.has(l.chave))
  const retiradasAqui = filtradas.length - visiveis.length
  const grupos = agrupar(visiveis, formato.agrupar)
  const colunas = formato.colunas
  const escondidas = COLUNAS.filter((c) => !colunas.includes(c.id))

  function ordenarPor(id: IdColuna) {
    const atual = formato.ordem
    // crescente → decrescente → ordem da planilha
    mudarFormato({ ordem: atual?.coluna !== id ? { coluna: id, desc: false } : atual.desc ? null : { coluna: id, desc: true } })
  }

  function moverColuna(id: IdColuna, passo: -1 | 1) {
    const i = colunas.indexOf(id)
    const j = i + passo
    if (j < 0 || j >= colunas.length) return
    const novas = [...colunas]
    ;[novas[i], novas[j]] = [novas[j], novas[i]]
    mudarFormato({ colunas: novas })
  }

  function alternarVendedor(v: string) {
    setVendedores((atuais) => (atuais.includes(v) ? atuais.filter((x) => x !== v) : [...atuais, v]))
  }

  async function baixarExcel() {
    setGerando(true)
    try {
      const { baixarControleExcel } = await import('../controleFaturamentoExcel')
      await baixarControleExcel({ colunas, linhas: visiveis, grupos })
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao gerar o Excel.')
    } finally {
      setGerando(false)
    }
  }

  const textoPeriodo = mesReferencia
    ? labelDoMes(mesReferencia)
    : `${PERIODOS.find((p) => p.value === periodo)?.label}, de ${new Date(inicio).toLocaleDateString('pt-BR')} até hoje`

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Controle de Cotações x Faturamento</h2>
        <p className="text-sm text-ink-400 mb-4">
          Uma linha por item vendido: o que foi orçado e o que foi faturado, no formato da planilha. Tire ou ponha colunas, retire linhas,
          ordene e agrupe; o Excel sai como estiver aqui.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          <div>
            <p className="field-label mb-1.5">Período, pela data</p>
            <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Data de referência">
              {(
                [
                  ['confirmacao', 'da confirmação do pedido'],
                  ['faturamento', 'do faturamento'],
                ] as const
              ).map(([id, nome]) => (
                <button key={id} type="button" aria-pressed={dataDeReferencia === id} onClick={() => setDataDeReferencia(id)} className={pill(dataDeReferencia === id)}>
                  {nome}
                </button>
              ))}
            </div>
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
                  className={pill(!mesReferencia && periodo === p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <SeletorMesReferencia meses={meses} valor={mesReferencia} onChange={setMesReferencia} />
          </div>

          <div className="space-y-3">
            <div>
              <p className="field-label mb-1.5">Situação</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
                {SITUACOES.map((s) => (
                  <button key={s.id} type="button" aria-pressed={situacao === s.id} onClick={() => setSituacao(s.id)} className={pill(situacao === s.id)}>
                    {s.nome}
                  </button>
                ))}
              </div>
            </div>
            <fieldset>
              <legend className="field-label mb-1.5">Vendedores</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <label className="inline-flex items-center gap-1.5 text-sm text-ink-700">
                  <input type="checkbox" checked={vendedores.length === 0} onChange={() => setVendedores([])} />
                  Todos
                </label>
                {vendedoresDisponiveis.map((v) => (
                  <label key={v} className="inline-flex items-center gap-1.5 text-sm text-ink-700">
                    <input type="checkbox" checked={vendedores.includes(v)} onChange={() => alternarVendedor(v)} />
                    {v}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="field-label">Buscar</span>
              <input className="field-input" placeholder="Cliente, código, descrição, cotação…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-ink-100 pt-4">
          <label className="block">
            <span className="field-label">Agrupar por</span>
            <select className="field-input" value={formato.agrupar} onChange={(e) => mudarFormato({ agrupar: e.target.value as Agrupamento })}>
              {AGRUPAMENTOS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" aria-expanded={editandoColunas} onClick={() => setEditandoColunas((v) => !v)}>
            Colunas ({colunas.length})
          </Button>
          <Button type="button" variant="ghost" onClick={() => setFormatoSalvo(FORMATO_PADRAO)}>
            Voltar ao formato padrão
          </Button>
          <Button type="button" variant="primary" disabled={visiveis.length === 0 || gerando} onClick={() => void baixarExcel()}>
            {gerando ? 'Gerando…' : 'Baixar Excel'}
          </Button>
          <span className="text-xs text-ink-400">{textoPeriodo}</span>
        </div>

        {editandoColunas && (
          <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-ink-100 p-3 md:grid-cols-2" data-editor-colunas>
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-900">No relatório, nesta ordem</p>
              <ol className="space-y-1">
                {colunas.map((id, i) => (
                  <li key={id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2 py-1 text-xs">
                    <span className="min-w-0 truncate" title={COLUNA[id].descricao}>
                      <span className="text-ink-400">{i + 1}.</span> {COLUNA[id].titulo}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button type="button" className="rounded px-1.5 hover:bg-ink-100 disabled:opacity-30" disabled={i === 0} onClick={() => moverColuna(id, -1)} aria-label={`Subir ${COLUNA[id].titulo}`}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded px-1.5 hover:bg-ink-100 disabled:opacity-30"
                        disabled={i === colunas.length - 1}
                        onClick={() => moverColuna(id, 1)}
                        aria-label={`Descer ${COLUNA[id].titulo}`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="rounded px-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-30"
                        disabled={colunas.length === 1}
                        onClick={() => mudarFormato({ colunas: colunas.filter((c) => c !== id) })}
                        aria-label={`Tirar ${COLUNA[id].titulo}`}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-900">Dá pra acrescentar</p>
              {escondidas.length === 0 ? (
                <p className="text-xs text-ink-400">Todas as colunas já estão no relatório.</p>
              ) : (
                <ul className="space-y-1">
                  {escondidas.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg border border-ink-100 px-2 py-1 text-left text-xs hover:bg-ink-50"
                        onClick={() => mudarFormato({ colunas: [...colunas, c.id] })}
                        aria-label={`Acrescentar ${c.titulo}`}
                      >
                        <span className="font-medium text-ink-900">+ {c.titulo}</span> <span className="text-ink-400">— {c.descricao}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {carregando ? (
        <div className="card text-center text-sm text-ink-400 py-10">Carregando…</div>
      ) : filtradas.length === 0 ? (
        <div className="card text-center text-sm text-ink-400 py-10">Nenhum item vendido nesse período com esses filtros.</div>
      ) : (
        <section className="card">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500" data-contagem-controle>
            <span>
              {visiveis.length} {visiveis.length === 1 ? 'linha' : 'linhas'}
            </span>
            {retiradasAqui > 0 && (
              <span>
                {retiradasAqui} retirada{retiradasAqui === 1 ? '' : 's'} do relatório{' '}
                <button type="button" className="font-medium text-ink-700 underline" onClick={() => setRetiradas(new Set())}>
                  Trazer de volta
                </button>
              </span>
            )}
            <span>Clique no título de uma coluna para ordenar por ela.</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-ink-100" tabIndex={0} role="region" aria-label="Controle de Cotações x Faturamento">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#425D90] text-white">
                  <th className={`${celula} w-8`}>
                    <span className="sr-only">Retirar</span>
                  </th>
                  {colunas.map((id) => {
                    const ordem = formato.ordem?.coluna === id ? formato.ordem : null
                    return (
                      <th key={id} className={`${celula} font-semibold`} aria-sort={ordem ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
                        <button type="button" onClick={() => ordenarPor(id)} className="w-full text-center leading-tight" title={COLUNA[id].descricao}>
                          {COLUNA[id].titulo}
                          {ordem ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {(grupos ?? [{ titulo: '', linhas: visiveis }]).map((g) => (
                  <Fragment key={g.titulo || 'todas'}>
                    {grupos && (
                      <tr className="bg-ink-100">
                        <td colSpan={colunas.length + 1} className={`${celula} font-semibold text-ink-900`}>
                          {g.titulo} <span className="font-normal text-ink-400">({g.linhas.length})</span>
                        </td>
                      </tr>
                    )}
                    {g.linhas.map((l, i) => (
                      <tr key={l.chave} className={`border-t border-ink-100 ${i % 2 ? 'bg-[#F9F9FF] dark:bg-ink-50' : ''}`} data-linha-controle={l.chave}>
                        <td className={celula}>
                          <button
                            type="button"
                            className="rounded px-1 text-ink-300 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setRetiradas((atuais) => new Set(atuais).add(l.chave))}
                            aria-label={`Retirar do relatório: ${l.descricao || l.interno} (${l.cliente})`}
                            title="Retirar esta linha do relatório (não muda a cotação)"
                          >
                            ✕
                          </button>
                        </td>
                        {colunas.map((id) => (
                          <td
                            key={id}
                            className={`${celula} ${ehNumero(id) ? 'text-right font-mono tabular-nums' : ''} ${LARGURA_NA_TELA[id] ?? 'whitespace-nowrap'} text-ink-800 ${corDaCelula(id, l)}`}
                            title={id === 'codigo' ? l.status : undefined}
                          >
                            {textoDaCelula(id, valorDaColuna(l, id))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {grupos && <LinhaDeFechamento rotulo={`Subtotal — ${g.titulo}`} linhas={g.linhas} colunas={colunas} destaque="bg-ink-50 border-t border-ink-200" />}
                  </Fragment>
                ))}
                <LinhaDeFechamento rotulo="Total / Média" linhas={visiveis} colunas={colunas} destaque="bg-ink-100 border-t-2 border-ink-300" />
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-400">
            Margem final: o lucro refeito com o valor faturado e o custo do fechamento, com os mesmos impostos, comissão e custo fixo da
            precificação. Em âmbar, quando ficou abaixo da prevista. No total, as margens são médias pesadas pelo valor.
          </p>
        </section>
      )}
    </div>
  )
}
