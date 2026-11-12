import { useState } from 'react'
import { avisar } from '../dialogs'
import { Button } from './ui/Basics'
import {
  desligarNotificacoes,
  ligarNotificacoes,
  notificacaoDeTeste,
  useEstadoNotificacoes,
  type EstadoNotificacoes,
} from '../notificacoesDoSistema'

// Ligar/desligar as notificações do sistema (notificacoesDoSistema.ts): o painel de Configurações ›
// Notificações e o sino do topo da tela do vendedor (que não tem Configurações).

const COMO_DESBLOQUEAR =
  'O navegador bloqueou as notificações deste site. Pra liberar: clique no cadeado (ou no símbolo de ajustes) ao ' +
  'lado do endereço do site, em Notificações escolha "Permitir" e depois ligue de novo aqui.'
const SE_NAO_APARECER =
  'Se mesmo ligadas elas não aparecerem: no Windows, abra Configurações › Sistema › Notificações e confira se as ' +
  'notificações estão ativadas e se o navegador (Edge ou Chrome) pode mostrá-las — e se o "Não incomodar" (Assistente ' +
  'de foco) está desligado.'
const SEM_SUPORTE = 'Este navegador não mostra notificações do sistema pra sites (no iPhone, só com o site adicionado à Tela de Início).'

async function ligar(): Promise<void> {
  const estado = await ligarNotificacoes()
  if (estado === 'bloqueadas') void avisar(COMO_DESBLOQUEAR, { titulo: 'Notificações bloqueadas' })
  else if (estado === 'sem-suporte') void avisar(SEM_SUPORTE, { titulo: 'Notificações' })
}

const TEXTO_DO_ESTADO: Record<EstadoNotificacoes, string> = {
  ligadas: 'Ligadas neste aparelho.',
  desligadas: 'Desligadas neste aparelho.',
  bloqueadas: 'Bloqueadas pelo navegador.',
  'sem-suporte': 'Este navegador não mostra notificações do sistema.',
}

/** Configurações › Notificações. */
export function PainelNotificacoes() {
  const estado = useEstadoNotificacoes()
  const [pedindo, setPedindo] = useState(false)

  async function aoLigar() {
    setPedindo(true)
    try {
      await ligar()
    } finally {
      setPedindo(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-400">
        Os avisos do site também no canto da tela do Windows (e na Central de Notificações), como os de outros
        programas — mesmo com o Archonix minimizado ou atrás de outras janelas: entregas de notas atrasadas, de hoje ou
        chegando, alterações dos vendedores nas cotações, retorno do cliente e o aviso de saída automática. Chegam
        enquanto o site estiver aberto numa aba do navegador. Vale só neste aparelho; clicar no aviso traz o site pra frente.
      </p>
      <p role="status" aria-label="Situação das notificações" className="flex items-center gap-2 text-sm font-medium text-ink-800">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${estado === 'ligadas' ? 'bg-emerald-500' : estado === 'bloqueadas' ? 'bg-rose-500' : 'bg-ink-300'}`} />
        {TEXTO_DO_ESTADO[estado]}
      </p>
      {estado === 'bloqueadas' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{COMO_DESBLOQUEAR}</p>}
      <div className="flex flex-wrap gap-2">
        {estado === 'ligadas' ? (
          <>
            <Button onClick={() => void notificacaoDeTeste()}>Mandar um aviso de teste</Button>
            <Button variant="ghost" onClick={desligarNotificacoes}>
              Desligar
            </Button>
          </>
        ) : (
          estado !== 'sem-suporte' && (
            <Button variant="primary" onClick={() => void aoLigar()} disabled={pedindo}>
              {estado === 'bloqueadas' ? 'Tentar ligar de novo' : 'Ligar as notificações'}
            </Button>
          )
        )}
      </div>
      {estado !== 'sem-suporte' && <p className="text-[11px] text-ink-400">{SE_NAO_APARECER}</p>}
    </div>
  )
}

/** O sino do topo da tela do vendedor: liga (pede a permissão) ou desliga. */
export function BotaoNotificacoes() {
  const estado = useEstadoNotificacoes()
  if (estado === 'sem-suporte') return null
  const ligadas = estado === 'ligadas'
  const rotulo = ligadas
    ? 'Notificações ligadas — desligar'
    : 'Ligar as notificações (os valores novos das suas cotações aparecem no canto da tela)'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligadas}
      onClick={() => (ligadas ? desligarNotificacoes() : void ligar())}
      title={rotulo}
      aria-label={rotulo}
      className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-ink-100 ${ligadas ? 'text-ink-800' : 'text-ink-400 hover:text-ink-700'}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 6 1.8 6H4.2S6 14 6 9.5z" />
        <path d="M10.2 19a2 2 0 0 0 3.6 0" />
        {!ligadas && <path d="M4 4l16 16" />}
      </svg>
      {ligadas && <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500" />}
    </button>
  )
}
