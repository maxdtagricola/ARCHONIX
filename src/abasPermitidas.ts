import { useCallback, useEffect, useState } from 'react'
import { dbGet, dbPut } from './db/db'
import { GRUPOS_DE_ABAS, type TabKey } from './components/Layout'
import { ABAS_FINANCEIRAS, financeiroPadrao, getFinanceiroPorUsuario } from './financeiroPorUsuario'
import type { UsuarioLogado } from './sessaoUsuario'

// Quais abas cada usuário vê — o MÁXIMUS (gestor) escolhe em Configurações > Usuários. Fica em
// configuracoes/abasPorUsuario; quem não tem escolha guardada vê o padrão (todas, menos as que eram
// só do Max). O gestor vê sempre tudo. Tela Inicial e Configurações aparecem pra todo mundo — em
// Configurações, quem não tem "Configurações gerais" vê só as partes pessoais (minha conta, saída
// automática, vídeo de fundo).
//
// Atenção: é o que aparece no site — o servidor não sabe de abas e entrega os dados pra qualquer
// administrador logado.

const STORE_CONFIG = 'configuracoes'
const DOC = 'abasPorUsuario'
// a última lista vista, pra montar o menu na hora (sem piscar as abas) enquanto o servidor responde
const PREFIXO_CACHE = 'abasPermitidas:'
// e se vê prejuízo e faturamento (ver financeiroPorUsuario.ts)
const PREFIXO_CACHE_FINANCEIRO = 'financeiro:'

/** As abas que dá pra liberar ou tirar, na ordem do menu. */
export const ABAS_CONFIGURAVEIS: { key: TabKey; label: string; grupo: string }[] = GRUPOS_DE_ABAS.flatMap((g) =>
  g.items
    .filter((i) => i.key !== 'telaInicial')
    .map((i) => ({ key: i.key, label: i.key === 'configuracoes' ? 'Configurações gerais' : i.label, grupo: g.label })),
)

/** O nome da aba como aparece no menu (o Comparar é parte da Precificação). */
export function nomeDaAba(tab: TabKey): string {
  if (tab === 'comparar') return 'Comparar fornecedores'
  return GRUPOS_DE_ABAS.flatMap((g) => g.items).find((i) => i.key === tab)?.label ?? tab
}

/** Sem escolha guardada: tudo, menos as abas que antes eram só do Max. */
export const ABAS_PADRAO: TabKey[] = GRUPOS_DE_ABAS.flatMap((g) => g.items)
  .filter((i) => i.key !== 'telaInicial' && !i.somenteGestor)
  .map((i) => i.key)

interface AbasDoc {
  id: string
  porUsuario: Record<string, TabKey[]>
}

export async function getAbasPorUsuario(): Promise<Record<string, TabKey[]>> {
  const doc = await dbGet<AbasDoc>(STORE_CONFIG, DOC)
  return doc?.porUsuario ?? {}
}

/** `abas` null = volta pro padrão. */
export async function salvarAbasDoUsuario(login: string, abas: TabKey[] | null): Promise<Record<string, TabKey[]>> {
  const porUsuario = { ...(await getAbasPorUsuario()) }
  if (abas === null) delete porUsuario[login]
  else porUsuario[login] = abas
  await dbPut(STORE_CONFIG, { id: DOC, porUsuario })
  return porUsuario
}

function lerCache(login: string): TabKey[] | null {
  try {
    const bruto = localStorage.getItem(PREFIXO_CACHE + login)
    return bruto ? (JSON.parse(bruto) as TabKey[]) : null
  } catch {
    return null
  }
}

function gravarCache(login: string, abas: TabKey[], financeiro: boolean) {
  try {
    localStorage.setItem(PREFIXO_CACHE + login, JSON.stringify(abas))
    localStorage.setItem(PREFIXO_CACHE_FINANCEIRO + login, financeiro ? '1' : '0')
  } catch {
    // sem localStorage: na próxima abertura o menu espera o servidor
  }
}

function lerCacheFinanceiro(login: string): boolean | null {
  try {
    const bruto = localStorage.getItem(PREFIXO_CACHE_FINANCEIRO + login)
    return bruto === null ? null : bruto === '1'
  } catch {
    return null
  }
}

export interface Permissoes {
  podeVer: (tab: TabKey) => boolean
  /** As partes de Configurações que valem pra todos (formação de preço, empresas, planilhas...). */
  configuracoesGerais: boolean
  /** Administrador: vê prejuízo e faturamento (ver financeiroPorUsuario.ts). */
  veFinanceiro: boolean
}

/** As abas do usuário logado (busca no servidor ao abrir; até lá, a última lista vista neste aparelho —
 * na primeira vez, nenhuma além da Tela Inicial e de Configurações, pra não mostrar o que não devia). */
export function usePermissoes(usuario: UsuarioLogado): Permissoes {
  const [abas, setAbas] = useState<TabKey[] | null>(() => lerCache(usuario.login))
  // até o servidor responder (na primeira vez neste aparelho), não vê
  const [financeiro, setFinanceiro] = useState(() => lerCacheFinanceiro(usuario.login) ?? false)

  useEffect(() => {
    if (usuario.gestor) return
    let cancelado = false
    Promise.all([getAbasPorUsuario(), getFinanceiroPorUsuario()])
      .then(([porUsuario, financeiroPorUsuario]) => {
        if (cancelado) return
        const lista = porUsuario[usuario.login] ?? ABAS_PADRAO
        const ve = financeiroPorUsuario[usuario.login] ?? financeiroPadrao(usuario.nome)
        setAbas(lista)
        setFinanceiro(ve)
        gravarCache(usuario.login, lista, ve)
      })
      .catch(() => {
        // sem servidor agora: fica a última lista vista (ou o padrão, se nunca viu)
        if (cancelado) return
        setAbas((atual) => atual ?? ABAS_PADRAO)
        setFinanceiro(lerCacheFinanceiro(usuario.login) ?? financeiroPadrao(usuario.nome))
      })
    return () => {
      cancelado = true
    }
  }, [usuario.login, usuario.nome, usuario.gestor])

  const veFinanceiro = usuario.gestor || financeiro

  const podeVer = useCallback(
    (tab: TabKey): boolean => {
      if (usuario.gestor || tab === 'telaInicial' || tab === 'configuracoes') return true
      if (!abas) return false
      if (ABAS_FINANCEIRAS.includes(tab) && !veFinanceiro) return false
      // o Comparar é um pedaço da Precificação
      if (tab === 'comparar') return abas.includes('dashboard')
      return abas.includes(tab)
    },
    [abas, usuario.gestor, veFinanceiro],
  )

  return { podeVer, configuracoesGerais: usuario.gestor || (abas?.includes('configuracoes') ?? false), veFinanceiro }
}
