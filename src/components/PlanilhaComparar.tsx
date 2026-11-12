import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  COR_CABECALHO,
  COR_CABECALHO_RESULTADO,
  VAZIAS,
  chavePreco,
  colunasDisponiveis,
  colunasNaOrdem,
  corDoFornecedor,
  filtrarLinhas,
  fornecedoresDaPlanilha,
  gravarArranjo,
  lerArranjo,
  montarLinhas,
  moverColuna,
  ordenarLinhas,
  textoDoValor,
  valorDaCelula,
  valoresDaColuna,
  type ArranjoDasColunas,
  type ColunaPlanilha,
  type FiltrosDaPlanilha,
  type LinhaPlanilha,
  type OrdemDaPlanilha,
} from '../compararPlanilha'
import { avisar } from '../dialogs'
import { formatarNumeroCurtoBR, parseNumeroFlexivel } from '../numeros'
import { useFecharComEsc } from '../teclaEsc'
import type { CotacaoFornecedorItem, QuoteItem } from '../types'
import { cotacaoAtende, formatCurrency, mesmoFornecedor, quantidadeAtendida } from '../utils'

// A aba Comparar no formato do CUSTO BASE MACRO (ver compararPlanilha.ts): uma linha por item, as
// colunas de cada fornecedor (preço e marca) e o mais barato em verde. Digitar o preço numa célula cria
// (ou muda) a cotação daquele fornecedor; apagar tira. O círculo da célula escolhe o fornecedor que
// preenche o item, mesmo mais caro. Clicar numa linha marca ela de amarelo, como a macro da planilha.

/** O que dá pra digitar do item direto na planilha (o resto vem das cotações dos fornecedores). */
export interface CamposDoItem {
  referencia?: string
  interno?: string
  descricao?: string
  qtd?: number
}

const CAMPO_DA_COLUNA: Record<string, keyof CamposDoItem> = { referencia: 'referencia', interno: 'interno', descricao: 'descricao', und: 'qtd' }

/** "5", "2,5" → número; vazio ou inválido → undefined. */
function quantidadeDigitada(texto: string): number | undefined {
  const n = parseNumeroFlexivel(texto)
  return n !== undefined && n > 0 ? n : undefined
}

/** Nome curto do item, pros rótulos. */
const nomeDoItem = (l: LinhaPlanilha) => l.item.product.referencia || l.item.product.interno || l.item.product.descricao || `item ${l.numero}`

/** A linha em branco do fim da planilha: digitar a referência (e o resto) e Enter acrescenta o item. */
function LinhaNovoItem({ colunas, travada, onAdicionar }: { colunas: ColunaPlanilha[]; travada: boolean; onAdicionar: (campos: CamposDoItem) => void }) {
  const [campos, setCampos] = useState<Record<string, string>>({})
  function adicionar() {
    const referencia = (campos.referencia ?? '').trim()
    const descricao = (campos.descricao ?? '').trim()
    if (!referencia && !descricao) return void avisar('Digite pelo menos a referência ou a descrição do item novo.')
    if ((campos.und ?? '').trim() && quantidadeDigitada(campos.und) === undefined) return void avisar('A UND (quantidade) precisa ser um número maior que zero.')
    onAdicionar({ referencia, interno: (campos.interno ?? '').trim(), descricao, qtd: quantidadeDigitada(campos.und ?? '') ?? 1 })
    setCampos({})
  }
  if (travada) return null
  return (
    <tr>
      <td className="planilha-celula sticky left-0 z-10 border-b border-r border-ink-200 px-0.5 text-center">
        <button
          type="button"
          onClick={adicionar}
          aria-label="Adicionar item"
          title="Adicionar o item digitado nesta linha"
          className="h-6 w-6 rounded-md text-base font-semibold leading-none text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        >
          +
        </button>
      </td>
      {colunas.map((c, i) => {
        const campo = CAMPO_DA_COLUNA[c.chave]
        return (
          <td key={c.chave} className={`planilha-celula border-b border-r border-ink-200 px-1 py-0.5 ${i === 0 ? 'sticky left-8 z-10' : ''}`}>
            {campo && (
              <input
                type="text"
                size={1}
                inputMode={campo === 'qtd' ? 'decimal' : undefined}
                aria-label={`${c.titulo} do item novo`}
                placeholder={campo === 'referencia' ? 'Item novo…' : campo === 'qtd' ? '1' : ''}
                className={`w-full rounded border border-dashed border-ink-300 bg-transparent px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-400 ${campo === 'qtd' ? 'text-right' : ''}`}
                value={campos[c.chave] ?? ''}
                onChange={(e) => setCampos((atual) => ({ ...atual, [c.chave]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') adicionar()
                }}
              />
            )}
          </td>
        )
      })}
    </tr>
  )
}

const nomeDaColuna = (c: ColunaPlanilha) => (c.grupo === 'marca' ? `MARCA ${c.fornecedor?.toUpperCase()}` : c.titulo)

/** Célula de preço de um fornecedor: mostra em reais; editando, o número. Enter grava e desce. */
function CelulaPreco({
  valor,
  rotulo,
  linha,
  chave,
  travada,
  onGravar,
  children,
}: {
  valor: number | undefined
  rotulo: string
  linha: number
  chave: string
  travada: boolean
  onGravar: (valor: number | undefined) => void
  children?: ReactNode
}) {
  const [texto, setTexto] = useState<string | null>(null)
  const inicial = valor !== undefined ? formatarNumeroCurtoBR(valor, 4) : ''
  function gravar() {
    if (texto === null) return
    const t = texto.trim()
    setTexto(null)
    if (t === inicial) return
    const n = t ? parseNumeroFlexivel(t) : undefined
    if (t && (n === undefined || n < 0)) return
    onGravar(n && n > 0 ? n : undefined)
  }
  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setTexto(null)
      e.currentTarget.blur()
    } else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const proxima = document.querySelector<HTMLInputElement>(`[data-celula="${CSS.escape(chave)}"][data-linha="${linha + (e.key === 'ArrowUp' ? -1 : 1)}"]`)
      if (proxima) proxima.focus()
      else e.currentTarget.blur()
    }
  }
  return (
    <span className="flex items-center gap-1">
      {children}
      <input
        type="text"
        inputMode="decimal"
        // size 1: sem isso o campo pede largura de 20 letras e a coluna estica
        size={1}
        data-celula={chave}
        data-linha={linha}
        aria-label={rotulo}
        disabled={travada}
        className="min-w-0 flex-1 bg-transparent px-0.5 py-1 text-right tabular-nums focus:bg-surface focus:outline-none focus:ring-1 focus:ring-brand-400"
        value={texto ?? (valor !== undefined ? formatCurrency(valor) : '')}
        onFocus={(e) => {
          setTexto(inicial)
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={gravar}
        onKeyDown={aoTeclar}
      />
    </span>
  )
}

/** Célula de texto (a marca do fornecedor): grava ao sair ou no Enter. */
function CelulaTexto({
  valor,
  rotulo,
  travada,
  alinharDireita = false,
  onGravar,
}: {
  valor: string
  rotulo: string
  travada: boolean
  alinharDireita?: boolean
  onGravar: (v: string) => void
}) {
  const [texto, setTexto] = useState<string | null>(null)
  return (
    <input
      type="text"
      size={1}
      aria-label={rotulo}
      disabled={travada}
      title={valor}
      className={`w-full bg-transparent px-0.5 py-1 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:cursor-default ${alinharDireita ? 'text-right tabular-nums' : ''}`}
      value={texto ?? valor}
      onFocus={() => setTexto(valor)}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto !== null && texto.trim() !== valor) onGravar(texto.trim())
        setTexto(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.preventDefault()
          setTexto(null)
          requestAnimationFrame(() => e.currentTarget?.blur())
        }
      }}
    />
  )
}

/** O menu de uma coluna (como o filtro do Excel): ordenar, mover, esconder e os valores que aparecem. */
function MenuDaColuna({
  coluna,
  ancora,
  valores,
  selecionados,
  ordem,
  podeEsquerda,
  podeDireita,
  onOrdenar,
  onMover,
  onEsconder,
  onFiltrar,
  onFechar,
}: {
  coluna: ColunaPlanilha
  ancora: DOMRect
  valores: string[]
  /** null = todos (sem filtro). */
  selecionados: string[] | null
  ordem: OrdemDaPlanilha | null
  podeEsquerda: boolean
  podeDireita: boolean
  onOrdenar: (desc: boolean | null) => void
  onMover: (lado: -1 | 1) => void
  onEsconder: () => void
  onFiltrar: (valores: string[] | null) => void
  onFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const caixa = useRef<HTMLDivElement>(null)
  useFecharComEsc(onFechar)
  useEffect(() => {
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) onFechar()
    }
    // no próximo clique (o que abriu o menu já passou)
    const t = window.setTimeout(() => window.addEventListener('pointerdown', fora), 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('pointerdown', fora)
    }
  }, [onFechar])

  const marcados = selecionados ?? valores
  const visiveis = valores.filter((v) => v.toLowerCase().includes(busca.trim().toLowerCase()))
  const numerica = coluna.tipo !== 'texto'
  const nome = nomeDaColuna(coluna)
  const alternar = (v: string) => {
    const novo = marcados.includes(v) ? marcados.filter((x) => x !== v) : [...marcados, v]
    onFiltrar(novo.length === valores.length ? null : novo)
  }
  const largura = 256
  const esquerda = Math.max(8, Math.min(ancora.left, window.innerWidth - largura - 8))
  const estilo: CSSProperties = { left: esquerda, top: Math.min(ancora.bottom + 4, window.innerHeight - 340), width: largura }
  const botao = 'w-full rounded-md px-2 py-1 text-left text-xs text-ink-700 hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent'

  return createPortal(
    <div ref={caixa} role="dialog" aria-label={`Coluna ${nome}`} style={estilo} className="fixed z-[60] rounded-xl border border-ink-200 bg-surface p-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]">
      <p className="truncate px-2 pb-1 text-xs font-semibold text-ink-900">{nome}</p>
      <div className="border-b border-ink-100 pb-1">
        <button type="button" className={`${botao} ${ordem && !ordem.desc ? 'font-semibold text-ink-900' : ''}`} onClick={() => onOrdenar(false)}>
          {numerica ? 'Ordenar do menor pro maior' : 'Ordenar de A a Z'}
        </button>
        <button type="button" className={`${botao} ${ordem?.desc ? 'font-semibold text-ink-900' : ''}`} onClick={() => onOrdenar(true)}>
          {numerica ? 'Ordenar do maior pro menor' : 'Ordenar de Z a A'}
        </button>
        {ordem && (
          <button type="button" className={botao} onClick={() => onOrdenar(null)}>
            Tirar a ordem (volta à dos itens)
          </button>
        )}
      </div>
      <div className="flex gap-1 border-b border-ink-100 py-1">
        <button type="button" className={botao} disabled={!podeEsquerda} onClick={() => onMover(-1)}>
          ◀ Mover pra esquerda
        </button>
        <button type="button" className={botao} disabled={!podeDireita} onClick={() => onMover(1)}>
          Mover pra direita ▶
        </button>
      </div>
      <button type="button" className={`${botao} my-1`} onClick={onEsconder}>
        Esconder esta coluna
      </button>
      <input
        type="search"
        className="field-input mb-1 py-1 text-xs"
        placeholder="Pesquisar"
        aria-label={`Pesquisar nos valores de ${nome}`}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoFocus
      />
      <ul className="max-h-48 overflow-y-auto rounded-md border border-ink-100 p-1 text-xs" aria-label={`Valores de ${nome}`}>
        {!busca.trim() && (
          <li>
            <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 font-medium text-ink-800 hover:bg-ink-50">
              <input type="checkbox" checked={selecionados === null} onChange={() => onFiltrar(selecionados === null ? [] : null)} />
              (Selecionar tudo)
            </label>
          </li>
        )}
        {visiveis.map((v) => (
          <li key={v}>
            <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-ink-700 hover:bg-ink-50">
              <input type="checkbox" checked={marcados.includes(v)} onChange={() => alternar(v)} />
              <span className={`truncate ${v === VAZIAS ? 'italic text-ink-400' : ''}`}>{v}</span>
            </label>
          </li>
        ))}
        {visiveis.length === 0 && <li className="px-1 py-1 text-ink-400">Nenhum valor com essa pesquisa.</li>}
      </ul>
      <div className="mt-2 flex justify-between gap-2">
        <button type="button" className="pill-tab border border-ink-200 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40" disabled={selecionados === null} onClick={() => onFiltrar(null)}>
          Limpar filtro
        </button>
        <button type="button" className="pill-tab border border-ink-900 bg-ink-900 py-1 text-xs text-surface hover:opacity-90" onClick={onFechar}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Mostrar/esconder colunas e voltar à ordem padrão. */
function MenuDasColunas({
  colunas,
  ocultas,
  onAlternar,
  onPadrao,
  onFechar,
}: {
  colunas: ColunaPlanilha[]
  ocultas: string[]
  onAlternar: (chave: string) => void
  onPadrao: () => void
  onFechar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  useFecharComEsc(onFechar)
  useEffect(() => {
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) onFechar()
    }
    const t = window.setTimeout(() => window.addEventListener('pointerdown', fora), 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('pointerdown', fora)
    }
  }, [onFechar])
  return (
    <div ref={caixa} role="dialog" aria-label="Colunas da planilha" className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-ink-200 bg-surface p-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]">
      <p className="px-1 pb-1 text-xs text-ink-500">Marque as que aparecem. Pra mudar de lugar, arraste o título da coluna (ou use o ▾ dela).</p>
      <ul className="max-h-72 overflow-y-auto text-xs">
        {colunas.map((c) => (
          <li key={c.chave}>
            <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-ink-700 hover:bg-ink-50">
              <input type="checkbox" checked={!ocultas.includes(c.chave)} onChange={() => onAlternar(c.chave)} />
              {nomeDaColuna(c)}
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onPadrao} className="mt-2 w-full pill-tab border border-ink-200 py-1 text-xs text-ink-600 hover:bg-ink-50">
        Voltar ao padrão (ordem e colunas)
      </button>
    </div>
  )
}

export function PlanilhaComparar({
  items,
  travada,
  busca,
  fornecedoresCadastrados,
  nomeDoArquivo,
  onDefinirPreco,
  onDefinirMarca,
  onEscolher,
  onEditarItem,
  onAdicionarItem,
  onRemoverItem,
}: {
  items: QuoteItem[]
  travada: boolean
  busca: string
  fornecedoresCadastrados: string[]
  /** Nome do Excel ("CUSTO BASE MACRO - COT-0070.xlsx"). */
  nomeDoArquivo: string
  onDefinirPreco: (item: QuoteItem, fornecedor: string, cotacao: CotacaoFornecedorItem | undefined, valor: number | undefined) => void
  onDefinirMarca: (item: QuoteItem, cotacao: CotacaoFornecedorItem, marca: string) => void
  onEscolher: (item: QuoteItem, cotacao: CotacaoFornecedorItem) => void
  /** Referência, interno, descrição ou UND mudados na célula. */
  onEditarItem: (item: QuoteItem, patch: CamposDoItem) => void
  /** Linha nova digitada no fim da planilha. */
  onAdicionarItem: (campos: CamposDoItem) => void
  onRemoverItem: (item: QuoteItem) => void
}) {
  const [arranjo, setArranjo] = useState<ArranjoDasColunas>(lerArranjo)
  const [filtros, setFiltros] = useState<FiltrosDaPlanilha>({})
  const [ordem, setOrdem] = useState<OrdemDaPlanilha | null>(null)
  // colunas de fornecedor novas, ainda sem preço (somem ao sair da aba se ninguém preencher)
  const [extras, setExtras] = useState<string[]>([])
  const [novoFornecedor, setNovoFornecedor] = useState('')
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ chave: string; ancora: DOMRect } | null>(null)
  const [menuColunas, setMenuColunas] = useState(false)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [soltarEm, setSoltarEm] = useState<{ chave: string; depois: boolean } | null>(null)

  const fornecedores = useMemo(() => fornecedoresDaPlanilha(items, extras), [items, extras])
  const disponiveis = useMemo(() => colunasDisponiveis(fornecedores), [fornecedores])
  const naOrdem = useMemo(() => colunasNaOrdem(disponiveis, arranjo.ordem), [disponiveis, arranjo.ordem])
  const visiveis = naOrdem.filter((c) => !arranjo.ocultas.includes(c.chave))
  const linhas = useMemo(() => montarLinhas(items, fornecedores), [items, fornecedores])
  const termo = busca.trim().toLowerCase()
  const daBusca = termo
    ? linhas.filter((l) => [l.item.product.interno, l.item.product.referencia, l.item.product.descricao, l.item.product.marca].some((v) => (v || '').toLowerCase().includes(termo)))
    : linhas
  const mostradas = ordenarLinhas(filtrarLinhas(daBusca, visiveis, filtros), visiveis, ordem)
  const filtrosAtivos = visiveis.filter((c) => filtros[c.chave]).length
  const corDe = (c: ColunaPlanilha) => (c.fornecedor ? corDoFornecedor(c.fornecedor, fornecedores.findIndex((f) => mesmoFornecedor(f, c.fornecedor!))) : '')

  function mudarArranjo(novo: ArranjoDasColunas) {
    setArranjo(novo)
    gravarArranjo(novo)
  }
  const ordemAtual = () => naOrdem.map((c) => c.chave)
  function mover(chave: string, alvo: string, depois: boolean) {
    mudarArranjo({ ...arranjo, ordem: moverColuna(ordemAtual(), chave, alvo, depois) })
  }
  function moverAoLado(chave: string, lado: -1 | 1) {
    const i = visiveis.findIndex((c) => c.chave === chave)
    const vizinha = visiveis[i + lado]
    if (vizinha) mover(chave, vizinha.chave, lado === 1)
  }
  function alternarOculta(chave: string) {
    const ocultas = arranjo.ocultas.includes(chave) ? arranjo.ocultas.filter((k) => k !== chave) : [...arranjo.ocultas, chave]
    // pelo menos uma à mostra
    if (ocultas.length >= naOrdem.length) return
    mudarArranjo({ ...arranjo, ocultas })
    if (!arranjo.ocultas.includes(chave)) setFiltros(({ [chave]: _, ...resto }) => resto)
  }
  function adicionarFornecedor() {
    const nome = novoFornecedor.trim()
    if (!nome) return
    if (!fornecedores.some((f) => mesmoFornecedor(f, nome))) setExtras((e) => [...e, nome])
    setNovoFornecedor('')
    // a coluna nova pode estar escondida de antes
    if (arranjo.ocultas.includes(chavePreco(nome))) mudarArranjo({ ...arranjo, ocultas: arranjo.ocultas.filter((k) => k !== chavePreco(nome)) })
  }

  const [baixando, setBaixando] = useState(false)
  async function baixarExcel() {
    setBaixando(true)
    try {
      // o ExcelJS só vem quando alguém baixa
      const { baixarCustoBaseMacro } = await import('../custoBaseMacroExcel')
      await baixarCustoBaseMacro({ colunas: visiveis, linhas: mostradas, corDe, nomeArquivo: nomeDoArquivo })
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Não consegui gerar o Excel.')
    } finally {
      setBaixando(false)
    }
  }

  const fecharMenu = useCallback(() => setMenu(null), [])
  const fecharMenuColunas = useCallback(() => setMenuColunas(false), [])
  const colunaDoMenu = menu ? visiveis.find((c) => c.chave === menu.chave) : undefined
  const indiceDoMenu = colunaDoMenu ? visiveis.indexOf(colunaDoMenu) : -1

  // totais (das linhas à mostra): o da planilha (TOTAL) e, por fornecedor, quanto dá tudo o que ele cotou
  const somaTotal = mostradas.reduce((s, l) => s + l.total, 0)
  function rodape(c: ColunaPlanilha): ReactNode {
    if (c.chave === 'total') return formatCurrency(somaTotal)
    if (c.chave === 'vlrMin') {
      const soma = mostradas.reduce((s, l) => s + (l.melhor ? l.melhor.valorUnitario * l.und : 0), 0)
      return <span title="Tudo pelo mais barato de cada item">{formatCurrency(soma)}</span>
    }
    if (c.grupo === 'preco' && c.fornecedor) {
      const dele = mostradas.filter((l) => l.porFornecedor.get(c.chave))
      if (dele.length === 0) return null
      const soma = dele.reduce((s, l) => s + l.porFornecedor.get(c.chave)!.cotacao.valorUnitario * l.und, 0)
      return (
        <span title={`Tudo o que ${c.fornecedor} cotou: ${dele.length} de ${mostradas.length} itens`}>
          {formatCurrency(soma)}
          <span className="block text-[10px] font-normal text-ink-500">
            {dele.length}/{mostradas.length} itens
          </span>
        </span>
      )
    }
    return null
  }

  function celula(l: LinhaPlanilha, c: ColunaPlanilha, indice: number): ReactNode {
    const p = l.item.product
    // referência repetida em outro item: o número do item junto, pra cada campo ter um nome só dele
    const rotuloItem = p.referencia ? (l.referenciaRepetida ? `${p.referencia} (item ${l.numero})` : p.referencia) : p.interno || `item ${l.numero}`
    if (c.grupo === 'preco' && c.fornecedor) {
      const dados = l.porFornecedor.get(c.chave)
      const cot = dados?.cotacao
      const ehMin = !!cot && cot === l.melhor
      const emUso = !!cot && cot === l.emUso
      const atende = cot ? quantidadeAtendida(cot, l.und) : 0
      const detalhes = cot
        ? [
            cot.marca && `Marca ${cot.marca}`,
            cot.prazoEntrega && `Prazo ${cot.prazoEntrega}`,
            cot.ncm && `NCM ${cot.ncm}`,
            cot.quantidadeDisponivel !== undefined && `Atende ${formatarNumeroCurtoBR(atende, 3)} de ${formatarNumeroCurtoBR(l.und, 3)}`,
            cot.valorTotal !== undefined && `Total cotado ${formatCurrency(cot.valorTotal)}`,
            cot.ufOrigem && `Sai de ${cot.ufOrigem}`,
            cot.observacao,
            ...(dados.outras.length > 0 ? [`Outras ofertas: ${dados.outras.map((o) => `${o.marca || 'sem marca'} ${formatCurrency(o.valorUnitario)}`).join('; ')}`] : []),
          ]
            .filter(Boolean)
            .join(' · ')
        : ''
      return (
        <div title={detalhes || undefined} className={ehMin ? 'font-bold' : ''}>
          <CelulaPreco
            valor={cot?.valorUnitario}
            rotulo={`Preço de ${c.fornecedor} — ${rotuloItem}`}
            linha={indice}
            chave={c.chave}
            travada={travada}
            onGravar={(valor) => onDefinirPreco(l.item, cot?.fornecedor || c.fornecedor!, cot, valor)}
          >
            {cot && cotacaoAtende(cot) && !travada ? (
              <button
                type="button"
                onClick={() => onEscolher(l.item, cot)}
                aria-pressed={emUso}
                aria-label={emUso ? `${c.fornecedor} preenche o item ${rotuloItem}` : `Usar ${c.fornecedor} no item ${rotuloItem}`}
                title={emUso ? 'É o que preenche o item' : 'Usar este fornecedor no item (mesmo mais caro)'}
                className={`h-3 w-3 shrink-0 rounded-full border ${emUso ? 'border-emerald-600 bg-emerald-600' : 'border-ink-400 hover:border-emerald-600'}`}
              />
            ) : (
              <span aria-hidden className="h-3 w-3 shrink-0" />
            )}
          </CelulaPreco>
          {cot && (cot.quantidadeDisponivel === 0 || atende < l.und || dados.outras.length > 0) && (
            <span className="block text-right text-[10px] font-medium leading-tight text-amber-700 dark:text-amber-300">
              {cot.quantidadeDisponivel === 0 ? 'sem qtd' : atende < l.und ? `atende ${formatarNumeroCurtoBR(atende, 3)}` : ''}
              {dados.outras.length > 0 && ` +${dados.outras.length} oferta${dados.outras.length > 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      )
    }
    if (c.grupo === 'marca' && c.fornecedor) {
      const cot = l.porFornecedor.get(chavePreco(c.fornecedor))?.cotacao
      if (!cot) return <span className="block px-0.5 text-ink-300">—</span>
      return <CelulaTexto valor={cot.marca} rotulo={`Marca de ${c.fornecedor} — ${rotuloItem}`} travada={travada} onGravar={(marca) => onDefinirMarca(l.item, cot, marca)} />
    }
    const valor = valorDaCelula(l, c)
    const texto = valor === undefined ? '' : textoDoValor(valor, c.tipo)
    // referência, interno, descrição e UND: digitáveis direto na célula, como no Excel
    const campo = CAMPO_DA_COLUNA[c.chave]
    if (campo && !travada) {
      const atual = campo === 'qtd' ? formatarNumeroCurtoBR(l.und, 3) : String(p[campo] ?? '')
      return (
        <CelulaTexto
          valor={atual}
          rotulo={`${c.titulo} — item ${l.numero}`}
          travada={travada}
          alinharDireita={campo === 'qtd'}
          onGravar={(novo) => {
            if (campo !== 'qtd') return onEditarItem(l.item, { [campo]: novo })
            const qtd = quantidadeDigitada(novo)
            if (qtd === undefined) return void avisar('A UND (quantidade) precisa ser um número maior que zero.')
            onEditarItem(l.item, { qtd })
          }}
        />
      )
    }
    if (c.chave === 'vlrUnit') {
      const outro = l.emUso && l.melhor && l.emUso !== l.melhor
      return (
        <span className="block text-right tabular-nums">
          {texto}
          {outro && <span className="block text-[10px] font-medium leading-tight text-emerald-700 dark:text-emerald-300">✓ {l.emUso!.fornecedor}</span>}
        </span>
      )
    }
    if (c.chave === 'descricao') return <span className="block max-w-[12rem] truncate" title={texto}>{texto}</span>
    if (c.tipo !== 'texto') return <span className={`block text-right tabular-nums ${c.chave === 'vlrMin' ? 'font-semibold' : ''}`}>{texto}</span>
    return <span className="block truncate" title={texto}>{texto}</span>
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button type="button" onClick={() => setMenuColunas((v) => !v)} aria-expanded={menuColunas} className="pill-tab border border-ink-200 py-1 text-xs text-ink-700 hover:bg-ink-50">
            Colunas ▾{arranjo.ocultas.length > 0 && ` (${arranjo.ocultas.length} escondida${arranjo.ocultas.length > 1 ? 's' : ''})`}
          </button>
          {menuColunas && (
            <MenuDasColunas
              colunas={naOrdem}
              ocultas={arranjo.ocultas}
              onAlternar={alternarOculta}
              onPadrao={() => {
                mudarArranjo({ ordem: [], ocultas: [] })
                setMenuColunas(false)
              }}
              onFechar={fecharMenuColunas}
            />
          )}
        </div>
        {!travada && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              adicionarFornecedor()
            }}
          >
            <input
              className="field-input w-44 py-1 text-xs"
              list="planilha-fornecedores"
              placeholder="Fornecedor novo"
              aria-label="Fornecedor da coluna nova"
              value={novoFornecedor}
              onChange={(e) => setNovoFornecedor(e.target.value)}
            />
            <datalist id="planilha-fornecedores">
              {fornecedoresCadastrados.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <button type="submit" className="pill-tab border border-ink-200 py-1 text-xs text-ink-700 hover:bg-ink-50">
              + Coluna
            </button>
          </form>
        )}
        {(filtrosAtivos > 0 || ordem) && (
          <button
            type="button"
            onClick={() => {
              setFiltros({})
              setOrdem(null)
            }}
            className="pill-tab border border-ink-200 py-1 text-xs text-ink-600 hover:bg-ink-50"
          >
            Limpar filtros{filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ''}
            {ordem ? ' e ordem' : ''}
          </button>
        )}
        <span className="text-xs text-ink-500">
          {mostradas.length === linhas.length ? `${linhas.length} itens` : `Mostrando ${mostradas.length} de ${linhas.length} itens`} · {fornecedores.length} fornecedor
          {fornecedores.length === 1 ? '' : 'es'}
        </span>
        <button
          type="button"
          onClick={() => void baixarExcel()}
          disabled={baixando || mostradas.length === 0}
          title="As colunas e as linhas como estão na tela, com as fórmulas e as cores do Custo Base Macro"
          className="ml-auto pill-tab border border-ink-200 py-1 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-40"
        >
          {baixando ? 'Gerando…' : 'Baixar em Excel'}
        </button>
      </div>

      <div className="planilha-comparar max-h-[calc(100vh-15rem)] min-h-[16rem] overflow-auto rounded-lg border border-ink-200" role="region" aria-label="Planilha de comparação" tabIndex={0}>
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th
                style={{ '--cor-celula': COR_CABECALHO, minWidth: '2rem', width: '2rem' } as CSSProperties}
                className="planilha-cabecalho sticky left-0 top-0 z-30 border-b border-r border-ink-300 px-1 py-1 text-center align-bottom font-bold"
                title="Número do item, na ordem da cotação — passe o mouse na linha pra tirar o item"
              >
                #
              </th>
              {visiveis.map((c, i) => {
                const filtrada = !!filtros[c.chave]
                const marca = c.grupo === 'marca'
                const alvo = soltarEm?.chave === c.chave && arrastando !== c.chave
                return (
                  <th
                    key={c.chave}
                    draggable
                    data-coluna={c.chave}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', c.chave)
                      e.dataTransfer.effectAllowed = 'move'
                      setArrastando(c.chave)
                    }}
                    onDragOver={(e) => {
                      if (!arrastando) return
                      e.preventDefault()
                      const r = e.currentTarget.getBoundingClientRect()
                      setSoltarEm({ chave: c.chave, depois: e.clientX > r.left + r.width / 2 })
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const origem = arrastando || e.dataTransfer.getData('text/plain')
                      if (origem && soltarEm) mover(origem, soltarEm.chave, soltarEm.depois)
                      setArrastando(null)
                      setSoltarEm(null)
                    }}
                    onDragEnd={() => {
                      setArrastando(null)
                      setSoltarEm(null)
                    }}
                    title="Arraste pra mudar a coluna de lugar"
                    style={{ '--cor-celula': c.grupo === 'resultado' ? COR_CABECALHO_RESULTADO : COR_CABECALHO, minWidth: `${c.largura}rem`, width: `${c.largura}rem` } as CSSProperties}
                    className={`planilha-cabecalho sticky top-0 z-20 cursor-grab select-none border-b border-r border-ink-300 px-1.5 py-1 text-left align-bottom font-bold ${
                      i === 0 ? 'left-8 z-30' : ''
                    } ${arrastando === c.chave ? 'opacity-50' : ''} ${alvo ? (soltarEm!.depois ? 'planilha-soltar-depois' : 'planilha-soltar-antes') : ''}`}
                  >
                    <span className="flex items-end gap-1">
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate">{c.titulo}</span>
                        {marca && <span className="block truncate text-[9px] font-semibold opacity-75">{c.fornecedor}</span>}
                      </span>
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`Filtrar e ordenar: ${nomeDaColuna(c)}${filtrada ? ' (filtrada)' : ''}${ordem?.chave === c.chave ? ` (em ordem ${ordem.desc ? 'decrescente' : 'crescente'})` : ''}`}
                        onClick={(e) => setMenu(menu?.chave === c.chave ? null : { chave: c.chave, ancora: e.currentTarget.getBoundingClientRect() })}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] leading-none ${
                          filtrada || ordem?.chave === c.chave ? 'border-ink-900 bg-ink-900 text-white' : 'border-black/30 bg-white/70 text-black'
                        }`}
                      >
                        {filtrada ? '⧩' : ordem?.chave === c.chave ? (ordem.desc ? '↓' : '↑') : '▾'}
                      </button>
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {mostradas.length === 0 && (
              <tr>
                <td colSpan={visiveis.length + 1} className="px-3 py-6 text-center text-ink-400">
                  Nenhum item com esses filtros.
                </td>
              </tr>
            )}
            {mostradas.map((l, indice) => {
              const sel = selecionada === l.item.id
              return (
                <tr
                  key={l.item.id}
                  aria-label={`Item ${l.numero}: ${l.item.product.referencia || l.item.product.interno || l.item.product.descricao}`}
                  aria-selected={sel}
                  onPointerDown={() => setSelecionada(l.item.id)}
                  onFocusCapture={() => setSelecionada(l.item.id)}
                  className={`group/num ${sel ? 'planilha-linha-selecionada' : indice % 2 === 1 ? 'planilha-listra' : ''}`}
                >
                  {/* o número do item, como a numeração de linhas do Excel; com o mouse na linha, o × tira o item */}
                  <td className="planilha-celula sticky left-0 z-10 border-b border-r border-ink-200 px-0.5 text-center align-middle text-[10px] text-ink-500">
                    <span className={travada ? '' : 'group-hover/num:hidden group-focus-within/num:hidden'}>{l.numero}</span>
                    {!travada && (
                      <button
                        type="button"
                        onClick={() => onRemoverItem(l.item)}
                        aria-label={`Tirar o item ${l.numero} (${nomeDoItem(l)}) da cotação`}
                        title="Tirar este item da cotação"
                        className="hidden h-5 w-5 rounded text-sm leading-none text-rose-600 hover:bg-rose-50 focus:inline-block group-hover/num:inline-block group-focus-within/num:inline-block"
                      >
                        ×
                      </button>
                    )}
                  </td>
                  {visiveis.map((c, i) => {
                    const cor = c.grupo === 'preco' ? corDe(c) : ''
                    const repetida = c.chave === 'referencia' && l.referenciaRepetida
                    return (
                      <td
                        key={c.chave}
                        style={cor ? ({ '--cor-celula': cor } as CSSProperties) : undefined}
                        className={`border-b border-r border-ink-200 px-1 py-0.5 align-middle text-ink-900 ${cor ? 'planilha-cor' : 'planilha-celula'} ${
                          repetida ? 'planilha-repetida' : ''
                        } ${i === 0 ? 'sticky left-8 z-10' : ''}`}
                        title={repetida ? 'Referência repetida em outro item' : undefined}
                      >
                        {celula(l, c, indice)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            <LinhaNovoItem colunas={visiveis} travada={travada} onAdicionar={onAdicionarItem} />
          </tbody>
          <tfoot>
            <tr>
              <td className="planilha-rodape sticky bottom-0 left-0 z-20 border-r border-t-2 border-ink-300" />
              {visiveis.map((c, i) => (
                <td key={c.chave} className={`planilha-rodape sticky bottom-0 z-10 border-r border-t-2 border-ink-300 px-1.5 py-1 text-right font-bold tabular-nums text-ink-900 ${i === 0 ? 'left-8 z-20 text-left' : ''}`}>
                  {i === 0 ? (mostradas.length === linhas.length ? 'TOTAL' : 'TOTAL (filtrado)') : rodape(c)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {menu && colunaDoMenu && (
        <MenuDaColuna
          key={menu.chave}
          coluna={colunaDoMenu}
          ancora={menu.ancora}
          valores={valoresDaColuna(daBusca, colunaDoMenu)}
          selecionados={filtros[colunaDoMenu.chave] ?? null}
          ordem={ordem?.chave === colunaDoMenu.chave ? ordem : null}
          podeEsquerda={indiceDoMenu > 0}
          podeDireita={indiceDoMenu < visiveis.length - 1}
          onOrdenar={(desc) => setOrdem(desc === null ? null : { chave: colunaDoMenu.chave, desc })}
          onMover={(lado) => moverAoLado(colunaDoMenu.chave, lado)}
          onEsconder={() => {
            alternarOculta(colunaDoMenu.chave)
            setMenu(null)
          }}
          onFiltrar={(valores) =>
            setFiltros((f) => {
              const { [colunaDoMenu.chave]: _, ...resto } = f
              return valores === null ? resto : { ...resto, [colunaDoMenu.chave]: valores }
            })
          }
          onFechar={fecharMenu}
        />
      )}
    </div>
  )
}
