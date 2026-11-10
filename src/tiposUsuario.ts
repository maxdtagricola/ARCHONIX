import { dbGet, dbPut } from './db/db'
import { ABAS_PADRAO, getAbasPorUsuario, salvarAbasDoUsuario } from './abasPermitidas'
import { ABAS_FINANCEIRAS, financeiroPadrao, getFinanceiroPorUsuario, salvarFinanceiroDoUsuario } from './financeiroPorUsuario'
import { getPermissoesStatus, salvarPermissoesStatusDoUsuario, type PermissoesStatusDoUsuario } from './statusConfig'
import { getTelaInicialPorUsuario, salvarTelaInicialDoUsuario, type ParteTelaInicial } from './telaInicialPorUsuario'
import type { TabKey } from './components/Layout'
import type { PapelUsuario } from './sessaoUsuario'

// Funções de usuário (ex.: "Vendedor", "Estoque"): o que cada uma acessa — abas, o que aparece na Tela
// Inicial, os status permitidos e se é administrador (vê prejuízo e faturamento). O Max monta em
// Configurações › Funções de usuário e escolhe a função de cada um em Configurações › Usuários. A
// função de um usuário é a que tem exatamente as permissões dele: mudar uma função atualiza quem está
// nela, e quem tem as permissões ajustadas à mão fica como "Personalizada". Além das criadas pelo Max,
// há sempre a "Administrador (site completo)" (PERMISSOES_ADMIN) e a "Sem função definida".
// (No servidor o documento continua se chamando tiposUsuario.)

export interface PermissoesDoUsuario {
  abas: TabKey[]
  /** null = pode mudar pra qualquer status (inclusive os criados depois). */
  statusCotacoes: string[] | null
  statusNotas: string[] | null
  /** null (ou ausente, nos tipos gravados antes) = vê a Tela Inicial inteira. */
  telaInicial?: ParteTelaInicial[] | null
  /** Administrador: vê prejuízo e faturamento. Ausente (nos tipos gravados antes) = não vê. */
  financeiro?: boolean
}

export interface TipoUsuario extends PermissoesDoUsuario {
  id: string
  nome: string
  /** 'admin' nas funções criadas agora; 'xadrez' só nos tipos antigos "sem função". */
  papel: PapelUsuario
}

const STORE_CONFIG = 'configuracoes'
const DOC = 'tiposUsuario'

/** Ponto de partida de uma função nova: o padrão de abas, sem ser administrador. */
export const PERMISSOES_PADRAO: PermissoesDoUsuario = { abas: ABAS_PADRAO, statusCotacoes: null, statusNotas: null, telaInicial: null, financeiro: false }

/** A função "Administrador (site completo)", que existe sempre. */
export const PERMISSOES_ADMIN: PermissoesDoUsuario = { ...PERMISSOES_PADRAO, financeiro: true }

export async function getTiposUsuario(): Promise<TipoUsuario[]> {
  const doc = await dbGet<{ id: string; lista?: TipoUsuario[] }>(STORE_CONFIG, DOC)
  return doc?.lista ?? []
}

/** Só o Max (o servidor recusa os outros). */
export async function salvarTiposUsuario(lista: TipoUsuario[]): Promise<void> {
  await dbPut(STORE_CONFIG, { id: DOC, lista })
}

/** Grava as abas, a Tela Inicial, os status e o "administrador" de um usuário (do jeito que vieram do
 * editor ou de uma função). */
export async function aplicarPermissoes(login: string, p: PermissoesDoUsuario): Promise<void> {
  await salvarAbasDoUsuario(login, p.abas)
  await salvarTelaInicialDoUsuario(login, p.telaInicial ?? null)
  await salvarFinanceiroDoUsuario(login, !!p.financeiro)
  const semRestricao = p.statusCotacoes === null && p.statusNotas === null
  await salvarPermissoesStatusDoUsuario(
    login,
    semRestricao
      ? null
      : { ...(p.statusCotacoes ? { cotacoes: p.statusCotacoes } : {}), ...(p.statusNotas ? { notas: p.statusNotas } : {}) },
  )
}

/** As abas que valem de fato: sem administrador, Faturamento e Relatórios não contam (o site esconde). */
export function abasEfetivas(p: PermissoesDoUsuario): TabKey[] {
  return p.financeiro ? p.abas : p.abas.filter((a) => !ABAS_FINANCEIRAS.includes(a))
}

/** As mesmas permissões? (pra dizer de que função um usuário é) */
export function mesmasPermissoes(a: PermissoesDoUsuario, b: PermissoesDoUsuario): boolean {
  const igual = (x: readonly string[] | null, y: readonly string[] | null) =>
    x === null || y === null ? x === y : x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|')
  return (
    igual(abasEfetivas(a), abasEfetivas(b)) &&
    igual(a.statusCotacoes, b.statusCotacoes) &&
    igual(a.statusNotas, b.statusNotas) &&
    igual(a.telaInicial ?? null, b.telaInicial ?? null) &&
    !!a.financeiro === !!b.financeiro
  )
}

/** As permissões guardadas de todos os usuários (cada parte num documento de configuracoes). */
export interface PermissoesGuardadas {
  abas: Record<string, TabKey[]>
  status: Record<string, PermissoesStatusDoUsuario>
  telaInicial: Record<string, ParteTelaInicial[]>
  financeiro: Record<string, boolean>
}

export async function carregarPermissoesGuardadas(): Promise<PermissoesGuardadas> {
  const [abas, status, telaInicial, financeiro] = await Promise.all([
    getAbasPorUsuario(),
    getPermissoesStatus(),
    getTelaInicialPorUsuario(),
    getFinanceiroPorUsuario(),
  ])
  return { abas, status, telaInicial, financeiro }
}

/** As permissões de um usuário — o padrão no que não foi escolhido pra ele. */
export function permissoesDoUsuario(g: PermissoesGuardadas, usuario: { login: string; nome: string }): PermissoesDoUsuario {
  const status = g.status[usuario.login]
  const p: PermissoesDoUsuario = {
    abas: g.abas[usuario.login] ?? ABAS_PADRAO,
    statusCotacoes: status?.cotacoes ?? null,
    statusNotas: status?.notas ?? null,
    telaInicial: g.telaInicial[usuario.login] ?? null,
    financeiro: g.financeiro[usuario.login] ?? financeiroPadrao(usuario.nome),
  }
  return { ...p, abas: abasEfetivas(p) }
}

/** A função de um usuário, como valor do campo "Função": 'xadrez' (sem função), `vendedor:<NOME>`,
 * `tipo:<id>`, 'admin' (Administrador, site completo) ou 'personalizada' (permissões que não batem com
 * nenhuma função). */
export function funcaoDoUsuario(papel: PapelUsuario, p: PermissoesDoUsuario, tipos: TipoUsuario[], vendedor?: string): string {
  if (papel === 'vendedor') return `vendedor:${vendedor ?? ''}`
  if (papel !== 'admin') return 'xadrez'
  const tipo = tipos.find((t) => t.papel === 'admin' && mesmasPermissoes(t, p))
  if (tipo) return `tipo:${tipo.id}`
  return mesmasPermissoes(p, PERMISSOES_ADMIN) ? 'admin' : 'personalizada'
}
