import { useEffect, useState } from 'react'
import { dbGet, dbPut } from './db/db'
import { NOTA_FISCAL_STATUSES, QUOTE_STATUSES } from './types'

// Os status das cotações e das notas (frete e notas fiscais) — o Max edita em Configurações:
//  - cada status tem um código fixo (`id`, o que fica gravado nas cotações/notas) e um nome (o que
//    aparece na tela). Renomear muda só o nome — nenhuma cotação gravada precisa mudar;
//  - os do sistema (todos os que vieram com o site) disparam alguma regra — podem ser renomeados e
//    mudar de lugar em relação aos criados, mas não ser excluídos nem trocar de ordem entre si
//    (várias regras dependem da ordem: "de PEDIDO DE COMPRA em diante" etc.);
//  - os criados pelo Max entram em qualquer posição e podem ser excluídos (se nenhuma cotação/nota
//    estiver neles).
// Fica em configuracoes/statusConfig. Quem pode mudar pra qual status: configuracoes/permissoesStatus
// (o servidor também confere).

export type TipoStatus = 'cotacoes' | 'notas'

export interface DefStatus {
  id: string
  nome: string
  sistema: boolean
}

type ConfigStatus = Record<TipoStatus, DefStatus[]>

const DOC_CONFIG = 'statusConfig'
const DOC_PERMISSOES = 'permissoesStatus'
const STORE_CONFIG = 'configuracoes'
const CHAVE_CACHE = 'statusConfig'

export const STATUS_DO_SISTEMA: Record<TipoStatus, readonly string[]> = {
  cotacoes: QUOTE_STATUSES,
  notas: NOTA_FISCAL_STATUSES,
}

/** O que cada status do sistema faz no site — explicação na tela de edição. */
export const USO_DO_STATUS: Record<TipoStatus, Record<string, string>> = {
  cotacoes: {
    PENDENTE: 'Começo de toda cotação; bloco "Pendentes" da Tela Inicial',
    'AGUARDANDO FORNECEDOR': 'Bloco "Em andamento" da Tela Inicial',
    'ANALISANDO VALORES': 'Marcado sozinho quando alguém começa a editar a cotação',
    ENVIADO: 'Conta os 7 dias do aviso de retorno do cliente',
    'PEDIDO DE COMPRA': 'Daqui em diante, a cotação aparece no Pedido de Compra',
    'PEDIDO CONFIRMADO': 'Pergunta se o pedido está em produção',
    'EM TRANSPORTE': 'Transporte de cada fornecedor e avisos de entrega',
    'CADASTRO DE PRODUTO': 'Ainda conta como a caminho (avisos de entrega)',
    'PARCIALMENTE ENTREGUE': 'Entrega em parte; daqui em diante entra no Faturamento',
    'FATURADO PARCIALMENTE': 'Parte dos itens faturada; o resto segue no transporte e nos avisos de entrega',
    ENTREGUE: 'Daqui em diante, a mercadoria conta como recebida',
    CONFERIDO: 'Pedido encerrado (fim da Tela Inicial)',
    FATURADO: 'Pedido faturado (aba Faturamento)',
    ARQUIVO: 'Pede o motivo do arquivamento',
  },
  notas: {
    'AGUARDANDO COLETA': 'Primeiro status de uma nota nova',
    'EM TRANSPORTE': 'Nota a caminho',
    'EM VERIFICAÇÃO': 'Nota em aberto',
    'CONFERÊNCIA DO MATERIAL': 'Nota em aberto',
    'AGUARDANDO ENTRADA': 'Nota em aberto',
    'DEVOLUÇÃO PARCIAL': 'Nota em aberto',
    DEVOLUÇÃO: 'Fecha a nota (devolvida)',
    CONCLUIDO: 'Fecha a nota (entra nas contas do mês)',
  },
}

function padrao(tipo: TipoStatus): DefStatus[] {
  return STATUS_DO_SISTEMA[tipo].map((id) => ({ id, nome: id, sistema: true }))
}

/** Garante que todo status do sistema está na lista (na ordem relativa certa) e que ninguém se repete. */
function normalizar(tipo: TipoStatus, lista: unknown): DefStatus[] {
  const sistema = STATUS_DO_SISTEMA[tipo]
  const vistos = new Set<string>()
  const saida: DefStatus[] = []
  if (Array.isArray(lista)) {
    for (const bruto of lista) {
      const d = bruto as Partial<DefStatus>
      if (typeof d?.id !== 'string' || !d.id || vistos.has(d.id)) continue
      vistos.add(d.id)
      const nome = typeof d.nome === 'string' && d.nome.trim() ? d.nome.trim().toUpperCase() : d.id
      saida.push({ id: d.id, nome, sistema: sistema.includes(d.id) })
    }
  }
  // os do sistema na ordem do sistema, ocupando as mesmas posições em que estavam
  const posicoesDoSistema = saida.map((d, i) => (d.sistema ? i : -1)).filter((i) => i >= 0)
  const doSistemaNaLista = saida.filter((d) => d.sistema)
  const ordenados = sistema.filter((id) => vistos.has(id)).map((id) => doSistemaNaLista.find((d) => d.id === id) as DefStatus)
  posicoesDoSistema.forEach((pos, k) => (saida[pos] = ordenados[k]))
  // status do sistema que ainda não estão na lista (novos no site): entram logo depois do anterior
  sistema.forEach((id, k) => {
    if (vistos.has(id)) return
    const anterior = k > 0 ? saida.findIndex((d) => d.id === sistema[k - 1]) : -1
    saida.splice(anterior + 1, 0, { id, nome: id, sistema: true })
    vistos.add(id)
  })
  return saida
}

function lerCache(): ConfigStatus {
  try {
    const bruto = localStorage.getItem(CHAVE_CACHE)
    if (bruto) {
      const c = JSON.parse(bruto) as Partial<ConfigStatus>
      return { cotacoes: normalizar('cotacoes', c.cotacoes), notas: normalizar('notas', c.notas) }
    }
  } catch {
    // sem cache: o padrão
  }
  return { cotacoes: padrao('cotacoes'), notas: padrao('notas') }
}

let config: ConfigStatus = lerCache()
// pra quem está logado: pra quais status pode mudar (null = todos)
let permitidos: Record<TipoStatus, string[] | null> = { cotacoes: null, notas: null }
let versao = 0
const ouvintes = new Set<(v: number) => void>()

function avisarMudanca() {
  versao++
  for (const ouvir of ouvintes) ouvir(versao)
}

/** Redesenha quem chamou quando a configuração (ou as permissões) mudam. */
export function useVersaoStatus(): number {
  const [v, setV] = useState(versao)
  useEffect(() => {
    ouvintes.add(setV)
    return () => {
      ouvintes.delete(setV)
    }
  }, [])
  return v
}

export function defsDe(tipo: TipoStatus): DefStatus[] {
  return config[tipo]
}

/** Os códigos, na ordem do fluxo — o que antes era QUOTE_STATUSES / NOTA_FISCAL_STATUSES. */
export function statusDe(tipo: TipoStatus): string[] {
  return config[tipo].map((d) => d.id)
}

/** A ordem do fluxo, mais os status que aparecem nos registros mas não estão mais na lista (ex.: um
 * criado e depois excluído) — no fim, pra nenhuma cotação/nota sumir das listas por status. */
export function ordemComExtras(tipo: TipoStatus, presentes: Iterable<string>): string[] {
  const lista = statusDe(tipo)
  const extras = [...new Set(presentes)].filter((s) => !lista.includes(s))
  return [...lista, ...extras]
}

/** O status vem antes de `marco` na ordem do fluxo? Um status que não está mais na lista (criado e
 * depois excluído) conta como antes — não dá pra saber onde ficava. */
export function statusAntesDe(status: string, marco: string, tipo: TipoStatus = 'cotacoes'): boolean {
  const ordem = statusDe(tipo)
  const posicao = ordem.indexOf(status)
  return posicao === -1 || posicao < ordem.indexOf(marco)
}

/** O caminho da cotação só pra frente (o que o vendedor vê): voltar a um status — de ANALISANDO VALORES
 * pra AGUARDANDO FORNECEDOR, por exemplo — tira do caminho o que vinha depois dele. O mesmo que o
 * servidor manda ao vendedor (andamentoParaVendedor no server.js); a equipe vê o histórico inteiro. */
export function caminhoSemVoltas(statuses: string[], tipo: TipoStatus = 'cotacoes'): string[] {
  const ordem = statusDe(tipo)
  const caminho: string[] = []
  for (const s of statuses) {
    const jaEsteve = caminho.indexOf(s)
    if (jaEsteve >= 0) {
      caminho.length = jaEsteve + 1
      continue
    }
    const posicao = ordem.indexOf(s)
    if (posicao >= 0) while (caminho.length > 0 && ordem.indexOf(caminho[caminho.length - 1]) >= posicao) caminho.pop()
    caminho.push(s)
  }
  return caminho
}

/** O nome que aparece na tela (o código, se não houver — ex.: status criado e já excluído). */
export function nomeDoStatus(id: string, tipo: TipoStatus = 'cotacoes'): string {
  return config[tipo].find((d) => d.id === id)?.nome ?? id
}

function aplicar(bruto: Partial<ConfigStatus> | undefined) {
  config = { cotacoes: normalizar('cotacoes', bruto?.cotacoes), notas: normalizar('notas', bruto?.notas) }
  try {
    localStorage.setItem(CHAVE_CACHE, JSON.stringify(config))
  } catch {
    // sem localStorage: vale até recarregar
  }
  avisarMudanca()
}

export async function carregarStatusConfig(): Promise<void> {
  const doc = await dbGet<{ id: string } & Partial<ConfigStatus>>(STORE_CONFIG, DOC_CONFIG)
  aplicar(doc)
}

/** Só o Max (o servidor recusa os outros). */
export async function salvarStatusConfig(novo: ConfigStatus): Promise<void> {
  const limpo = { cotacoes: normalizar('cotacoes', novo.cotacoes), notas: normalizar('notas', novo.notas) }
  await dbPut(STORE_CONFIG, { id: DOC_CONFIG, ...limpo })
  aplicar(limpo)
}

/** Código de um status novo, a partir do nome — único entre os existentes (inclusive os de notas). */
export function codigoParaStatusNovo(nome: string, existentes: string[]): string {
  const base = nome
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .slice(0, 40)
  let id = base
  for (let n = 2; existentes.includes(id); n++) id = `${base} (${n})`
  return id
}

// --- permissões: pra quais status cada usuário pode mudar -------------------------------------
export interface PermissoesStatusDoUsuario {
  cotacoes?: string[]
  notas?: string[]
}

export async function getPermissoesStatus(): Promise<Record<string, PermissoesStatusDoUsuario>> {
  const doc = await dbGet<{ id: string; porUsuario?: Record<string, PermissoesStatusDoUsuario> }>(STORE_CONFIG, DOC_PERMISSOES)
  return doc?.porUsuario ?? {}
}

/** `permissoes` null = pode mudar pra qualquer status. Só o Max (o servidor recusa os outros). */
export async function salvarPermissoesStatusDoUsuario(login: string, permissoes: PermissoesStatusDoUsuario | null): Promise<Record<string, PermissoesStatusDoUsuario>> {
  const porUsuario = { ...(await getPermissoesStatus()) }
  if (permissoes === null) delete porUsuario[login]
  else porUsuario[login] = permissoes
  await dbPut(STORE_CONFIG, { id: DOC_PERMISSOES, porUsuario })
  return porUsuario
}

/** As permissões de quem acabou de entrar (o gestor pode tudo). */
export async function carregarMinhasPermissoesStatus(login: string, gestor: boolean): Promise<void> {
  if (gestor) {
    permitidos = { cotacoes: null, notas: null }
  } else {
    const minhas = (await getPermissoesStatus())[login]
    permitidos = { cotacoes: minhas?.cotacoes ?? null, notas: minhas?.notas ?? null }
  }
  avisarMudanca()
}

export function podeMudarStatusPara(tipo: TipoStatus, id: string): boolean {
  const lista = permitidos[tipo]
  return lista === null || lista.includes(id)
}

/** Erro pronto pra quem tenta mudar sem permissão (o servidor dá o mesmo recado). */
export function conferirPermissaoDeStatus(tipo: TipoStatus, id: string): void {
  if (!podeMudarStatusPara(tipo, id)) {
    throw new Error(`Você não tem permissão para mudar o status para "${nomeDoStatus(id, tipo)}". Peça ao administrador.`)
  }
}
