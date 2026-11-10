import { useEffect, useState } from 'react'
import { atualizarValoresEnviados, marcarAlteracoesVistas } from '../db/analysesRepo'
import { alteracoesNaoVistas } from '../alteracoesVendedor'
import { avisar, confirmar } from '../dialogs'
import { formatCurrency, formatDate } from '../utils'
import { totalAtualParaOVendedor, valoresMudaram } from '../valoresEnviados'
import { abrirAnexo } from '../vendedor/cotacaoDoVendedor'
import type { QuoteRecord } from '../types'

/** Nos detalhes da cotação (aba Cotações): o que o vendedor dela está vendo de valores — com o botão
 * de atualizar quando os de agora são outros — e o registro das alterações que ele fez. */
export function VendedorNaCotacao({ r, currentAdmin }: { r: QuoteRecord; currentAdmin: string }) {
  const [cotacao, setCotacao] = useState(r)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => setCotacao(r), [r])

  if (!cotacao.vendedor) return null
  const enviados = cotacao.valoresEnviados
  const mudou = valoresMudaram(cotacao)
  const jaFoiEnviada = cotacao.status === 'ENVIADO' || cotacao.statusHistory.some((h) => h.status === 'ENVIADO')
  const alteracoes = cotacao.alteracoesVendedor ?? []
  const naoVistas = alteracoesNaoVistas(cotacao, currentAdmin)
  const totalAgora = totalAtualParaOVendedor(cotacao.items)

  async function atualizar() {
    const ok = await confirmar(
      enviados
        ? `Trocar os valores que o vendedor ${cotacao.vendedor} vê (total ${formatCurrency(enviados.total)}) pelos de agora (total ${formatCurrency(totalAgora)})?`
        : `Mandar ao vendedor ${cotacao.vendedor} os valores de agora (total ${formatCurrency(totalAgora)})?`,
      { titulo: 'Valores do vendedor', confirmText: enviados ? 'Atualizar para o vendedor' : 'Enviar ao vendedor' },
    )
    if (!ok) return
    setOcupado(true)
    try {
      setCotacao(await atualizarValoresEnviados(cotacao.id, currentAdmin))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setOcupado(false)
    }
  }

  async function marcarVistas() {
    setOcupado(true)
    try {
      setCotacao(await marcarAlteracoesVistas(cotacao.id, currentAdmin))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="rounded-lg border border-ink-100 px-3 py-2" aria-label={`Vendedor ${cotacao.vendedor}`}>
      <p className="mb-1 text-ink-400">O que o vendedor {cotacao.vendedor} vê</p>
      {enviados ? (
        <p className="text-ink-700">
          Valores com total de <span className="font-mono font-semibold">{formatCurrency(enviados.total)}</span>, enviados em{' '}
          {formatDate(enviados.enviadoEm)} por {enviados.enviadoPor}
          {enviados.atualizadoEm && (
            <>
              {' '}
              · atualizados em {formatDate(enviados.atualizadoEm)} por {enviados.atualizadoPor}
            </>
          )}
        </p>
      ) : (
        <p className="text-ink-500">
          {jaFoiEnviada ? 'Ainda nenhum valor (a cotação foi enviada antes de os vendedores terem acesso).' : 'Os valores aparecem pra ele quando a cotação for enviada.'}
        </p>
      )}
      {(mudou || (!enviados && jaFoiEnviada)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
          {mudou && <span>Os valores de agora somam {formatCurrency(totalAgora)} — diferentes dos que ele vê.</span>}
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void atualizar()}
            className="rounded-md border border-amber-300 bg-surface px-2 py-1 font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {enviados ? 'Atualizar para o vendedor' : 'Enviar valores ao vendedor'}
          </button>
        </div>
      )}

      {(cotacao.anexosVendedor ?? []).length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-ink-400">O que o vendedor mandou (o original de onde vieram os itens)</p>
          <ul className="flex flex-wrap gap-2">
            {(cotacao.anexosVendedor ?? []).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => void abrirAnexo(cotacao.id, a).catch((err) => avisar(err instanceof Error ? err.message : 'Não consegui abrir o arquivo.'))}
                  title={`Mandado em ${formatDate(a.em)} por ${a.por}`}
                  className="rounded-md border border-ink-200 px-2 py-1 font-medium text-ink-700 transition hover:bg-ink-50"
                >
                  {a.tipo === 'application/pdf' ? '📄' : '🖼'} {a.nome}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {alteracoes.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-ink-400">Alterações feitas pelo vendedor ({alteracoes.length})</p>
          <ul className="space-y-1.5">
            {[...alteracoes].reverse().map((a) => {
              const nova = naoVistas.some((n) => n.id === a.id)
              return (
                <li key={a.id} className={`rounded-md px-2 py-1 ${nova ? 'bg-amber-50' : 'bg-ink-50'}`}>
                  <p className="text-[11px] text-ink-400">
                    {formatDate(a.em)} · {a.por}
                    {nova && <span className="ml-1 font-semibold text-amber-800">· nova</span>}
                  </p>
                  <ul>
                    {a.campos.map((c, n) => (
                      <li key={n} className="text-ink-700">
                        <span className="font-medium">{c.campo}:</span> {c.antes || '—'} → {c.depois || '—'}
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
          {naoVistas.length > 0 && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void marcarVistas()}
              className="mt-1.5 rounded-md border border-ink-200 px-2 py-1 font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50"
            >
              Marcar como visto
            </button>
          )}
        </div>
      )}
    </div>
  )
}
