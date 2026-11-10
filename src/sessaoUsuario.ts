import { useSyncExternalStore } from 'react'

// -----------------------------------------------------------------------
// Usuário logado neste aparelho: o token da sessão (o servidor devolve no
// login e pede em toda requisição de dados) e os dados do usuário. Fica no
// localStorage — fechar e abrir o site continua logado, até "Sair" ou o
// servidor encerrar a sessão (senha trocada, usuário excluído, 30 dias sem
// uso).
// -----------------------------------------------------------------------
export type PapelUsuario = 'admin' | 'xadrez' | 'vendedor'

export interface UsuarioLogado {
  /** Nome de login, sem acento e maiúsculo (ex.: "MAXIMUS"). */
  login: string
  /** Como o usuário digita/vê o próprio nome de login (ex.: "MÁXIMUS"). */
  exibicao: string
  /** Como o app conhece o usuário — cotações, histórico (ex.: "Max"). */
  nome: string
  /** 'admin' vê o site todo; 'vendedor' só as cotações que estão no nome dele (ver vendedor/); 'xadrez'
   * é o nome antigo de quem está sem função: só vê a própria conta. */
  papel: PapelUsuario
  /** Do vendedor: o nome dele nas cotações (ex.: "EDSON"). */
  vendedor?: string
  /** Gerencia os usuários (o Max). */
  gestor: boolean
  /** Cadastrado sozinho e ainda esperando o Max definir a função. */
  pendente: boolean
  emailMascarado: string
}

export interface SessaoUsuario {
  token: string
  usuario: UsuarioLogado
}

const CHAVE = 'sessaoUsuario'
// do acesso antigo ("Quem está usando?", sem senha) — não valem mais
const CHAVES_ANTIGAS = ['currentAdmin', 'currentPlayer', 'modoSessao']
// cópias locais dos dados do servidor (ver db.ts) — são de quem estava logado
const PREFIXO_CACHE = 'cache:'

function lerDoAparelho(): SessaoUsuario | null {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return null
    const sessao = JSON.parse(bruto) as SessaoUsuario
    return typeof sessao?.token === 'string' && sessao.usuario ? sessao : null
  } catch {
    return null
  }
}

// guardado em variável (e não lido do localStorage a cada vez) pro useSyncExternalStore receber
// sempre o mesmo objeto enquanto nada mudar
let atual = lerDoAparelho()
let ouvintes: Array<() => void> = []

function notificar() {
  for (const ouvinte of ouvintes) ouvinte()
}

export function getSessao(): SessaoUsuario | null {
  return atual
}

export function salvarSessao(sessao: SessaoUsuario): void {
  atual = sessao
  try {
    localStorage.setItem(CHAVE, JSON.stringify(sessao))
    for (const chave of CHAVES_ANTIGAS) localStorage.removeItem(chave)
  } catch {
    // sem localStorage a sessão vale só até recarregar a página
  }
  notificar()
}

/** Atualiza os dados do usuário (ex.: o Max mudou a função dele) sem trocar a sessão. */
export function atualizarUsuarioDaSessao(usuario: UsuarioLogado): void {
  if (atual) salvarSessao({ ...atual, usuario })
}

export function limparSessao(): void {
  atual = null
  try {
    localStorage.removeItem(CHAVE)
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith(PREFIXO_CACHE) || CHAVES_ANTIGAS.includes(chave)) localStorage.removeItem(chave)
    }
  } catch {
    // nada a limpar
  }
  notificar()
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.push(ouvinte)
  return () => {
    ouvintes = ouvintes.filter((o) => o !== ouvinte)
  }
}

/** Sessão atual, redesenhando o componente quando alguém entra, sai ou a sessão expira. */
export function useSessao(): SessaoUsuario | null {
  return useSyncExternalStore(assinar, getSessao)
}
