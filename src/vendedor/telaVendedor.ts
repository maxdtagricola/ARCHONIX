import { dbGet, dbPut } from '../db/db'

// O que os vendedores podem fazer e o que aparece na tela deles — o Max escolhe pra todos em
// Configurações › Funções de usuário › Vendedor (ou na visualização da tela dos vendedores) e, pra um
// vendedor só, em Usuários › Permissões (fica em `porVendedor`, pelo nome do vendedor). Fica em
// configuracoes/telaVendedor (o servidor deixa o vendedor ler, só o Max gravar, e confere o "pode"
// — ver liberadoAoVendedor no server.js). Sem escolha guardada, pode tudo e aparece tudo.

export type ParteDaTelaVendedor = 'valores' | 'itens' | 'andamento' | 'previsoes' | 'quemCota' | 'alteracoes' | 'anexos'
export type FormaDeImportar = 'planilha' | 'imagem' | 'pdf' | 'texto'
export type PodeDoVendedor = 'registrar' | 'alterar'

export interface ConfigTelaVendedor {
  /** Recado que aparece no topo da tela de todos os vendedores (vazio = nenhum). */
  mensagem: string
  partes: Record<ParteDaTelaVendedor, boolean>
  importar: Record<FormaDeImportar, boolean>
  pode: Record<PodeDoVendedor, boolean>
  /** Saída automática do vendedor: minutos sem atividade até sair (0 = nunca); null = o padrão do
   * aparelho (5 minutos — o vendedor não tem Configurações pra mudar). */
  minutosSaida: number | null
}

/** O documento inteiro: a configuração de todos (no próprio documento) e a de quem tem uma só dele. */
export interface ConfigDosVendedores {
  todos: ConfigTelaVendedor
  porVendedor: Record<string, ConfigTelaVendedor>
}

export const PODE_DO_VENDEDOR: { key: PodeDoVendedor; label: string }[] = [
  { key: 'registrar', label: 'Registrar cotações novas' },
  { key: 'alterar', label: 'Alterar as cotações dele (até o Pedido de Compra)' },
]

export const PARTES_DA_TELA_VENDEDOR: { key: ParteDaTelaVendedor; label: string }[] = [
  { key: 'valores', label: 'Valores (depois que a cotação é enviada)' },
  { key: 'itens', label: 'Itens pedidos' },
  { key: 'andamento', label: 'Andamento (status e datas)' },
  { key: 'previsoes', label: 'Previsão de produção e de entrega' },
  { key: 'quemCota', label: 'Quem está cotando' },
  { key: 'alteracoes', label: 'Alterações que ele fez' },
  { key: 'anexos', label: 'Arquivos da cotação (planilha do cliente, fotos, PDFs)' },
]

export const FORMAS_DE_IMPORTAR: { key: FormaDeImportar; label: string }[] = [
  { key: 'planilha', label: 'Planilha (Excel, CSV)' },
  { key: 'imagem', label: 'Foto, imagem ou print (colado com Ctrl+V)' },
  { key: 'pdf', label: 'PDF' },
  { key: 'texto', label: 'Texto colado (mensagem, e-mail)' },
]

export const CONFIG_TELA_VENDEDOR_PADRAO: ConfigTelaVendedor = {
  mensagem: '',
  partes: { valores: true, itens: true, andamento: true, previsoes: true, quemCota: true, alteracoes: true, anexos: true },
  importar: { planilha: true, imagem: true, pdf: true, texto: true },
  pode: { registrar: true, alterar: true },
  minutosSaida: null,
}

const STORE_CONFIG = 'configuracoes'
const DOC = 'telaVendedor'

type DocGuardado = Partial<ConfigTelaVendedor> & { id?: string; porVendedor?: Record<string, Partial<ConfigTelaVendedor>> }

/** O que estiver faltando (config gravada antes de uma parte nova existir) fica ligado. */
export function completarConfig(doc: Partial<ConfigTelaVendedor> | undefined | null): ConfigTelaVendedor {
  return {
    mensagem: typeof doc?.mensagem === 'string' ? doc.mensagem : '',
    partes: { ...CONFIG_TELA_VENDEDOR_PADRAO.partes, ...(doc?.partes ?? {}) },
    importar: { ...CONFIG_TELA_VENDEDOR_PADRAO.importar, ...(doc?.importar ?? {}) },
    pode: { ...CONFIG_TELA_VENDEDOR_PADRAO.pode, ...(doc?.pode ?? {}) },
    minutosSaida: typeof doc?.minutosSaida === 'number' && Number.isFinite(doc.minutosSaida) ? doc.minutosSaida : null,
  }
}

export async function getConfigDosVendedores(): Promise<ConfigDosVendedores> {
  const doc = await dbGet<DocGuardado>(STORE_CONFIG, DOC, { semCache: true })
  const porVendedor = Object.fromEntries(Object.entries(doc?.porVendedor ?? {}).map(([v, c]) => [v, completarConfig(c)]))
  return { todos: completarConfig(doc), porVendedor }
}

/** A que vale pra esse vendedor: a só dele, se tiver; senão a de todos. */
export function configDoVendedor(config: ConfigDosVendedores, vendedor: string): ConfigTelaVendedor {
  return config.porVendedor[vendedor] ?? config.todos
}

export async function getConfigTelaVendedor(vendedor: string): Promise<ConfigTelaVendedor> {
  return configDoVendedor(await getConfigDosVendedores(), vendedor)
}

/** Só o Max (o servidor recusa os outros). Grava o documento inteiro: a de todos e as de cada um. */
export async function salvarConfigDosVendedores(config: ConfigDosVendedores): Promise<void> {
  await dbPut(STORE_CONFIG, { id: DOC, ...config.todos, porVendedor: config.porVendedor })
}

/** A configuração de todos os vendedores (as de quem tem uma só dele ficam como estão). */
export async function salvarConfigTelaVendedor(todos: ConfigTelaVendedor): Promise<void> {
  const atual = await getConfigDosVendedores()
  await salvarConfigDosVendedores({ ...atual, todos })
}

/** A configuração só desse vendedor (null = volta a valer a de todos). */
export async function salvarConfigDoVendedor(vendedor: string, config: ConfigTelaVendedor | null): Promise<ConfigDosVendedores> {
  const atual = await getConfigDosVendedores()
  const porVendedor = { ...atual.porVendedor }
  if (config) porVendedor[vendedor] = config
  else delete porVendedor[vendedor]
  const novo = { ...atual, porVendedor }
  await salvarConfigDosVendedores(novo)
  return novo
}
