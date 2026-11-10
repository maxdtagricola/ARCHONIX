import { dbGet, dbPut } from './db/db'
import { ADMINS } from './types'
import type { TabKey } from './components/Layout'

// Quem vê prejuízo e faturamento: os administradores. O MÁXIMUS (gestor) marca em Configurações ›
// Usuários (ou na função). Fica em configuracoes/financeiroPorUsuario; sem escolha guardada, só os três
// administradores de sempre (Max, Gouvêa e Maicon). O gestor vê sempre.
//
// Pra quem não vê, somem: as abas Faturamento e Relatórios, o resultado (faturado / parado no estoque)
// das Transferências Fiscais, o faturamento × prejuízo do Dashboard de Transferências, o aviso de
// prejuízo da Tela Inicial e o valor faturado do Dashboard. Atenção: é o que aparece no site — o
// servidor entrega os dados pra qualquer administrador logado.

const STORE_CONFIG = 'configuracoes'
const DOC = 'financeiroPorUsuario'

/** As abas que só existem pra quem vê prejuízo e faturamento. */
export const ABAS_FINANCEIRAS: TabKey[] = ['faturamento', 'relatorios']

/** Sem escolha guardada: os três administradores iniciais veem, quem veio depois não. */
export function financeiroPadrao(nome: string): boolean {
  return ADMINS.includes(nome)
}

interface FinanceiroDoc {
  id: string
  porUsuario: Record<string, boolean>
}

export async function getFinanceiroPorUsuario(): Promise<Record<string, boolean>> {
  const doc = await dbGet<FinanceiroDoc>(STORE_CONFIG, DOC)
  return doc?.porUsuario ?? {}
}

/** Só o Max (o servidor recusa os outros). */
export async function salvarFinanceiroDoUsuario(login: string, ve: boolean): Promise<void> {
  const porUsuario = { ...(await getFinanceiroPorUsuario()) }
  porUsuario[login] = ve
  await dbPut(STORE_CONFIG, { id: DOC, porUsuario })
}
