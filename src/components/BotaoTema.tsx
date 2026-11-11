import { useState } from 'react'
import { aplicarTema, getTema, type Tema } from '../theme'

/** O botão de modo claro/escuro (☾/☀ + chavinha) — no rodapé do menu e no topo do site do vendedor.
 * Vale só nesse aparelho, cada um escolhe o seu (ver theme.ts). `recolhido`: só o símbolo, no menu recolhido. */
export function BotaoTema({ recolhido = false }: { recolhido?: boolean }) {
  const [tema, setTema] = useState<Tema>(() => getTema())

  function alternarTema() {
    const novo: Tema = tema === 'escuro' ? 'claro' : 'escuro'
    setTema(novo)
    aplicarTema(novo)
  }

  return (
    <button
      type="button"
      onClick={alternarTema}
      role="switch"
      aria-checked={tema === 'escuro'}
      title={tema === 'escuro' ? 'Modo escuro — mudar pro claro' : 'Modo claro — mudar pro escuro'}
      aria-label={tema === 'escuro' ? 'Mudar pro modo claro' : 'Mudar pro modo escuro'}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800 transition ${
        recolhido ? 'w-full justify-center' : ''
      }`}
    >
      <span aria-hidden className="text-base leading-none">
        {tema === 'escuro' ? '☀' : '☾'}
      </span>
      {!recolhido && (
        <span
          aria-hidden
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
            tema === 'escuro' ? 'bg-ink-800' : 'bg-ink-200'
          }`}
        >
          {/* bg-surface/bg-ink-800 (variáveis que trocam com o tema) em vez de branco/preto fixos —
           * no modo escuro a trilha fica clara e a bolinha escura, sempre com contraste */}
          <span
            className={`inline-block h-4 w-4 rounded-full bg-surface shadow transition-transform ${
              tema === 'escuro' ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </span>
      )}
    </button>
  )
}
