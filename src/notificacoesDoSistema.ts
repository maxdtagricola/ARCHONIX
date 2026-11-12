import { useEffect, useState } from 'react'
import { getSessao } from './sessaoUsuario'

// Os avisos do site (entregas, alterações de vendedores, retorno do cliente, saída automática, valores
// novos pro vendedor) também como notificação do sistema: no Windows, o balão no canto da tela e a
// Central de Notificações; no celular, a notificação do Android. Liga em Configurações › Notificações (o
// vendedor, no sino do topo da tela dele) — vale só neste aparelho, e o navegador pede a permissão.
// Chegam enquanto o site estiver aberto numa aba (minimizada ou atrás de outras janelas, serve). Cada
// aviso vai uma vez só: a chave dele fica anotada no aparelho, então recarregar a página ou ter várias
// abas abertas não repete. O clique traz a aba do site pra frente (public/sw.js).

const CHAVE_LIGADAS = 'notificacoes:ligadas'
const CHAVE_JA_AVISADOS = 'notificacoes:jaAvisados'
// as chaves dos avisos já mandados ficam guardadas duas semanas (depois disso, não voltam mais)
const GUARDAR_AVISADOS_MS = 14 * 24 * 60 * 60 * 1000
const EVENTO_MUDOU = 'notificacoes-mudaram'
const ICONE = `${import.meta.env.BASE_URL}icon-192.png`

export type EstadoNotificacoes = 'sem-suporte' | 'bloqueadas' | 'ligadas' | 'desligadas'

export interface AvisoDoSistema {
  titulo: string
  texto: string
  /** Avisos com a mesma etiqueta se substituem (o de "vai sair" vira o de "saiu"). */
  etiqueta?: string
  /** Clicar no aviso: a aba do site vem pra frente e isto roda (abrir a cotação, continuar conectado...). */
  aoClicar?: () => void
}

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}
function gravar(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    // sem armazenamento: vale até recarregar
  }
}

export function suportaNotificacoes(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext
}

export function estadoDasNotificacoes(): EstadoNotificacoes {
  if (!suportaNotificacoes()) return 'sem-suporte'
  if (Notification.permission === 'denied') return 'bloqueadas'
  return Notification.permission === 'granted' && ler(CHAVE_LIGADAS) === '1' ? 'ligadas' : 'desligadas'
}

/** O estado, atualizado ao ligar/desligar e ao voltar pra janela (a permissão muda no cadeado do navegador). */
export function useEstadoNotificacoes(): EstadoNotificacoes {
  const [estado, setEstado] = useState(estadoDasNotificacoes)
  useEffect(() => {
    const atualizar = () => setEstado(estadoDasNotificacoes())
    window.addEventListener(EVENTO_MUDOU, atualizar)
    window.addEventListener('focus', atualizar)
    return () => {
      window.removeEventListener(EVENTO_MUDOU, atualizar)
      window.removeEventListener('focus', atualizar)
    }
  }, [])
  return estado
}

/** Pede a permissão (se ainda não deu) e liga; manda um aviso de teste. Precisa vir de um clique. */
export async function ligarNotificacoes(): Promise<EstadoNotificacoes> {
  if (!suportaNotificacoes()) return 'sem-suporte'
  const permissao = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (permissao === 'granted') {
    gravar(CHAVE_LIGADAS, '1')
    await mostrar({ titulo: 'Notificações do Archonix ligadas', texto: 'Os avisos do site vão aparecer aqui também, enquanto ele estiver aberto.' })
  }
  window.dispatchEvent(new Event(EVENTO_MUDOU))
  return estadoDasNotificacoes()
}

export function desligarNotificacoes(): void {
  gravar(CHAVE_LIGADAS, '0')
  window.dispatchEvent(new Event(EVENTO_MUDOU))
}

export function notificacaoDeTeste(): Promise<void> {
  return mostrar({ titulo: 'Teste do Archonix', texto: 'É assim que os avisos do site aparecem neste aparelho.' })
}

/** Manda o aviso pro sistema, se as notificações estão ligadas e esta `chave` ainda não foi avisada
 * (neste aparelho, pra este usuário). */
export function notificar(chave: string, aviso: AvisoDoSistema): void {
  if (estadoDasNotificacoes() !== 'ligadas') return
  const completa = `${getSessao()?.usuario.login ?? ''}|${chave}`
  let avisados: Record<string, number> = {}
  try {
    avisados = JSON.parse(ler(CHAVE_JA_AVISADOS) ?? '{}') as Record<string, number>
  } catch {
    // anotação estragada: começa de novo
  }
  if (avisados[completa]) return
  const agora = Date.now()
  avisados = Object.fromEntries(Object.entries(avisados).filter(([, em]) => agora - em < GUARDAR_AVISADOS_MS))
  avisados[completa] = agora
  gravar(CHAVE_JA_AVISADOS, JSON.stringify(avisados))
  void mostrar(aviso)
}

// --- mostrar -----------------------------------------------------------------------------------------

// o que fazer no clique de cada aviso desta aba (o service worker manda o id de volta)
const cliques = new Map<string, () => void>()
let registro: Promise<ServiceWorkerRegistration | null> | null = null

function registroDoServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!registro) {
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ tipo?: string; id?: string }>) => {
      if (e.data?.tipo !== 'notificacao-clicada' || !e.data.id) return
      cliques.get(e.data.id)?.()
      cliques.delete(e.data.id)
    })
    registro = navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null)
  }
  return registro
}

async function mostrar({ titulo, texto, etiqueta, aoClicar }: AvisoDoSistema): Promise<void> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  if (aoClicar) cliques.set(id, aoClicar)
  // renotify: o aviso que substitui outro (mesma etiqueta) aparece de novo no canto, em vez de trocar calado
  const opcoes: NotificationOptions & { renotify?: boolean } = {
    body: texto,
    icon: ICONE,
    data: { id },
    ...(etiqueta ? { tag: etiqueta, renotify: true } : {}),
  }
  try {
    const reg = await registroDoServiceWorker()
    if (reg) return void (await reg.showNotification(titulo, opcoes))
  } catch {
    // sem service worker: tenta direto pela página
  }
  try {
    const n = new Notification(titulo, opcoes)
    n.onclick = () => {
      window.focus()
      n.close()
      cliques.get(id)?.()
      cliques.delete(id)
    }
  } catch {
    // o navegador não deixou (celular sem service worker) — fica só o aviso na tela do site
  }
}
