import { useMemo, useState } from 'react'
import {
  COLECOES_RESTAURAVEIS,
  COLUNAS_DA_TABELA,
  analisarBackup,
  dadosDoSistema,
  lerBackup,
  restaurarDoBackup,
  type AnaliseDoBackup,
  type ItemDoBackup,
  type SituacaoNoBackup,
} from '../restaurarBackup'
import { Button } from './ui/Basics'

// Configurações > Restaurar de um backup: lê uma cópia do banco, mostra coleção por coleção o que falta
// no sistema, o que está mais novo na cópia e o que parece ter sido lançado de novo, e grava só o que
// ficar marcado, com a senha de admin. As regras ficam em restaurarBackup.ts.

const SITUACOES: Record<SituacaoNoBackup, { nome: string; plural: string; cor: string }> = {
  nova: { nome: 'Não está no sistema', plural: 'não estão no sistema', cor: 'text-emerald-700 dark:text-emerald-300' },
  maisNova: { nome: 'Mais nova no backup', plural: 'mais novas no backup', cor: 'text-sky-700 dark:text-sky-300' },
  parecida: { nome: 'Parece relançada', plural: 'parecem relançadas', cor: 'text-amber-700 dark:text-amber-300' },
  jaExiste: { nome: 'Já está no sistema', plural: 'já estão no sistema', cor: 'text-ink-400' },
  invalida: { nome: 'Com problema', plural: 'com problema', cor: 'text-rose-700 dark:text-rose-300' },
}

const chaveDe = (i: Pick<ItemDoBackup, 'colecao' | 'id'>) => `${i.colecao}:${i.id}`
const podeMarcar = (i: ItemDoBackup) => i.situacao === 'nova' || i.situacao === 'maisNova' || i.situacao === 'parecida'

export function RestaurarBackupCard() {
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [backup, setBackup] = useState<ReturnType<typeof lerBackup> | null>(null)
  const [analise, setAnalise] = useState<AnaliseDoBackup | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aberta, setAberta] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [lendo, setLendo] = useState(false)
  const [senha, setSenha] = useState('')
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ restaurados: number; falhas: string[] } | null>(null)

  async function comparar(lido: ReturnType<typeof lerBackup>) {
    const a = analisarBackup(lido, await dadosDoSistema())
    setAnalise(a)
    setMarcados(new Set(a.itens.filter((i) => i.situacao === 'nova' || i.situacao === 'maisNova').map(chaveDe)))
  }

  async function aoEscolher(file: File | undefined) {
    setErro('')
    setResultado(null)
    setAnalise(null)
    setBackup(null)
    if (!file) return
    setNomeArquivo(file.name)
    setLendo(true)
    try {
      const lido = lerBackup(await file.text())
      setBackup(lido)
      await comparar(lido)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.')
    } finally {
      setLendo(false)
    }
  }

  function alternar(chaves: string[], marcar: boolean) {
    setMarcados((atuais) => {
      const novos = new Set(atuais)
      for (const c of chaves) {
        if (marcar) novos.add(c)
        else novos.delete(c)
      }
      return novos
    })
  }

  const porColecao = useMemo(
    () =>
      COLECOES_RESTAURAVEIS.map((c) => {
        const itens = (analise?.itens ?? []).filter((i) => i.colecao === c.id)
        const conta = (s: SituacaoNoBackup) => itens.filter((i) => i.situacao === s).length
        return { ...c, itens, conta }
      }).filter((c) => c.itens.length > 0),
    [analise],
  )
  const selecionados = (analise?.itens ?? []).filter((i) => marcados.has(chaveDe(i)))
  const comPlanilha = selecionados.filter((i) => i.junto?.length).length

  async function restaurar() {
    if (!analise) return
    setErro('')
    setAndamento({ feitos: 0, total: selecionados.length })
    try {
      const r = await restaurarDoBackup(selecionados, analise.contadorNovo, senha, (feitos, total) => setAndamento({ feitos, total }))
      setResultado(r)
      setSenha('')
      if (backup) await comparar(backup)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível restaurar.')
    } finally {
      setAndamento(null)
    }
  }

  return (
    <>
      <p className="text-xs text-ink-400 mb-4">
        Traz de volta o que sumiu, a partir de uma cópia de segurança do banco (por exemplo{' '}
        <span className="font-mono">C:\FormacaoPreco\backup\antes-da-troca-…\dados.json</span> ou um arquivo de{' '}
        <span className="font-mono">backup\diario</span>). Nada do que está no sistema é apagado: o que falta entra, o que é mais novo na cópia
        volta pra versão dela, e o que parece ter sido lançado de novo vem desmarcado pra você decidir.
      </p>

      <label className="block mb-4">
        <span className="field-label">Arquivo de backup (.json)</span>
        <input type="file" accept=".json,application/json" onChange={(e) => void aoEscolher(e.target.files?.[0])} className="field-input" disabled={andamento !== null} />
      </label>

      {lendo && <p className="text-sm text-ink-400">Lendo {nomeArquivo} e comparando com o sistema…</p>}
      {erro && (
        <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {erro}
        </p>
      )}
      {resultado && (
        <div role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {resultado.restaurados} {resultado.restaurados === 1 ? 'item restaurado' : 'itens restaurados'}.
          {resultado.falhas.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-rose-800">
              {resultado.falhas.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {analise && (
        <>
          <div className="mb-3 space-y-1.5" data-resumo-restauracao>
            {porColecao.map((c) => {
              const marcaveis = c.itens.filter(podeMarcar)
              const marcadosAqui = marcaveis.filter((i) => marcados.has(chaveDe(i))).length
              return (
                <div key={c.id} className="rounded-lg border border-ink-100" data-colecao={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                    aria-expanded={aberta === c.id}
                    onClick={() => setAberta(aberta === c.id ? null : c.id)}
                  >
                    <span className="font-semibold text-ink-900">
                      {c.nome} <span className="font-normal text-ink-400">— {marcadosAqui} marcado{marcadosAqui === 1 ? '' : 's'}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-xs">
                      {(['nova', 'maisNova', 'parecida', 'jaExiste', 'invalida'] as SituacaoNoBackup[])
                        .filter((s) => c.conta(s) > 0)
                        .map((s) => (
                          <span key={s} className={SITUACOES[s].cor} data-conta={s}>
                            {c.conta(s)} {c.conta(s) === 1 ? SITUACOES[s].nome.toLowerCase() : SITUACOES[s].plural}
                          </span>
                        ))}
                    </span>
                  </button>
                  {aberta === c.id && (
                    <div className="border-t border-ink-100 p-2">
                      {marcaveis.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => alternar(marcaveis.map(chaveDe), true)}>
                            Marcar todos
                          </Button>
                          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => alternar(marcaveis.map(chaveDe), false)}>
                            Desmarcar todos
                          </Button>
                        </div>
                      )}
                      <div className="max-h-96 overflow-auto rounded-lg border border-ink-100" tabIndex={0} role="region" aria-label={`Itens de ${c.nome}`}>
                        <table className="w-full border-collapse text-xs">
                          <thead className="sticky top-0 bg-ink-50 text-left text-ink-400">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">
                                <span className="sr-only">Restaurar</span>
                              </th>
                              {COLUNAS_DA_TABELA[c.id].map((t) => (
                                <th key={t} className="px-2 py-1.5 font-medium">
                                  {t}
                                </th>
                              ))}
                              <th className="px-2 py-1.5 font-medium">Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.itens.map((i) => (
                              <tr key={chaveDe(i)} className="border-t border-ink-100" data-item-restauracao={chaveDe(i)}>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    aria-label={`Restaurar ${i.colunas[0]}`}
                                    checked={marcados.has(chaveDe(i))}
                                    disabled={!podeMarcar(i) || andamento !== null}
                                    onChange={(e) => alternar([chaveDe(i)], e.target.checked)}
                                  />
                                </td>
                                {i.colunas.map((v, k) => (
                                  <td key={k} className={`px-2 py-1.5 ${k === 0 ? 'whitespace-nowrap font-mono' : ''}`}>
                                    {v || '—'}
                                  </td>
                                ))}
                                <td className={`px-2 py-1.5 ${SITUACOES[i.situacao].cor}`}>
                                  {SITUACOES[i.situacao].nome}
                                  {i.motivo ? `: ${i.motivo}` : ''}
                                  {i.junto?.length ? ' (com a planilha do cliente)' : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {analise.contadorNovo && (
            <p className="mb-2 text-xs text-ink-500">
              O contador dos códigos de cotação vai para {analise.contadorNovo}: a próxima cotação nova será a COT-{String(analise.contadorNovo + 1).padStart(4, '0')}.
            </p>
          )}
          {comPlanilha > 0 && <p className="mb-2 text-xs text-ink-500">{comPlanilha} das cotações marcadas voltam com a planilha original do cliente.</p>}
          {analise.ignorado.length > 0 && <p className="mb-3 text-xs text-ink-400">Ficam de fora: {analise.ignorado.join(', ')}.</p>}

          <div className="flex flex-wrap items-end gap-3 border-t border-ink-100 pt-4">
            <label className="block">
              <span className="field-label">Senha de admin</span>
              <input type="password" className="field-input max-w-[12rem]" value={senha} onChange={(e) => setSenha(e.target.value)} disabled={andamento !== null} autoComplete="off" />
            </label>
            <Button variant="primary" onClick={() => void restaurar()} disabled={selecionados.length === 0 || !senha || andamento !== null}>
              {andamento ? `Restaurando ${andamento.feitos} de ${andamento.total}…` : `Restaurar ${selecionados.length} ${selecionados.length === 1 ? 'item' : 'itens'}`}
            </Button>
          </div>
        </>
      )}
    </>
  )
}
