import { useSyncExternalStore } from 'react'

// -----------------------------------------------------------------------
// Usuário logado neste aparelho: o token da sessão (o servidor devolve no
// login e pede em toda requisição de dados) e os dados do usuário. Fica no
// localStorage, mas só vale enquanto o site está aberto: fechado (todas as
// abas) e aberto de novo, pede a senha — recarregar a página ou abrir outra
// aba com o site ainda aberto continua dentro. Sai também com "Sair", com a
// saída automática (SaidaAutomatica) ou quando o servidor encerra a sessão
// (senha trocada, usuário excluído, 30 dias sem uso).
// O último usuário que entrou fica lembrado: o login já abre pedindo só a
// senha dele ("trocar usuário" pra entrar com outro).
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
const CHAVE_ULTIMO_USUARIO = 'ultimoUsuario'
/** Quando houve atividade no site pela última vez (SaidaAutomatica) — vale pra todas as abas. */
export const CHAVE_ULTIMA_ATIVIDADE = 'saidaAutomatica:ultimaAtividade'
// "esta aba já estava dentro" (sessionStorage: some quando a aba fecha, fica ao recarregar)
const CHAVE_ESTA_ABA = 'sessao:estaAba'
// "tem uma aba do site aberta" (cada aba logada escreve a hora a cada poucos segundos)
const CHAVE_ABA_ABERTA = 'sessao:abaAberta'
const BATIMENTO_MS = 5 * 1000
const ABA_ABERTA_ATE_MS = 20 * 1000

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

/** O site foi fechado desde a última vez (esta aba é nova e nenhuma outra está aberta)? */
function siteFoiFechado(): boolean {
  try {
    if (sessionStorage.getItem(CHAVE_ESTA_ABA)) return false
    const aberta = Number(localStorage.getItem(CHAVE_ABA_ABERTA))
    return !(aberta > 0 && Date.now() - aberta < ABA_ABERTA_ATE_MS)
  } catch {
    return false
  }
}

function marcarEstaAba() {
  try {
    sessionStorage.setItem(CHAVE_ESTA_ABA, '1')
    localStorage.setItem(CHAVE_ABA_ABERTA, String(Date.now()))
  } catch {
    // sem armazenamento: a sessão vale só nesta página
  }
}

/** Tira a sessão (e as cópias dos dados de quem estava) do aparelho. */
function apagarDoAparelho() {
  try {
    localStorage.removeItem(CHAVE)
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith(PREFIXO_CACHE) || CHAVES_ANTIGAS.includes(chave)) localStorage.removeItem(chave)
    }
  } catch {
    // nada a limpar
  }
}

// guardado em variável (e não lido do localStorage a cada vez) pro useSyncExternalStore receber
// sempre o mesmo objeto enquanto nada mudar
let atual = lerDoAparelho()
// fechou o site e voltou: pede a senha de novo (o login já vem com o usuário)
if (atual && siteFoiFechado()) {
  atual = null
  apagarDoAparelho()
}
if (atual) marcarEstaAba()
let ouvintes: Array<() => void> = []

// enquanto houver alguém dentro, esta aba avisa que o site está aberto (pras outras abas que abrirem)
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    if (atual) marcarEstaAba()
  }, BATIMENTO_MS)
  window.addEventListener('pagehide', () => {
    try {
      localStorage.removeItem(CHAVE_ABA_ABERTA)
    } catch {
      // nada a fazer
    }
  })
}

export interface UltimoUsuario {
  login: string
  exibicao: string
}

/** Quem entrou por último neste aparelho — o login já abre pedindo só a senha dele. */
export function ultimoUsuario(): UltimoUsuario | null {
  try {
    const bruto = localStorage.getItem(CHAVE_ULTIMO_USUARIO)
    const u = bruto ? (JSON.parse(bruto) as UltimoUsuario) : null
    return u && typeof u.login === 'string' && u.login ? u : null
  } catch {
    return null
  }
}

function notificar() {
  for (const ouvinte of ouvintes) ouvinte()
}

export function getSessao(): SessaoUsuario | null {
  return atual
}

export function salvarSessao(sessao: SessaoUsuario): void {
  const entrouAgora = atual?.token !== sessao.token
  atual = sessao
  try {
    localStorage.setItem(CHAVE, JSON.stringify(sessao))
    localStorage.setItem(CHAVE_ULTIMO_USUARIO, JSON.stringify({ login: sessao.usuario.login, exibicao: sessao.usuario.exibicao }))
    // acabou de entrar: o tempo sem atividade começa de agora (não do que sobrou da vez anterior)
    if (entrouAgora) localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(Date.now()))
    for (const chave of CHAVES_ANTIGAS) localStorage.removeItem(chave)
  } catch {
    // sem localStorage a sessão vale só até recarregar a página
  }
  marcarEstaAba()
  notificar()
}

/** Atualiza os dados do usuário (ex.: o Max mudou a função dele) sem trocar a sessão. */
export function atualizarUsuarioDaSessao(usuario: UsuarioLogado): void {
  if (atual) salvarSessao({ ...atual, usuario })
}

export function limparSessao(): void {
  atual = null
  apagarDoAparelho()
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
