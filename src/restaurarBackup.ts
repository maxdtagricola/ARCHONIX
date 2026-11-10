import { dbGetAll, dbPut, verificarSenhaAdmin } from './db/db'

// -----------------------------------------------------------------------
// Restaurar de um backup: lê uma cópia do banco (o dados.json de qualquer
// backup do servidor, em C:\FormacaoPreco\backup...) e traz de volta o que
// falta no sistema — notas, transferências, cotações (com a planilha do
// cliente), produtos, fornecedores, planilhas de markup e configurações —
// sem apagar nem desfazer nada do que foi feito depois:
//  - o que não existe no sistema entra;
//  - o que existe e é igual (ou mais novo no sistema) fica como está;
//  - o que existe mas é mais novo no backup volta pra versão do backup;
//  - o que parece ter sido lançado de novo depois (mesmo cliente e itens,
//    mesma nota, mesmo CNPJ, mesmo código interno) vem desmarcado, pra
//    pessoa decidir;
//  - cotação do backup com um código que hoje é de outra cotação ganha um
//    código novo (o antigo fica anotado na observação), e o contador de
//    códigos sobe pra depois do maior.
// -----------------------------------------------------------------------

export const COLECOES_RESTAURAVEIS = [
  { id: 'notasFiscaisGerais', nome: 'Notas Fiscais' },
  { id: 'notasFiscais', nome: 'Transferências Fiscais' },
  { id: 'analises', nome: 'Cotações' },
  { id: 'produtos', nome: 'Produtos' },
  { id: 'fornecedores', nome: 'Fornecedores' },
  { id: 'planilhas', nome: 'Planilhas de markup' },
  { id: 'configuracoes', nome: 'Configurações' },
] as const

export type ColecaoRestauravel = (typeof COLECOES_RESTAURAVEIS)[number]['id']

export type SituacaoNoBackup = 'nova' | 'maisNova' | 'parecida' | 'jaExiste' | 'invalida'

type Registro = Record<string, unknown> & { id: string }
type Banco = Record<string, Record<string, Registro>>

export interface ItemDoBackup {
  colecao: ColecaoRestauravel
  id: string
  /** O que vai ser gravado (a cotação já com o código novo, se precisou). */
  dados: Registro
  situacao: SituacaoNoBackup
  /** O que mostrar na linha da tabela. */
  colunas: string[]
  /** Por que está assim: parecida com o quê, código trocado, problema. */
  motivo?: string
  /** Gravado junto: a planilha do cliente de uma cotação. */
  junto?: { store: string; dados: Registro }[]
}

export interface AnaliseDoBackup {
  itens: ItemDoBackup[]
  /** O contador de códigos de cotação depois da restauração (só sobe). */
  contadorNovo: number | null
  /** O que mais havia no arquivo e não entra (xadrez, sessões...). */
  ignorado: string[]
}

export const COLUNAS_DA_TABELA: Record<ColecaoRestauravel, string[]> = {
  notasFiscaisGerais: ['NF', 'Fornecedor', 'Emissão', 'Valor', 'Status'],
  notasFiscais: ['NF', 'Fornecedor', 'Emissão', 'Valor', 'Status'],
  analises: ['Código', 'Cliente', 'Vendedor', 'Criada', 'Status', 'Itens'],
  produtos: ['Código interno', 'Descrição', 'Referência'],
  fornecedores: ['Nome', 'CNPJ', 'Cidade'],
  planilhas: ['Arquivo', 'Perfil', 'Importada'],
  configuracoes: ['O quê'],
}

const NOMES_DAS_CONFIGURACOES: Record<string, string> = {
  statusConfig: 'Status personalizados (nomes, cores e ordem)',
  statusColors: 'Cores dos status',
  abasPorUsuario: 'Abas de cada usuário',
  telaInicialPorUsuario: 'Tela Inicial de cada usuário',
  permissoesStatus: 'Quem pode mudar cada status',
  empresaPorTransportadora: 'Empresa de destino por transportadora',
  planilhaAtiva: 'Planilha de markup em uso',
  contadorCotacao: 'Contador dos códigos de cotação',
}

const normalizar = (texto: unknown) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

const soDigitos = (t: unknown) => String(t ?? '').replace(/\D/g, '')
const dataCurta = (t: unknown) => (typeof t === 'number' && t > 0 ? new Date(t).toLocaleDateString('pt-BR') : '—')
const dataIso = (t: unknown) => (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10).split('-').reverse().join('/') : '—')
const moeda = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—')
const numeroDoCodigo = (codigo: unknown) => Number(soDigitos(codigo)) || 0
const codigoDe = (n: number) => `COT-${String(n).padStart(4, '0')}`

/** O último momento em que o registro mudou, pelo que ele mesmo guarda. */
function ultimaMudanca(r: Registro): number {
  let maior = 0
  for (const campo of ['updatedAt', 'createdAt', 'importadoEm']) {
    const v = r[campo]
    if (typeof v === 'number' && v > maior) maior = v
  }
  for (const h of Array.isArray(r.statusHistory) ? (r.statusHistory as { changedAt?: number }[]) : []) {
    if (typeof h?.changedAt === 'number' && h.changedAt > maior) maior = h.changedAt
  }
  return maior
}

function problema(colecao: ColecaoRestauravel, r: unknown): string | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'registro vazio'
  const x = r as Record<string, unknown>
  if (typeof x.id !== 'string' || !x.id || x.id.includes('/')) return 'sem identificador'
  if (colecao === 'notasFiscais' || colecao === 'notasFiscaisGerais') {
    if (!String(x.numeroNfe ?? '').trim()) return 'sem número da nota'
    if (typeof x.valorNota !== 'number' || !Number.isFinite(x.valorNota)) return 'valor da nota inválido'
    if (typeof x.status !== 'string' || !x.status) return 'sem status'
    if (!Array.isArray(x.statusHistory)) return 'sem histórico de status'
  }
  if (colecao === 'analises' && (!Array.isArray(x.items) || !Array.isArray(x.statusHistory))) return 'cotação sem itens ou histórico'
  return null
}

function colunasDe(colecao: ColecaoRestauravel, r: Registro, codigo?: string): string[] {
  const x = r as Record<string, unknown>
  if (colecao === 'notasFiscais' || colecao === 'notasFiscaisGerais') return [String(x.numeroNfe ?? ''), String(x.fornecedor ?? ''), dataIso(x.dataEmissao), moeda(x.valorNota), String(x.status ?? '')]
  if (colecao === 'analises') return [codigo ?? String(x.codigo ?? ''), String(x.cliente ?? ''), String(x.vendedor ?? ''), dataCurta(x.createdAt), String(x.status ?? ''), String((x.items as unknown[] | undefined)?.length ?? 0)]
  if (colecao === 'produtos') return [String(x.interno ?? ''), String(x.descricao ?? ''), Array.isArray(x.referencias) ? (x.referencias as unknown[]).join(', ') : String(x.referencia ?? '')]
  if (colecao === 'fornecedores') return [String(x.nome ?? ''), String(x.cnpj ?? ''), [x.cidade, x.estado].filter(Boolean).join(' / ')]
  if (colecao === 'planilhas') return [String(x.nomeArquivo ?? ''), String(x.perfil ?? ''), dataCurta(x.importadoEm)]
  return [NOMES_DAS_CONFIGURACOES[r.id] ?? r.id]
}

const codigosDosItens = (c: Registro) =>
  new Set(((c.items as { product?: { interno?: string; referencia?: string } }[] | undefined) ?? []).map((i) => normalizar(i.product?.interno || i.product?.referencia)).filter(Boolean))

/** Uma cotação de hoje que parece esta do backup lançada de novo: mesmo cliente e metade ou mais dos itens. */
function cotacaoParecida(doBackup: Registro, deHoje: Registro[]): Registro | undefined {
  const cliente = normalizar(doBackup.cliente)
  const itens = codigosDosItens(doBackup)
  let melhor: { c: Registro; nota: number } | undefined
  for (const c of deHoje) {
    if (normalizar(c.cliente) !== cliente) continue
    const outros = codigosDosItens(c)
    const comuns = [...itens].filter((i) => outros.has(i)).length
    const nota = Math.max(itens.size, outros.size) > 0 ? comuns / Math.max(itens.size, outros.size) : 0
    if (nota >= 0.5 && (!melhor || nota > melhor.nota)) melhor = { c, nota }
  }
  return melhor?.c
}

function chaveParecida(colecao: ColecaoRestauravel, r: Registro): string | null {
  if (colecao === 'notasFiscais' || colecao === 'notasFiscaisGerais') return `${soDigitos(r.numeroNfe).replace(/^0+/, '')}|${normalizar(r.fornecedor)}`
  if (colecao === 'fornecedores') return soDigitos(r.cnpj) || normalizar(r.nome) || null
  if (colecao === 'produtos') return normalizar(r.interno) || null
  return null
}

export function lerBackup(texto: string): Banco {
  let dados: unknown
  try {
    dados = JSON.parse(texto.replace(/^\ufeff/, ''))
  } catch {
    throw new Error('O arquivo não é um JSON válido (pode estar cortado ou ser de outro tipo).')
  }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('O arquivo não tem o formato dos dados do Archonix.')
  const banco = dados as Record<string, unknown>
  if (!COLECOES_RESTAURAVEIS.some(({ id }) => id in banco)) throw new Error('O arquivo não tem nada que dê pra restaurar (nem notas, nem cotações, nem produtos).')
  const normal: Banco = {}
  for (const [chave, valor] of Object.entries(banco)) {
    const lista = Array.isArray(valor) ? valor : valor && typeof valor === 'object' ? Object.values(valor as Record<string, unknown>) : []
    normal[chave] = Object.fromEntries(lista.filter((r) => r && typeof r === 'object' && typeof (r as Registro).id === 'string').map((r) => [(r as Registro).id, r as Registro]))
  }
  return normal
}

/** O que o sistema tem hoje, pra comparar (as coleções que o backup pode trazer, mais as planilhas de cliente). */
export async function dadosDoSistema(): Promise<Banco> {
  const nomes = [...COLECOES_RESTAURAVEIS.map((c) => c.id), 'planilhasCliente']
  const listas = await Promise.all(nomes.map((n) => dbGetAll<Registro>(n)))
  return Object.fromEntries(nomes.map((n, i) => [n, Object.fromEntries(listas[i].map((r) => [r.id, r]))]))
}

export function analisarBackup(backup: Banco, sistema: Banco): AnaliseDoBackup {
  const itens: ItemDoBackup[] = []
  const deHoje = (colecao: string) => sistema[colecao] ?? {}

  for (const { id: colecao } of COLECOES_RESTAURAVEIS) {
    if (colecao === 'configuracoes') continue
    const atuais = deHoje(colecao)
    const parecidas = new Map<string, Registro>()
    for (const r of Object.values(atuais)) {
      const chave = chaveParecida(colecao, r)
      if (chave) parecidas.set(chave, r)
    }
    for (const r of Object.values(backup[colecao] ?? {})) {
      const defeito = problema(colecao, r)
      if (defeito) {
        itens.push({ colecao, id: String((r as Registro)?.id ?? '?'), dados: r, situacao: 'invalida', colunas: colunasDe(colecao, r), motivo: defeito })
        continue
      }
      const atual = atuais[r.id]
      let situacao: SituacaoNoBackup
      let motivo: string | undefined
      if (atual) {
        situacao = JSON.stringify(atual) !== JSON.stringify(r) && ultimaMudanca(r) > ultimaMudanca(atual) ? 'maisNova' : 'jaExiste'
        if (situacao === 'maisNova') motivo = 'a do backup é mais nova que a do sistema'
      } else if (colecao === 'analises') {
        const parecida = cotacaoParecida(r, Object.values(atuais))
        situacao = parecida ? 'parecida' : 'nova'
        if (parecida) motivo = `parece a ${String(parecida.codigo)} de hoje, lançada de novo`
      } else {
        const chave = chaveParecida(colecao, r)
        const parecida = chave ? parecidas.get(chave) : undefined
        situacao = parecida ? 'parecida' : 'nova'
        if (parecida) motivo = colecao === 'produtos' ? 'já existe um produto com esse código interno' : colecao === 'fornecedores' ? 'já existe um fornecedor com esse CNPJ ou nome' : 'mesmo número e fornecedor de uma nota já cadastrada'
      }
      itens.push({ colecao, id: r.id, dados: r, situacao, colunas: colunasDe(colecao, r), motivo })
    }
  }

  // --- cotações: código repetido ganha código novo; a planilha do cliente vai junto
  const cotacoesDeHoje = Object.values(deHoje('analises'))
  const codigosDeHoje = new Map(cotacoesDeHoje.map((c) => [normalizar(c.codigo), c.id]))
  const contadorDeHoje = Number((deHoje('configuracoes').contadorCotacao as Record<string, unknown> | undefined)?.valor ?? 0) || 0
  const maiorDoBackup = Math.max(0, ...Object.values(backup.analises ?? {}).map((c) => numeroDoCodigo(c.codigo)))
  const maiorDeHoje = Math.max(0, ...cotacoesDeHoje.map((c) => numeroDoCodigo(c.codigo)))
  let proximo = Math.max(contadorDeHoje, maiorDoBackup, maiorDeHoje)
  const cotacoesDoBackup = itens.filter((i) => i.colecao === 'analises' && (i.situacao === 'nova' || i.situacao === 'parecida' || i.situacao === 'maisNova'))
  cotacoesDoBackup.sort((a, b) => numeroDoCodigo(a.dados.codigo) - numeroDoCodigo(b.dados.codigo))
  const hoje = new Date().toLocaleDateString('pt-BR')
  for (const item of cotacoesDoBackup) {
    const dono = codigosDeHoje.get(normalizar(item.dados.codigo))
    if (dono && dono !== item.id) {
      proximo++
      const antigo = String(item.dados.codigo)
      const novo = codigoDe(proximo)
      const observacao = [String(item.dados.observacao ?? '').trim(), `Código antigo: ${antigo} (trocado na restauração do backup em ${hoje}: ${antigo} passou a ser de outra cotação).`]
        .filter(Boolean)
        .join('\n')
      item.dados = { ...item.dados, codigo: novo, observacao }
      item.colunas = colunasDe('analises', item.dados, `${novo} (era ${antigo})`)
      item.motivo = [item.motivo, `o código ${antigo} já é de outra cotação: volta como ${novo}`].filter(Boolean).join('; ')
    }
    const planilha = backup.planilhasCliente?.[item.id]
    if (planilha && !deHoje('planilhasCliente')[item.id]) item.junto = [{ store: 'planilhasCliente', dados: planilha }]
  }
  const maiorDepois = Math.max(proximo, ...cotacoesDoBackup.map((i) => numeroDoCodigo(i.dados.codigo)))
  const contadorNovo = maiorDepois > contadorDeHoje ? maiorDepois : null

  // --- configurações: as que sumiram voltam; a planilha de markup em uso volta pra mais nova
  const configDeHoje = deHoje('configuracoes')
  for (const r of Object.values(backup.configuracoes ?? {})) {
    if (r.id === 'contadorCotacao') continue
    if (r.id === 'planilhaAtiva') {
      const item = planilhaEmUso(r, configDeHoje.planilhaAtiva, backup, sistema)
      if (item) itens.push(item)
      continue
    }
    const atual = configDeHoje[r.id]
    itens.push({ colecao: 'configuracoes', id: r.id, dados: r, situacao: atual ? 'jaExiste' : 'nova', colunas: colunasDe('configuracoes', r) })
  }

  // as empresas do grupo se cadastram à parte (com senha de admin) e não mudam de um backup pro outro
  const conhecidas = new Set<string>([...COLECOES_RESTAURAVEIS.map((c) => c.id), 'planilhasCliente', 'empresas'])
  const ignorado = Object.keys(backup).filter((k) => !conhecidas.has(k) && Object.keys(backup[k]).length > 0)
  return { itens, contadorNovo, ignorado }
}

/** Por perfil (RO, AC), a planilha de markup em uso volta pra do backup quando ela foi importada depois da de hoje. */
function planilhaEmUso(doBackup: Registro, deHoje: Registro | undefined, backup: Banco, sistema: Banco): ItemDoBackup | null {
  const planilhas = { ...(backup.planilhas ?? {}), ...(sistema.planilhas ?? {}) }
  const porPerfilBackup = (doBackup.porPerfil ?? {}) as Record<string, string>
  const porPerfilHoje = ((deHoje?.porPerfil ?? {}) as Record<string, string>) || {}
  const novo: Record<string, string> = { ...porPerfilHoje }
  const trocas: string[] = []
  for (const [perfil, id] of Object.entries(porPerfilBackup)) {
    const daCopia = planilhas[id]
    const atual = planilhas[porPerfilHoje[perfil]]
    const maisNova = daCopia && (!atual || Number(daCopia.importadoEm ?? 0) > Number(atual.importadoEm ?? 0))
    if (maisNova && porPerfilHoje[perfil] !== id) {
      novo[perfil] = id
      trocas.push(`${perfil}: ${String(daCopia.nomeArquivo ?? id)} (${dataCurta(daCopia.importadoEm)})`)
    }
  }
  if (trocas.length === 0) return null
  return {
    colecao: 'configuracoes',
    id: 'planilhaAtiva',
    dados: { ...(deHoje ?? {}), id: 'planilhaAtiva', porPerfil: novo },
    situacao: 'maisNova',
    colunas: [`${NOMES_DAS_CONFIGURACOES.planilhaAtiva}: ${trocas.join('; ')}`],
    motivo: 'a do backup foi importada depois da que está em uso',
  }
}

/** A ordem de gravar: o que os outros usam vem antes, e a planilha em uso e o contador por último. */
const ORDEM: ColecaoRestauravel[] = ['planilhas', 'configuracoes', 'produtos', 'fornecedores', 'analises', 'notasFiscais', 'notasFiscaisGerais']

export async function restaurarDoBackup(
  marcados: ItemDoBackup[],
  contadorNovo: number | null,
  senhaAdmin: string,
  aoAvancar: (feitos: number, total: number) => void,
): Promise<{ restaurados: number; falhas: string[] }> {
  await verificarSenhaAdmin(senhaAdmin)
  const opcoes = { senhaAdmin }
  const ultimos = marcados.filter((i) => i.colecao === 'configuracoes' && i.id === 'planilhaAtiva')
  const fila = ORDEM.flatMap((colecao) => marcados.filter((i) => i.colecao === colecao && !ultimos.includes(i)))
  const total = fila.length + ultimos.length + (contadorNovo ? 1 : 0)
  const falhas: string[] = []
  let restaurados = 0
  let feitos = 0
  const planilhasGravadas = new Set<string>()
  const gravar = async (item: ItemDoBackup) => {
    try {
      for (const extra of item.junto ?? []) await dbPut(extra.store, extra.dados, opcoes)
      await dbPut(item.colecao, item.dados, opcoes)
      if (item.colecao === 'planilhas') planilhasGravadas.add(item.id)
      restaurados++
    } catch (err) {
      falhas.push(`${item.colunas.join(' · ')}: ${err instanceof Error ? err.message : 'erro ao gravar'}`)
    }
    aoAvancar(++feitos, total)
  }
  for (const item of fila) await gravar(item)
  // a planilha em uso só aponta pra uma planilha que existe no sistema depois disso
  const existentes = new Set([...(await dbGetAll<Registro>('planilhas')).map((p) => p.id), ...planilhasGravadas])
  for (const item of ultimos) {
    const porPerfil = Object.fromEntries(Object.entries(item.dados.porPerfil as Record<string, string>).filter(([, id]) => existentes.has(id)))
    await gravar({ ...item, dados: { ...item.dados, porPerfil } })
  }
  if (contadorNovo) {
    try {
      await dbPut('configuracoes', { id: 'contadorCotacao', valor: contadorNovo }, opcoes)
    } catch (err) {
      falhas.push(`Contador das cotações: ${err instanceof Error ? err.message : 'erro ao gravar'}`)
    }
    aoAvancar(++feitos, total)
  }
  return { restaurados, falhas }
}
