import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENTO_COTACAO_ALTERADA, listQuotes, marcarAlteracoesVistas } from '../db/analysesRepo'
import { alteracoesNaoVistas, resumoDosCampos } from '../alteracoesVendedor'
import { avisar } from '../dialogs'
import { notificar } from '../notificacoesDoSistema'
import { formatDate } from '../utils'
import type { QuoteRecord } from '../types'

// Notificação no canto de baixo à direita (logo acima da de entregas), em qualquer aba: o vendedor
// alterou uma cotação que está com você (ou que ainda não está com ninguém). Some quando você marca
// "Vi" — o "visto" fica gravado na cotação, então vale em qualquer aparelho.

// o vendedor altera de outro computador: busca de tempos em tempos (e ao voltar pra janela do site)
const INTERVALO_BUSCA_MS = 3 * 60 * 1000
const INTERVALO_MINIMO_FOCO_MS = 60 * 1000
const LINHAS_VISIVEIS = 3

export function AvisoAlteracoesVendedor({ nome, onAbrir }: { nome: string; onAbrir: (r: QuoteRecord) => void }) {
  const [quotes, setQuotes] = useState<QuoteRecord[] | undefined>(undefined)
  const [marcando, setMarcando] = useState<string | null>(null)
  const [verTodas, setVerTodas] = useState(false)
  const ultimaBusca = useRef(0)

  const buscar = useCallback(() => {
    ultimaBusca.current = Date.now()
    listQuotes()
      .then(setQuotes)
      .catch(() => {
        // sem servidor agora: fica o que já tinha, tenta de novo na próxima
      })
  }, [])

  useEffect(() => {
    buscar()
    const intervalo = window.setInterval(buscar, INTERVALO_BUSCA_MS)
    const aoFocar = () => {
      if (Date.now() - ultimaBusca.current >= INTERVALO_MINIMO_FOCO_MS) buscar()
    }
    let espera: number | undefined
    const aoAlterar = () => {
      window.clearTimeout(espera)
      espera = window.setTimeout(buscar, 800)
    }
    window.addEventListener('focus', aoFocar)
    window.addEventListener(EVENTO_COTACAO_ALTERADA, aoAlterar)
    return () => {
      window.clearInterval(intervalo)
      window.clearTimeout(espera)
      window.removeEventListener('focus', aoFocar)
      window.removeEventListener(EVENTO_COTACAO_ALTERADA, aoAlterar)
    }
  }, [buscar])

  const avisos = useMemo(
    () =>
      (quotes ?? [])
        .map((r) => ({ r, alteracoes: alteracoesNaoVistas(r, nome) }))
        .filter((a) => a.alteracoes.length > 0)
        .sort((a, b) => b.alteracoes[b.alteracoes.length - 1].em - a.alteracoes[a.alteracoes.length - 1].em),
    [quotes, nome],
  )

  // também no canto da tela do sistema (se ligado em Configurações › Notificações): um aviso por
  // alteração nova; clicar abre a cotação
  useEffect(() => {
    for (const { r, alteracoes } of avisos) {
      const ultima = alteracoes[alteracoes.length - 1]
      notificar(`alteracao:${r.id}:${ultima.em}`, {
        titulo: `${ultima.por} alterou a ${r.codigo || 'cotação'}`,
        texto: `${r.cliente || '(sem cliente)'} — ${resumoDosCampos(alteracoes)}`,
        etiqueta: `alteracao:${r.id}`,
        aoClicar: () => onAbrir(r),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos])

  if (avisos.length === 0) return null
  const visiveis = verTodas ? avisos : avisos.slice(0, LINHAS_VISIVEIS)

  async function marcarVista(r: QuoteRecord) {
    setMarcando(r.id)
    try {
      const atualizada = await marcarAlteracoesVistas(r.id, nome)
      setQuotes((lista) => lista?.map((q) => (q.id === r.id ? atualizada : q)))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setMarcando(null)
    }
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Alterações de vendedores"
      style={{ bottom: 'calc(var(--altura-aviso-entregas, 0px) + 1rem)' }}
      className="fixed right-4 z-40 flex max-h-[min(24rem,calc(100vh-8rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-amber-300 bg-surface shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)] animate-[dialog-pop-in_0.18s_cubic-bezier(0.16,1,0.3,1)]"
    >
      <div className="flex items-start gap-3 border-b border-ink-100 px-4 py-3">
        <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-800">
          ✎
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-ink-900">Alterações de vendedores</p>
          <p className="text-xs text-ink-500">
            {avisos.length === 1 ? '1 cotação foi alterada pelo vendedor' : `${avisos.length} cotações foram alteradas pelos vendedores`}
          </p>
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
        {visiveis.map(({ r, alteracoes }) => {
          const ultima = alteracoes[alteracoes.length - 1]
          const campos = alteracoes.flatMap((a) => a.campos)
          return (
            <li key={r.id} className="rounded-xl px-2.5 py-2 hover:bg-ink-50">
              <p className="flex items-center justify-between gap-2 text-sm font-medium text-ink-800">
                <span className="min-w-0 truncate">
                  {r.codigo || '—'} · {r.cliente || '(sem cliente)'}
                </span>
                <span className="shrink-0 text-[11px] font-normal text-ink-400">{formatDate(ultima.em)}</span>
              </p>
              <p className="text-xs text-ink-500">
                {ultima.por} alterou: {resumoDosCampos(alteracoes)}
              </p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-ink-600">
                {campos.slice(0, 4).map((c, n) => (
                  <li key={n} className="truncate">
                    {c.campo}: {c.antes || '—'} → {c.depois || '—'}
                  </li>
                ))}
                {campos.length > 4 && <li className="text-ink-400">e mais {campos.length - 4} (veja em Cotações, nos detalhes da cotação)</li>}
              </ul>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => onAbrir(r)}
                  className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-ink-100"
                >
                  Abrir
                </button>
                <button
                  type="button"
                  disabled={marcando === r.id}
                  onClick={() => void marcarVista(r)}
                  aria-label={`Vi as alterações da ${r.codigo || 'cotação'}`}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 disabled:opacity-50"
                >
                  Vi
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {avisos.length > LINHAS_VISIVEIS && (
        <button
          type="button"
          onClick={() => setVerTodas((v) => !v)}
          className="border-t border-ink-100 px-4 py-2 text-xs font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
        >
          {verTodas ? 'Mostrar menos' : `Ver todas (${avisos.length})`}
        </button>
      )}
    </aside>
  )
}
