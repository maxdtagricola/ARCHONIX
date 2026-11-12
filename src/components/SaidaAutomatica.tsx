import { useEffect, useRef, useState } from 'react'
import { sair } from '../auth'
import { avisar } from '../dialogs'
import { notificar } from '../notificacoesDoSistema'
import { CHAVE_ULTIMA_ATIVIDADE, getSessao } from '../sessaoUsuario'

// Saída automática: sem atividade no site (mouse, toque, tecla, rolagem) pelo tempo escolhido em
// Configurações > Saída automática, o usuário sai sozinho. O tempo vale por aparelho (padrão 5 min).
// A atividade fica anotada no localStorage, então mexer numa aba do site conta pras outras abertas
// no mesmo aparelho — e o tempo em que a página ficou parada (computador suspenso, aba recarregada
// depois de muito tempo) também conta: voltando depois do limite, sai na hora. Um minuto antes aparece
// o aviso, e qualquer movimento cancela. O rascunho da cotação aberta não se perde: ao entrar de novo,
// o site oferece recuperar.

export const CHAVE_MINUTOS_SAIDA = 'saidaAutomatica:minutos'
// o vendedor não tem Configurações: o tempo dele é o que o Max escolheu (Funções de usuário › Vendedor
// ou Usuários › Permissões — telaVendedor.ts), guardado aqui quando a tela dele carrega
const CHAVE_MINUTOS_DO_VENDEDOR = 'saidaAutomatica:minutosDoVendedor'
export const MINUTOS_SAIDA_PADRAO = 5
/** 0 = nunca sai sozinho. */
export const OPCOES_SAIDA_AUTOMATICA = [3, 5, 10, 30, 60, 0] as const
const AVISO_ANTES_MS = 60 * 1000
// gravar a cada movimento do mouse seria demais — basta uma vez a cada poucos segundos
const INTERVALO_DE_GRAVACAO_MS = 5 * 1000

export function textoDaSaida(minutos: number): string {
  return minutos === 0 ? 'Nunca' : `${minutos} minutos`
}

function lerNumero(chave: string): number | null {
  try {
    const bruto = localStorage.getItem(chave)
    if (bruto === null) return null
    const n = Number(JSON.parse(bruto))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

const opcaoValida = (m: number | null): m is number => m !== null && (OPCOES_SAIDA_AUTOMATICA as readonly number[]).includes(m)

function minutosEscolhidos(): number {
  if (getSessao()?.usuario.papel === 'vendedor') {
    const doVendedor = lerNumero(CHAVE_MINUTOS_DO_VENDEDOR)
    if (opcaoValida(doVendedor)) return doVendedor
  }
  const m = lerNumero(CHAVE_MINUTOS_SAIDA)
  return opcaoValida(m) ? m : MINUTOS_SAIDA_PADRAO
}

/** A tela do vendedor guarda o tempo que vale pra ele (null = o padrão do aparelho). */
export function guardarMinutosDoVendedor(minutos: number | null): void {
  try {
    if (opcaoValida(minutos)) localStorage.setItem(CHAVE_MINUTOS_DO_VENDEDOR, String(minutos))
    else localStorage.removeItem(CHAVE_MINUTOS_DO_VENDEDOR)
  } catch {
    // sem armazenamento: vale o padrão
  }
}

/** Montado enquanto há alguém logado: conta o tempo sem atividade e tira o usuário quando passa do limite. */
export function SaidaAutomatica() {
  const ultimaAtividade = useRef(Date.now())
  const gravadaEm = useRef(0)
  const saindo = useRef(false)
  const [segundosRestantes, setSegundosRestantes] = useState<number | null>(null)

  useEffect(() => {
    function sairPorInatividade(minutos: number, ultima?: number) {
      if (saindo.current) return
      saindo.current = true
      // com o site em segundo plano, o aviso do sistema (antes de sair, que ainda se sabe quem era)
      if (ultima !== undefined) {
        notificar(`saiu:${ultima}`, {
          titulo: 'Saída automática',
          texto: `Você saiu do Archonix depois de ${minutos} minutos sem atividade. É só entrar de novo.`,
          etiqueta: 'saida',
        })
      }
      void sair().then(() =>
        avisar(`Você saiu do site depois de ${minutos} minutos sem atividade. É só entrar de novo.`, {
          titulo: 'Saída automática',
        }),
      )
    }
    // a última atividade anotada é de antes desta página abrir: se já passou do limite, sai agora
    // (antes, abrir a página zerava o tempo e quem voltava depois de horas continuava dentro)
    const minutosAoAbrir = minutosEscolhidos()
    const anotadaAntes = lerNumero(CHAVE_ULTIMA_ATIVIDADE)
    if (minutosAoAbrir > 0 && anotadaAntes !== null && Date.now() - anotadaAntes > minutosAoAbrir * 60 * 1000) {
      sairPorInatividade(minutosAoAbrir)
      return
    }

    function anotar() {
      const agora = Date.now()
      ultimaAtividade.current = agora
      if (agora - gravadaEm.current >= INTERVALO_DE_GRAVACAO_MS) {
        gravadaEm.current = agora
        try {
          localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(agora))
        } catch {
          // sem localStorage, conta só esta aba
        }
      }
    }
    anotar()
    const eventos = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    for (const ev of eventos) window.addEventListener(ev, anotar, { passive: true, capture: true })

    const relogio = window.setInterval(() => {
      const minutos = minutosEscolhidos()
      if (minutos === 0) {
        setSegundosRestantes(null)
        return
      }
      const ultima = Math.max(ultimaAtividade.current, lerNumero(CHAVE_ULTIMA_ATIVIDADE) ?? 0)
      const restante = minutos * 60 * 1000 - (Date.now() - ultima)
      if (restante <= 0) {
        sairPorInatividade(minutos, ultima)
        return
      }
      if (restante <= AVISO_ANTES_MS) {
        // o aviso também no canto da tela do sistema; clicar nele conta como atividade
        notificar(`saida:${ultima}`, {
          titulo: 'Saída automática',
          texto: `Sem atividade: você sai do Archonix em ${Math.ceil(restante / 1000)} segundos. Clique aqui pra continuar conectado.`,
          etiqueta: 'saida',
          aoClicar: () => {
            gravadaEm.current = 0
            anotar()
            setSegundosRestantes(null)
          },
        })
      }
      setSegundosRestantes(restante <= AVISO_ANTES_MS ? Math.ceil(restante / 1000) : null)
    }, 1000)

    return () => {
      for (const ev of eventos) window.removeEventListener(ev, anotar, { capture: true })
      window.clearInterval(relogio)
    }
  }, [])

  if (segundosRestantes === null) return null
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Saída automática por inatividade"
      className="fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4"
    >
      <div className="flex max-w-md flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink-900 shadow-xl">
        <span>
          Sem atividade há um tempo: você vai sair do site em <strong className="tabular-nums">{segundosRestantes} s</strong>.
        </span>
        <button
          type="button"
          onClick={() => {
            ultimaAtividade.current = Date.now()
            setSegundosRestantes(null)
          }}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90"
        >
          Continuar conectado
        </button>
      </div>
    </div>
  )
}
