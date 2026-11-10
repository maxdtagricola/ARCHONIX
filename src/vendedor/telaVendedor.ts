import { dbGet, dbPut } from '../db/db'

// O que aparece na tela dos vendedores — o Max escolhe em Configurações › Tela dos vendedores, vendo a
// tela de um vendedor ao vivo. Fica em configuracoes/telaVendedor (o servidor deixa o vendedor ler e só
// o Max gravar). Sem escolha guardada, aparece tudo.

export type ParteDaTelaVendedor = 'valores' | 'itens' | 'andamento' | 'previsoes' | 'quemCota' | 'alteracoes' | 'anexos'
export type FormaDeImportar = 'planilha' | 'imagem' | 'pdf' | 'texto'

export interface ConfigTelaVendedor {
  /** Recado que aparece no topo da tela de todos os vendedores (vazio = nenhum). */
  mensagem: string
  partes: Record<ParteDaTelaVendedor, boolean>
  importar: Record<FormaDeImportar, boolean>
}

export const PARTES_DA_TELA_VENDEDOR: { key: ParteDaTelaVendedor; label: string }[] = [
  { key: 'valores', label: 'Valores (depois que a cotação é enviada)' },
  { key: 'itens', label: 'Itens pedidos' },
  { key: 'andamento', label: 'Andamento (status e datas)' },
  { key: 'previsoes', label: 'Previsão de produção e de entrega' },
  { key: 'quemCota', label: 'Quem está cotando' },
  { key: 'alteracoes', label: 'Alterações que ele fez' },
  { key: 'anexos', label: 'Arquivos que ele mandou' },
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
}

const STORE_CONFIG = 'configuracoes'
const DOC = 'telaVendedor'

/** O que estiver faltando (config gravada antes de uma parte nova existir) fica ligado. */
export function completarConfig(doc: Partial<ConfigTelaVendedor> | undefined | null): ConfigTelaVendedor {
  return {
    mensagem: typeof doc?.mensagem === 'string' ? doc.mensagem : '',
    partes: { ...CONFIG_TELA_VENDEDOR_PADRAO.partes, ...(doc?.partes ?? {}) },
    importar: { ...CONFIG_TELA_VENDEDOR_PADRAO.importar, ...(doc?.importar ?? {}) },
  }
}

export async function getConfigTelaVendedor(): Promise<ConfigTelaVendedor> {
  return completarConfig(await dbGet<Partial<ConfigTelaVendedor> & { id: string }>(STORE_CONFIG, DOC))
}

/** Só o Max (o servidor recusa os outros). */
export async function salvarConfigTelaVendedor(config: ConfigTelaVendedor): Promise<void> {
  await dbPut(STORE_CONFIG, { id: DOC, ...config })
}
