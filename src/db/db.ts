// -----------------------------------------------------------------------
// Camada de armazenamento: fala com o servidor rodando no PC 35 (até
// out/2026, no celular) em vez de usar o IndexedDB do navegador. A interface pública
// (dbPut, dbGetAll, dbGet, dbDelete) é a mesma de antes, então o resto
// do app (analysesRepo.ts) não precisa mudar nada.
//
// Cache: toda leitura bem-sucedida fica guardada no localStorage. Se uma
// leitura futura não conseguir alcançar o servidor (PC desligado,
// Tailscale caído etc.), o app usa o último dado conhecido em vez de
// simplesmente quebrar — assim o que já foi carregado uma vez continua
// disponível. Não é usado pra respostas de erro do próprio servidor (404,
// 500...), só quando a conexão falha de verdade.
//
// Senhas: o servidor só responde com a SENHA DE ACESSO (pedida uma vez por
// aparelho; o servidor devolve uma chave só deste aparelho, e é a chave que
// fica no localStorage, não a senha), e os dados só com um usuário logado
// (o token da sessão, ver sessaoUsuario.ts/auth.ts). Algumas gravações
// (empresas, planilhas de markup, excluir produto/partidas...) pedem também
// a SENHA DE ADMIN, digitada na hora e conferida pelo próprio servidor. As
// senhas de acesso e de admin são definidas no computador do servidor
// (node definir-senhas.js).
// -----------------------------------------------------------------------
import { pedirSenha } from '../dialogs'
import { getSessao, limparSessao } from '../sessaoUsuario'

export const STORE_ANALISES = 'analises'

// Endereço do servidor no PC 35 (rondocat-pc35), pela rede privada do
// Tailscale — esse IP (100.x.y.z) fica fixo independente de trocas de rede ou
// quedas de energia, desde que o PC continue com o Tailscale conectado na
// mesma conta. (O do celular, usado até out/2026, era 100.112.41.57.)
// Pra apontar um navegador pra outro servidor sem editar o código: abra o
// console do navegador (F12) e rode:
//   localStorage.setItem('serverUrl', 'http://NOVO_IP:3000')
// e recarregue a página (localStorage.removeItem('serverUrl') volta ao padrão).
const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000'

export function getServerUrl(): string {
  return localStorage.getItem('serverUrl') || DEFAULT_SERVER_URL
}

/** Lançado só quando a requisição nem chega a sair (rede fora do ar) — nunca por causa de uma resposta de erro do servidor. */
class ServidorInalcancavelError extends Error {}

const CACHE_PREFIX = 'cache:'

function chaveCache(path: string): string {
  return `${CACHE_PREFIX}${path}`
}

function lerCache<T>(path: string): T | undefined {
  try {
    const bruto = localStorage.getItem(chaveCache(path))
    return bruto !== null ? (JSON.parse(bruto) as T) : undefined
  } catch {
    return undefined
  }
}

function salvarCache<T>(path: string, valor: T): void {
  try {
    localStorage.setItem(chaveCache(path), JSON.stringify(valor))
  } catch {
    // localStorage cheio ou indisponível — o cache é só um extra de resiliência, segue sem ele
  }
}

// versões antigas guardavam a própria senha de acesso; ela é trocada pela chave do aparelho na
// primeira requisição (e continua valendo com um servidor antigo, que não dá chave)
const CHAVE_SENHA_ACESSO = 'senhaAcessoServidor'
const CHAVE_DO_APARELHO = 'chaveAparelhoServidor'

interface CredencialAcesso {
  chave?: string
  senha?: string
}

function lerGuardado(nome: string): string {
  try {
    return localStorage.getItem(nome) ?? ''
  } catch {
    return ''
  }
}

function lerCredencial(): CredencialAcesso {
  const chave = lerGuardado(CHAVE_DO_APARELHO)
  if (chave) return { chave }
  const senha = lerGuardado(CHAVE_SENHA_ACESSO)
  return senha ? { senha } : {}
}

function mesmaCredencial(a: CredencialAcesso, b: CredencialAcesso): boolean {
  return a.chave === b.chave && a.senha === b.senha
}

/** A chave que o servidor devolve ao conferir a senha (servidor antigo responde 204, sem chave). */
async function chaveDaResposta(res: Response): Promise<string | undefined> {
  if (res.status === 204) return undefined
  const corpo = (await res.json().catch(() => null)) as { chaveAparelho?: unknown } | null
  return typeof corpo?.chaveAparelho === 'string' ? corpo.chaveAparelho : undefined
}

function guardarAcesso(chave: string | undefined, senha: string): void {
  try {
    if (chave) {
      localStorage.setItem(CHAVE_DO_APARELHO, chave)
      localStorage.removeItem(CHAVE_SENHA_ACESSO)
    } else {
      localStorage.setItem(CHAVE_SENHA_ACESSO, senha)
    }
  } catch {
    // sem localStorage o acesso vale só até recarregar — melhor que não entrar
  }
}

let trocaDaSenhaGuardada: Promise<void> | null = null

/** Uma vez por página aberta: a senha guardada por uma versão antiga vira a chave do aparelho. */
function trocarSenhaGuardadaPelaChave(): Promise<void> {
  const { chave, senha } = lerCredencial()
  if (chave || !senha) return Promise.resolve()
  trocaDaSenhaGuardada ??= (async () => {
    try {
      const res = await enviar('/_acesso', {}, { senha })
      if (res.ok) {
        const nova = await chaveDaResposta(res)
        if (nova) guardarAcesso(nova, senha)
      }
    } catch {
      // servidor fora do ar: segue com a senha e tenta de novo quando a página abrir de novo
    }
  })()
  return trocaDaSenhaGuardada
}

// sem isso, um fetch pra um servidor inalcançável (celular desligado, Tailscale fora do ar) fica
// pendurado por dezenas de segundos (ou mais) até o próprio SO desistir da conexão — trava telas
// inteiras por tempo nenhum motivo. 6s é bastante tempo
// pra uma resposta normal do servidor, mas curto o suficiente pra sentir rápido quando ele está fora.
const TIMEOUT_REQUISICAO_MS = 6000

interface OpcoesRequisicao {
  method?: string
  body?: string
  /** Senha de admin digitada agora — só nas operações que o servidor protege. */
  senhaAdmin?: string
}

async function enviar(path: string, opcoes: OpcoesRequisicao, acesso: CredencialAcesso): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // URI-encoded: cabeçalho HTTP não aceita acento (nomes como "Gouvêa", senhas com "ç")
  if (acesso.chave) headers['X-Chave-Aparelho'] = acesso.chave
  else if (acesso.senha) headers['X-Senha-Acesso'] = encodeURIComponent(acesso.senha)
  if (opcoes.senhaAdmin) headers['X-Senha-Admin'] = encodeURIComponent(opcoes.senhaAdmin)
  const sessao = getSessao()
  if (sessao) headers['X-Sessao'] = sessao.token
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_REQUISICAO_MS)
    try {
      return await fetch(`${getServerUrl()}${path}`, {
        method: opcoes.method,
        body: opcoes.body,
        headers,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    // sem o endereço do servidor nem detalhes de infraestrutura no texto — essa mensagem aparece na
    // tela de qualquer admin (e em prints/compartilhamento de tela); quem precisa do endereço pra
    // diagnosticar acha ele em DEFAULT_SERVER_URL / localStorage 'serverUrl'
    throw new ServidorInalcancavelError(
      'Não foi possível conectar ao servidor. Verifique se o computador do servidor está ligado e se o Tailscale está conectado (tanto nele quanto neste aparelho).',
    )
  }
}

const MENSAGEM_SEM_ACESSO =
  'Sem a senha de acesso, o app não consegue ler nem salvar dados no servidor. Recarregue a página para digitá-la.'
const MENSAGEM_SESSAO_ENCERRADA = 'Sua sessão terminou. Entre de novo com seu usuário e senha.'

/** Erro com o texto pronto do servidor e o código dele (ex.: 'primeiro-acesso'), pra quem precisa distinguir. */
export class ErroDoServidor extends Error {
  constructor(
    mensagem: string,
    readonly codigo?: string,
  ) {
    super(mensagem)
  }
}

interface CorpoDeErro {
  erro?: string
  /** Texto pronto pra mostrar ao usuário (as rotas de login mandam). */
  mensagem?: string
  minutos?: number
}

async function tratarResposta<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    throw new Error(MENSAGEM_SEM_ACESSO)
  }
  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as CorpoDeErro
    if (corpo.mensagem) throw new ErroDoServidor(corpo.mensagem, corpo.erro)
    if (res.status === 404) throw new Error('not-found')
    if (corpo.erro === 'senha-admin') throw new Error('Senha incorreta.')
    if (corpo.erro === 'bloqueado') {
      throw new Error(
        `Muitas senhas erradas a partir deste aparelho. Por segurança, ele foi bloqueado no servidor — tente de novo em ${corpo.minutos ?? 15} min.`,
      )
    }
    if (corpo.erro === 'sem-senhas') {
      throw new Error('O servidor ainda não tem senhas definidas. No celular do servidor, rode: node definir-senhas.js')
    }
    if (res.status === 403) throw new Error('O usuário não tem acesso ao servidor.')
    throw new Error(`Erro do servidor (${res.status}).`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// uma pergunta só pela senha de acesso, mesmo com várias requisições recusadas ao mesmo tempo (ao
// abrir o app saem várias juntas) — todas esperam a mesma resposta
let perguntaSenhaAcesso: Promise<boolean> | null = null
// quem cancelou a pergunta não é perguntado de novo a cada requisição — só ao recarregar a página
let recusouSenhaAcesso = false

async function perguntarSenhaAcesso(): Promise<boolean> {
  let mensagem =
    'Digite a senha de acesso ao servidor. Ela só é pedida de novo neste aparelho se for trocada (ou depois de 6 meses sem usar o site).'
  for (;;) {
    const senha = await pedirSenha(mensagem, { titulo: 'Senha de acesso', confirmText: 'Entrar' })
    if (senha === null) {
      recusouSenhaAcesso = true
      return false
    }
    const res = await enviar('/_acesso', {}, { senha })
    if (res.ok) {
      guardarAcesso(await chaveDaResposta(res), senha)
      return true
    }
    if (res.status !== 401) await tratarResposta(res) // bloqueado, servidor sem senhas...
    mensagem = 'Senha incorreta. Digite a senha de acesso ao servidor.'
  }
}

function obterSenhaAcesso(): Promise<boolean> {
  if (recusouSenhaAcesso) return Promise.resolve(false)
  if (!perguntaSenhaAcesso) {
    perguntaSenhaAcesso = perguntarSenhaAcesso().finally(() => {
      perguntaSenhaAcesso = null
    })
  }
  return perguntaSenhaAcesso
}

async function request<T>(path: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  await trocarSenhaGuardadaPelaChave()
  for (let tentativa = 0; ; tentativa++) {
    const acessoUsado = lerCredencial()
    const sessaoUsada = getSessao()
    const res = await enviar(path, opcoes, acessoUsado)
    if (res.status === 401) {
      const corpo = (await res.clone().json().catch(() => ({}))) as CorpoDeErro
      if (corpo.erro === 'sessao') {
        // sessão encerrada no servidor (saiu em outro lugar, senha trocada, usuário excluído...):
        // volta pro login — a não ser que alguém já tenha entrado de novo enquanto esta esperava
        if (getSessao() !== sessaoUsada) continue
        if (sessaoUsada) limparSessao()
        throw new Error(MENSAGEM_SESSAO_ENCERRADA)
      }
      if (tentativa < 3) {
        // o acesso guardado mudou enquanto esta esperava (outra requisição já perguntou)? só repete
        if (!mesmaCredencial(lerCredencial(), acessoUsado)) continue
        if (await obterSenhaAcesso()) continue
      }
    }
    return tratarResposta<T>(res)
  }
}

/** Chamada direta a uma rota do servidor (login, usuários...) — com as mesmas senhas, sessão e mensagens de erro dos dados. */
export function chamarServidor<T = void>(path: string, opcoes: { method?: string; corpo?: unknown } = {}): Promise<T> {
  return request<T>(path, {
    method: opcoes.method,
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  })
}

/** Confere a senha de admin no servidor antes de uma ação que pede senha. Lança 'Senha incorreta.' se não bater. */
export async function verificarSenhaAdmin(senha: string): Promise<void> {
  if (!senha) throw new Error('Senha incorreta.')
  await request('/_admin', { method: 'POST', senhaAdmin: senha })
}

export async function dbPut<T extends { id: string }>(
  storeName: string,
  value: T,
  opcoes?: { senhaAdmin?: string },
): Promise<void> {
  await request(`/${storeName}/${value.id}`, {
    method: 'PUT',
    body: JSON.stringify(value),
    senhaAdmin: opcoes?.senhaAdmin,
  })
}

export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  try {
    const dados = await request<T[]>(`/${storeName}`)
    salvarCache(storeName, dados)
    return dados
  } catch (err) {
    if (err instanceof ServidorInalcancavelError) {
      const emCache = lerCache<T[]>(storeName)
      if (emCache) return emCache
    }
    throw err
  }
}

export async function dbGet<T>(
  storeName: string,
  id: string,
  opcoes?: {
    /** Não guarda cópia no localStorage — pra arquivos grandes (planilhas), que encheriam o espaço
     * dele (uns 5 MB, divididos com o rascunho da cotação e o login). */
    semCache?: boolean
  },
): Promise<T | undefined> {
  const caminho = `${storeName}/${id}`
  try {
    // ?opcional=1: o que não existe volta vazio em vez de 404 (que o navegador mostra como erro no
    // console); servidor antigo ignora e responde 404, tratado abaixo
    const dado = await request<T | null>(`/${storeName}/${id}?opcional=1`)
    if (dado === null) {
      try {
        localStorage.removeItem(chaveCache(caminho))
      } catch {
        // sem localStorage não há cache pra limpar
      }
      return undefined
    }
    if (!opcoes?.semCache) salvarCache(caminho, dado)
    return dado
  } catch (err) {
    if (err instanceof ServidorInalcancavelError) {
      const emCache = lerCache<T>(caminho)
      if (emCache !== undefined) return emCache
      throw err
    }
    if (err instanceof Error && err.message === 'not-found') return undefined
    throw err
  }
}

export async function dbDelete(storeName: string, id: string, opcoes?: { senhaAdmin?: string }): Promise<void> {
  await request(`/${storeName}/${id}`, { method: 'DELETE', senhaAdmin: opcoes?.senhaAdmin })
}
