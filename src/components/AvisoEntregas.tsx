import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENTO_COTACAO_ALTERADA, listQuotes } from '../db/analysesRepo'
import { useVersaoFeriados } from '../diasUteis'
import { assinaturaDosAvisos, avisosDeEntrega, type AvisoEntrega, type SituacaoEntrega } from '../avisosEntrega'
import { notificar } from '../notificacoesDoSistema'
import { situacaoDaPrevisao } from './TransporteFornecedor'
import type { QuoteRecord } from '../types'

// Notificação no canto de baixo à direita, em qualquer aba: nota com a previsão de entrega vencida,
// pra hoje ou chegando nos próximos dias úteis. Dispensada no "×", só volta quando a lista muda
// (outra nota, nota que mudou de situação) ou no dia seguinte — preferência deste aparelho.

const CHAVE_DISPENSADO = 'avisoEntregas:dispensado'
// as cotações são buscadas de novo de tempos em tempos (a previsão vira "hoje"/"atrasada" sozinha)
const INTERVALO_BUSCA_MS = 10 * 60 * 1000
// voltar pra janela do site busca de novo, mas não mais que uma vez por minuto
const INTERVALO_MINIMO_FOCO_MS = 60 * 1000
const LINHAS_VISIVEIS = 4

const SELO: Record<SituacaoEntrega, { texto: string; classe: string }> = {
  atrasada: { texto: 'Atrasada', classe: 'border-rose-300 bg-rose-50 text-rose-700' },
  hoje: { texto: 'Chega hoje', classe: 'border-amber-300 bg-amber-50 text-amber-800' },
  proxima: { texto: 'Chega em breve', classe: 'border-sky-200 bg-sky-50 text-sky-800' },
}

function lerDispensado(): string {
  try {
    return localStorage.getItem(CHAVE_DISPENSADO) ?? ''
  } catch {
    return ''
  }
}

function contar(avisos: AvisoEntrega[]): Record<SituacaoEntrega, number> {
  const contagem: Record<SituacaoEntrega, number> = { atrasada: 0, hoje: 0, proxima: 0 }
  for (const a of avisos) contagem[a.situacao]++
  return contagem
}

function resumo(contagem: Record<SituacaoEntrega, number>): string {
  const partes: string[] = []
  if (contagem.atrasada) partes.push(contagem.atrasada === 1 ? '1 atrasada' : `${contagem.atrasada} atrasadas`)
  if (contagem.hoje) partes.push(contagem.hoje === 1 ? '1 chega hoje' : `${contagem.hoje} chegam hoje`)
  if (contagem.proxima) partes.push(contagem.proxima === 1 ? '1 chega em breve' : `${contagem.proxima} chegam em breve`)
  return partes.join(' · ')
}

export function AvisoEntregas({ aba, onAbrir }: { aba: string; onAbrir: (cotacaoId: string) => void }) {
  const [quotes, setQuotes] = useState<QuoteRecord[] | undefined>(undefined)
  const [agora, setAgora] = useState(() => Date.now())
  const [dispensado, setDispensado] = useState(lerDispensado)
  const [verTodas, setVerTodas] = useState(false)
  const ultimaBusca = useRef(0)
  const versaoFeriados = useVersaoFeriados()
  const caixaRef = useRef<HTMLElement>(null)

  const buscar = useCallback(() => {
    ultimaBusca.current = Date.now()
    listQuotes()
      .then((lista) => {
        setQuotes(lista)
        setAgora(Date.now())
      })
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
    // cotação gravada (entrega marcada, previsão alterada, status mudado): busca logo depois, juntando
    // gravações seguidas numa busca só
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

  // a virada do dia (ou de aba, depois de horas parado) recalcula hoje/atrasada mesmo sem buscar de novo
  useEffect(() => setAgora(Date.now()), [aba])

  const avisos = useMemo(
    () => (quotes ? avisosDeEntrega(quotes, agora) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotes, agora, versaoFeriados],
  )
  const assinatura = assinaturaDosAvisos(avisos, agora)
  const visivel = avisos.length > 0 && dispensado !== assinatura

  // a altura do aviso vira uma variável CSS: os botões que flutuam no mesmo canto ("Voltar para
  // Precificação" etc.) ficam logo acima dele em vez de escondidos atrás
  useEffect(() => {
    const raiz = document.documentElement
    const caixa = caixaRef.current
    if (!visivel || !caixa) {
      raiz.style.removeProperty('--altura-aviso-entregas')
      return
    }
    const atualizar = () => raiz.style.setProperty('--altura-aviso-entregas', `${caixa.offsetHeight + 12}px`)
    atualizar()
    const observador = new ResizeObserver(atualizar)
    observador.observe(caixa)
    return () => {
      observador.disconnect()
      raiz.style.removeProperty('--altura-aviso-entregas')
    }
  }, [visivel])

  // também no canto da tela do sistema (se ligado em Configurações › Notificações): uma vez a cada lista
  // nova — a mesma regra do "×" daqui (outra nota, nota que mudou de situação, ou o dia seguinte)
  useEffect(() => {
    if (!visivel) return
    notificar(`entregas:${assinatura}`, {
      titulo: 'Entrega de notas',
      texto: [
        resumo(contar(avisos)),
        ...avisos.slice(0, 3).map((a) => `${a.notaFiscal ? `NF ${a.notaFiscal}` : 'NF não informada'} · ${a.codigo} — ${SELO[a.situacao].texto}`),
      ].join('\n'),
      etiqueta: 'entregas',
      aoClicar: avisos.length === 1 ? () => onAbrir(avisos[0].cotacaoId) : undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel, assinatura])

  if (!visivel) return null

  const contagem = contar(avisos)
  const pior: SituacaoEntrega = contagem.atrasada ? 'atrasada' : contagem.hoje ? 'hoje' : 'proxima'
  const visiveis = verTodas ? avisos : avisos.slice(0, LINHAS_VISIVEIS)

  function dispensar() {
    setDispensado(assinatura)
    try {
      localStorage.setItem(CHAVE_DISPENSADO, assinatura)
    } catch {
      // sem localStorage: vale até recarregar a página
    }
  }

  return (
    <aside
      ref={caixaRef}
      role="status"
      aria-live="polite"
      aria-label="Aviso de entregas"
      className="fixed bottom-4 right-4 z-40 flex max-h-[min(28rem,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)] animate-[dialog-pop-in_0.18s_cubic-bezier(0.16,1,0.3,1)]"
    >
      <div className="flex items-start gap-3 border-b border-ink-100 px-4 py-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${SELO[pior].classe}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h11v9H3z" />
            <path d="M14 9h4l3 3v3h-7" />
            <circle cx="7" cy="17.5" r="1.8" />
            <circle cx="17" cy="17.5" r="1.8" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-ink-900">Entrega de notas</p>
          <p className="text-xs text-ink-500">{resumo(contagem)}</p>
        </div>
        <button
          type="button"
          onClick={dispensar}
          aria-label="Dispensar aviso de entregas"
          title="Dispensar — volta se outra nota entrar no aviso ou amanhã"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none text-ink-400 transition hover:bg-ink-100 hover:text-ink-800"
        >
          ×
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {visiveis.map((a) => (
          <li key={a.chave}>
            <button
              type="button"
              onClick={() => onAbrir(a.cotacaoId)}
              title="Ver nota, transportadora, rastreio e previsão"
              className="w-full rounded-xl px-2.5 py-2 text-left transition hover:bg-ink-50"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-ink-800">
                  {a.notaFiscal ? `NF ${a.notaFiscal}` : 'NF não informada'} · {a.codigo}
                </span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SELO[a.situacao].classe}`}>
                  {SELO[a.situacao].texto}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-500">
                {a.cliente} · {a.fornecedor}
                {a.transportadora ? ` · ${a.transportadora}` : ''}
              </span>
              <span className="block text-[11px] text-ink-400">{situacaoDaPrevisao(a.previsao, agora).texto}</span>
            </button>
          </li>
        ))}
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
