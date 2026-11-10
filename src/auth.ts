// -----------------------------------------------------------------------
// Login, cadastro (só o Max) e recuperação de senha — tudo conferido pelo servidor
// (rotas /_auth/*). As funções que terminam com o usuário logado já guardam
// a sessão (sessaoUsuario.ts), e o App troca de tela sozinho.
// -----------------------------------------------------------------------
import { chamarServidor } from './db/db'
import { atualizarUsuarioDaSessao, limparSessao, salvarSessao, type PapelUsuario, type SessaoUsuario, type UsuarioLogado } from './sessaoUsuario'

export const TAMANHO_MINIMO_SENHA = 6

/** Primeiro passo do login: o usuário existe? Já tem senha ou é o primeiro acesso? */
export function iniciarLogin(usuario: string): Promise<{ estado: 'senha' | 'primeiro-acesso'; exibicao: string }> {
  return chamarServidor('/_auth/inicio', { method: 'POST', corpo: { usuario } })
}

export async function entrar(usuario: string, senha: string): Promise<void> {
  salvarSessao(await chamarServidor<SessaoUsuario>('/_auth/login', { method: 'POST', corpo: { usuario, senha } }))
}

export async function criarSenhaNoPrimeiroAcesso(usuario: string, senha: string, email: string): Promise<void> {
  salvarSessao(await chamarServidor<SessaoUsuario>('/_auth/primeiro-acesso', { method: 'POST', corpo: { usuario, senha, email } }))
}

/** Manda o código de nova senha pro e-mail de recuperação. Devolve o e-mail mascarado (ex.: ma***@gmail.com). */
export async function pedirCodigoDeNovaSenha(usuario: string): Promise<string> {
  const { emailMascarado } = await chamarServidor<{ emailMascarado: string }>('/_auth/esqueci', { method: 'POST', corpo: { usuario } })
  return emailMascarado
}

export async function redefinirSenha(usuario: string, codigo: string, senha: string): Promise<void> {
  salvarSessao(await chamarServidor<SessaoUsuario>('/_auth/redefinir', { method: 'POST', corpo: { usuario, codigo, senha } }))
}

export async function sair(): Promise<void> {
  try {
    await chamarServidor('/_auth/sair', { method: 'POST' })
  } catch {
    // sem servidor agora: a sessão some deste aparelho do mesmo jeito (no servidor, expira sozinha)
  } finally {
    limparSessao()
  }
}

/** Busca no servidor os dados atuais do usuário logado (ex.: função definida pelo Max). */
export async function atualizarUsuarioLogado(): Promise<void> {
  const { usuario } = await chamarServidor<{ usuario: UsuarioLogado }>('/_auth/eu')
  atualizarUsuarioDaSessao(usuario)
}

export async function alterarMinhaConta(dados: { senhaAtual: string; novaSenha?: string; novoEmail?: string }): Promise<void> {
  const { usuario } = await chamarServidor<{ usuario: UsuarioLogado }>('/_auth/minha-conta', { method: 'POST', corpo: dados })
  atualizarUsuarioDaSessao(usuario)
}

// --- gestão de usuários (só o Max) --------------------------------------------------------
export interface UsuarioCadastrado {
  login: string
  exibicao: string
  nome: string
  papel: PapelUsuario
  /** Do vendedor: de qual vendedor são as cotações dele (vazio pros outros, e nos servidores antigos). */
  vendedor?: string
  gestor: boolean
  pendente: boolean
  /** MÁXIMUS, GOUVÊA e MAICON — não podem ser excluídos. */
  semente: boolean
  temSenha: boolean
  email: string
  criadoEm: string
}

export function listarUsuarios(): Promise<UsuarioCadastrado[]> {
  return chamarServidor('/_auth/usuarios')
}

/** `vendedor`: só pra função 'vendedor' — de qual vendedor são as cotações dele. */
export function definirPapel(login: string, papel: PapelUsuario, vendedor?: string): Promise<void> {
  return chamarServidor(`/_auth/usuarios/${encodeURIComponent(login)}`, { method: 'PUT', corpo: { papel, ...(vendedor ? { vendedor } : {}) } })
}

/** Apaga a senha do usuário — ele cria outra no próximo acesso (pra quem esqueceu e não tem o e-mail). */
export function liberarNovaSenha(login: string): Promise<void> {
  return chamarServidor(`/_auth/usuarios/${encodeURIComponent(login)}/liberar-senha`, { method: 'POST' })
}

/** O Max cadastra alguém (sem senha: a pessoa cria a dela no primeiro acesso). */
export function cadastrarUsuario(usuario: string, papel: PapelUsuario, vendedor?: string): Promise<{ login: string; exibicao: string }> {
  return chamarServidor('/_auth/usuarios', { method: 'POST', corpo: { usuario, papel, ...(vendedor ? { vendedor } : {}) } })
}

export function excluirUsuario(login: string): Promise<void> {
  return chamarServidor(`/_auth/usuarios/${encodeURIComponent(login)}`, { method: 'DELETE' })
}

// --- validações do formulário (o servidor confere de novo) ----------------------------------
export function erroDaSenhaNova(senha: string, confirmacao: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) return `A senha precisa ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`
  if (senha !== confirmacao) return 'As duas senhas não são iguais. Digite de novo.'
  return null
}

export function erroDoEmailNovo(email: string, confirmacao: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return 'Digite um e-mail válido (ex.: nome@gmail.com).'
  if (email.trim().toLowerCase() !== confirmacao.trim().toLowerCase()) return 'Os dois e-mails não são iguais. Confira.'
  return null
}
