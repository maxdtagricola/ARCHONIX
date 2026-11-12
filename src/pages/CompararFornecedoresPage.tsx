import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/Basics'
import { ImportarCotacaoFornecedorModal, type ItemImportadoConfirmado } from '../components/ImportarCotacaoFornecedorModal'
import { listFornecedores } from '../db/fornecedoresRepo'
import {
  cotacaoAtende,
  formatCurrency,
  makeId,
  melhorCotacaoFornecedor,
  mesmoFornecedor,
  planoDeAtendimento,
  quantidadeAtendida,
  selecionarTudoAoFocar,
} from '../utils'
import { avisar, confirmar } from '../dialogs'
import { formatarNumeroCurtoBR, parseNumeroFlexivel } from '../numeros'
import { normalizarNcm } from '../importacao/ncm'
import { useEstadoPersistente } from '../estadoPersistente'
import { PlanilhaComparar } from '../components/PlanilhaComparar'
import type { CotacaoFornecedorItem, Fornecedor, ProductInput, QuoteItem, QuoteStatus } from '../types'

const ID_LISTA_FORNECEDORES = 'comparar-fornecedores-sugestoes'
const TOTAL_COLUNAS = 10

/** Campo de NCM da cotação de um fornecedor: aceita com ou sem pontos e arruma (0000.00.00) ao sair;
 * inválido fica marcado em vermelho e não é usado no item. */
function CampoNcm({
  valor,
  onChange,
  className,
  disabled,
  placeholder = 'NCM',
  rotulo,
}: {
  valor: string
  onChange: (valor: string) => void
  className: string
  disabled?: boolean
  placeholder?: string
  /** Nome do campo pra leitor de tela (a tabela não tem <label> por célula). */
  rotulo: string
}) {
  const invalido = !!valor.trim() && !normalizarNcm(valor)
  return (
    <input
      className={`${className} font-mono ${invalido ? 'text-rose-600 ring-1 ring-rose-400' : ''}`}
      inputMode="numeric"
      placeholder={placeholder}
      value={valor}
      disabled={disabled}
      aria-label={rotulo}
      aria-invalid={invalido}
      title={invalido ? 'NCM precisa ter 8 dígitos (ex.: 8433.90.90)' : 'NCM informado por esse fornecedor'}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const ncm = normalizarNcm(valor)
        if (ncm && ncm !== valor) onChange(ncm)
      }}
    />
  )
}
const cellCls = 'px-1 py-1 border-t border-ink-100'
const inputCls =
  'w-full bg-transparent border-0 rounded px-1.5 py-1.5 text-ink-800 focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:opacity-60'

/** "" -> undefined; texto numérico -> número (aceita vírgula e milhar: "1.234,56"). */
function numeroOuVazio(texto: string): number | undefined {
  if (!texto.trim()) return undefined
  return parseNumeroFlexivel(texto)
}

/** Quantidade com vírgula e sem casas sobrando ("2", "1,5"). */
function qtdTexto(valor: number): string {
  return formatarNumeroCurtoBR(valor, 3)
}

/** Campo "Qtd atende" de uma cotação: vazio = o fornecedor atende a quantidade toda; menor que a do
 * item fica âmbar, com quanto falta; maior, azul, com quanto sobra. */
function CampoQuantidade({
  valor,
  qtdItem,
  onChange,
  className,
  disabled,
  rotulo,
}: {
  valor: number | undefined
  qtdItem: number
  onChange: (valor: number | undefined) => void
  className: string
  disabled?: boolean
  rotulo: string
}) {
  const faltam = valor !== undefined && valor < qtdItem ? qtdItem - valor : 0
  const aMais = valor !== undefined && valor > qtdItem ? valor - qtdItem : 0
  return (
    <>
      <input
        type="number"
        min={0}
        step="any"
        aria-label={rotulo}
        className={`${className} text-right tabular-nums ${
          faltam > 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : aMais > 0 ? 'text-sky-700 dark:text-sky-300' : ''
        }`}
        placeholder={qtdTexto(qtdItem)}
        title="Quanto o fornecedor tem desse item — vazio: atende a quantidade toda"
        value={valor ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim() === '' ? undefined : Math.max(0, Number(e.target.value) || 0))}
        onFocus={selecionarTudoAoFocar}
      />
      {faltam > 0 && <p className="px-1.5 text-right text-[10px] font-medium text-amber-700">parcial · faltam {qtdTexto(faltam)}</p>}
      {aMais > 0 && <p className="px-1.5 text-right text-[10px] font-medium text-sky-700">+{qtdTexto(aMais)} a mais</p>}
    </>
  )
}

/** Linha de uma cotação de fornecedor, editável direto na célula — igual às linhas de "Itens da
 * cotação". O valor total é opcional: vazio, mostra (em cinza) o unitário × a quantidade que o
 * fornecedor atende (a do item, se ele atende tudo). */
function LinhaCotacao({
  cotacao,
  qtdItem,
  menorValor,
  emUso,
  automatica,
  travadaPorOutro,
  rotuloItem,
  onChange,
  onEscolher,
  onRemover,
}: {
  cotacao: CotacaoFornecedorItem
  qtdItem: number
  menorValor: number | undefined
  /** É a cotação que preenche o item — a mais barata ou a escolhida à mão. Ela leva o destaque. */
  emUso: boolean
  /** É a que o item usaria sem escolha nenhuma. Empatada no preço com ela, outra ainda pode ser escolhida. */
  automatica: boolean
  travadaPorOutro: boolean
  /** Qual item é (referência), pros nomes dos campos no leitor de tela. */
  rotuloItem: string
  onChange: (patch: Partial<CotacaoFornecedorItem>) => void
  onEscolher: () => void
  onRemover: () => void
}) {
  const semQuantidade = cotacao.quantidadeDisponivel === 0
  const maisBarata = !semQuantidade && menorValor !== undefined && cotacao.valorUnitario === menorValor
  const diferenca = menorValor !== undefined ? cotacao.valorUnitario - menorValor : 0
  const diferencaPct = menorValor ? (diferenca / menorValor) * 100 : 0
  const de = `cotação de ${cotacao.fornecedor || 'fornecedor'}, item ${rotuloItem}`
  return (
    <tr className={emUso ? 'bg-emerald-500/10' : 'hover:bg-ink-50'}>
      <td className={`${cellCls} so-tela-larga text-center`}>
        {maisBarata && <span className="text-emerald-600" title="Mais barato desse item">★</span>}
      </td>
      <td className={`${cellCls} celula-larga`} data-rotulo="Fornecedor">
        <input
          className={`${inputCls} ${emUso ? 'font-semibold text-emerald-700 dark:text-emerald-300' : ''}`}
          list={ID_LISTA_FORNECEDORES}
          value={cotacao.fornecedor}
          disabled={travadaPorOutro}
          aria-label={`Fornecedor — item ${rotuloItem}`}
          onChange={(e) => onChange({ fornecedor: e.target.value })}
        />
        {(cotacao.ufOrigem || cotacao.observacao) && (
          <p className="truncate px-1.5 text-[10px] text-ink-400" title={cotacao.observacao}>
            {cotacao.ufOrigem && <span className="font-semibold text-ink-600">sai de {cotacao.ufOrigem}</span>}
            {cotacao.ufOrigem && cotacao.observacao && ' · '}
            {cotacao.observacao}
          </p>
        )}
      </td>
      <td className={cellCls} data-rotulo="Marca">
        <input
          className={inputCls}
          value={cotacao.marca}
          disabled={travadaPorOutro}
          aria-label={`Marca — ${de}`}
          onChange={(e) => onChange({ marca: e.target.value })}
        />
      </td>
      <td className={cellCls} data-rotulo="Prazo">
        <input
          className={inputCls}
          placeholder="—"
          value={cotacao.prazoEntrega ?? ''}
          disabled={travadaPorOutro}
          aria-label={`Prazo — ${de}`}
          onChange={(e) => onChange({ prazoEntrega: e.target.value })}
        />
      </td>
      <td className={cellCls} data-rotulo="NCM">
        <CampoNcm
          className={`${inputCls} ${emUso ? 'font-semibold text-emerald-700 dark:text-emerald-300' : ''}`}
          valor={cotacao.ncm ?? ''}
          placeholder="—"
          disabled={travadaPorOutro}
          rotulo={`NCM — ${de}`}
          onChange={(ncm) => onChange({ ncm })}
        />
      </td>
      <td className={cellCls} data-rotulo="Qtd atende">
        <CampoQuantidade
          className={inputCls}
          valor={cotacao.quantidadeDisponivel}
          qtdItem={qtdItem}
          disabled={travadaPorOutro}
          rotulo={`Quantidade que atende — ${de}`}
          onChange={(quantidadeDisponivel) => onChange({ quantidadeDisponivel })}
        />
      </td>
      <td className={cellCls} data-rotulo="Valor unt.">
        <input
          type="number"
          min={0}
          step={0.01}
          className={`${inputCls} text-right tabular-nums ${emUso ? 'font-semibold text-emerald-700 dark:text-emerald-300' : ''}`}
          value={cotacao.valorUnitario}
          disabled={travadaPorOutro}
          aria-label={`Valor unitário — ${de}`}
          onChange={(e) => onChange({ valorUnitario: Number(e.target.value) || 0 })}
          onFocus={selecionarTudoAoFocar}
        />
      </td>
      <td className={cellCls} data-rotulo="Valor total">
        <input
          type="number"
          min={0}
          step={0.01}
          aria-label={`Valor total — ${de}`}
          className={`${inputCls} text-right tabular-nums`}
          placeholder={formatCurrency(cotacao.valorUnitario * quantidadeAtendida(cotacao, qtdItem))}
          title={
            cotacao.valorTotal === undefined
              ? 'Vazio: vale o valor unitário × a quantidade que o fornecedor atende'
              : 'Valor total informado pelo fornecedor'
          }
          value={cotacao.valorTotal ?? ''}
          disabled={travadaPorOutro}
          // campo type="number": o navegador já entrega com ponto decimal — Number() direto
          onChange={(e) => onChange({ valorTotal: e.target.value.trim() ? Number(e.target.value) || undefined : undefined })}
          onFocus={selecionarTudoAoFocar}
        />
      </td>
      <td className={`${cellCls} text-right text-xs tabular-nums pr-2 max-md:self-center max-md:text-left`}>
        {semQuantidade ? (
          <span className="text-ink-400" title="O fornecedor devolveu quantidade 0 — não dá pra escolher nem entra na conta do mais barato">
            sem quantidade
          </span>
        ) : (
          <span className="flex flex-col items-end gap-1 max-md:items-start">
            {emUso && maisBarata ? (
              <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">Melhor preço</span>
            ) : emUso ? (
              <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">✓ Escolhido</span>
            ) : maisBarata ? (
              <span className="inline-flex rounded-full border border-emerald-400 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                ★ Mais barato
              </span>
            ) : null}
            {!maisBarata && menorValor !== undefined && (
              <span className="text-rose-600">
                +{formatCurrency(diferenca)} <span className="text-rose-400">(+{diferencaPct.toFixed(1).replace('.', ',')}%)</span>
              </span>
            )}
            {!emUso && !travadaPorOutro && cotacao.valorUnitario > 0 && (
              <button
                type="button"
                onClick={onEscolher}
                aria-label={`${automatica ? 'Voltar pro mais barato' : 'Escolher'} — ${de}`}
                title="Esta cotação passa a preencher o fornecedor, a marca, o valor, o prazo e o NCM do item"
                className="rounded-lg border border-ink-200 bg-surface px-2 py-0.5 font-medium text-ink-700 hover:bg-ink-50"
              >
                {automatica ? 'Voltar pro mais barato' : 'Escolher'}
              </button>
            )}
          </span>
        )}
      </td>
      <td className={`${cellCls} text-center max-md:text-right`}>
        <button
          type="button"
          onClick={onRemover}
          disabled={travadaPorOutro}
          aria-label={`Remover ${de}`}
          className="h-6 w-6 rounded-full text-xs leading-none text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition disabled:opacity-60 max-md:h-8 max-md:w-auto max-md:px-3 max-md:border max-md:border-ink-200"
        >
          <span aria-hidden>×</span>
          <span className="md:hidden"> Tirar</span>
        </button>
      </td>
    </tr>
  )
}

/** Linha "em branco" no fim de cada item, pra digitar uma cotação nova direto na tabela. */
function LinhaNovaCotacao({
  qtdItem,
  rotuloItem,
  onAdicionar,
}: {
  qtdItem: number
  rotuloItem: string
  onAdicionar: (c: Omit<CotacaoFornecedorItem, 'id'>) => void
}) {
  const [fornecedor, setFornecedor] = useState('')
  const [marca, setMarca] = useState('')
  const [prazo, setPrazo] = useState('')
  const [ncm, setNcm] = useState('')
  const [quantidade, setQuantidade] = useState<number | undefined>(undefined)
  const [valorUnitario, setValorUnitario] = useState('')
  const [valorTotal, setValorTotal] = useState('')

  function handleAdicionar() {
    const unitario = numeroOuVazio(valorUnitario)
    if (!fornecedor.trim()) {
      void avisar('Informe o fornecedor.')
      return
    }
    if (!unitario || unitario <= 0) {
      void avisar('Informe o valor unitário cotado.')
      return
    }
    const ncmNormalizado = normalizarNcm(ncm)
    if (ncm.trim() && !ncmNormalizado) {
      void avisar('O NCM precisa ter 8 dígitos (ex.: 8433.90.90) — corrija ou deixe em branco.')
      return
    }
    const total = numeroOuVazio(valorTotal)
    onAdicionar({
      fornecedor: fornecedor.trim(),
      marca: marca.trim(),
      valorUnitario: unitario,
      ...(total !== undefined && total > 0 ? { valorTotal: total } : {}),
      ...(prazo.trim() ? { prazoEntrega: prazo.trim() } : {}),
      ...(ncmNormalizado ? { ncm: ncmNormalizado } : {}),
      ...(quantidade !== undefined ? { quantidadeDisponivel: quantidade } : {}),
    })
    setFornecedor('')
    setMarca('')
    setPrazo('')
    setNcm('')
    setQuantidade(undefined)
    setValorUnitario('')
    setValorTotal('')
  }

  function aoTeclar(e: KeyboardEvent) {
    if (e.key === 'Enter') handleAdicionar()
  }

  const unitarioDigitado = numeroOuVazio(valorUnitario) ?? 0
  const novoCls = 'w-full rounded border border-dashed border-ink-200 bg-surface px-1.5 py-1 text-ink-800 focus:outline-none focus:ring-1 focus:ring-brand-400'
  const nova = `nova cotação do item ${rotuloItem}`
  return (
    <tr className="bg-ink-50/40">
      <td className={`${cellCls} so-tela-larga text-center text-ink-300`}>+</td>
      <td className={`${cellCls} celula-larga`} data-rotulo="Nova cotação">
        <input
          className={novoCls}
          list={ID_LISTA_FORNECEDORES}
          placeholder="Novo fornecedor"
          aria-label={`Fornecedor — ${nova}`}
          value={fornecedor}
          onChange={(e) => setFornecedor(e.target.value)}
          onKeyDown={aoTeclar}
        />
      </td>
      <td className={cellCls}>
        <input className={novoCls} placeholder="Marca" aria-label={`Marca — ${nova}`} value={marca} onChange={(e) => setMarca(e.target.value)} onKeyDown={aoTeclar} />
      </td>
      <td className={cellCls}>
        <input className={novoCls} placeholder="Prazo" aria-label={`Prazo — ${nova}`} value={prazo} onChange={(e) => setPrazo(e.target.value)} onKeyDown={aoTeclar} />
      </td>
      <td className={cellCls} onKeyDown={aoTeclar}>
        <CampoNcm className={novoCls} valor={ncm} onChange={setNcm} rotulo={`NCM — ${nova}`} />
      </td>
      <td className={cellCls} onKeyDown={aoTeclar}>
        <CampoQuantidade className={novoCls} valor={quantidade} qtdItem={qtdItem} onChange={setQuantidade} rotulo={`Quantidade que atende — ${nova}`} />
      </td>
      <td className={cellCls}>
        <input
          className={`${novoCls} text-right tabular-nums`}
          inputMode="decimal"
          placeholder="R$ unit."
          aria-label={`Valor unitário — ${nova}`}
          value={valorUnitario}
          onChange={(e) => setValorUnitario(e.target.value)}
          onKeyDown={aoTeclar}
        />
      </td>
      <td className={cellCls}>
        <input
          className={`${novoCls} text-right tabular-nums`}
          inputMode="decimal"
          placeholder={unitarioDigitado > 0 ? formatCurrency(unitarioDigitado * quantidadeAtendida({ quantidadeDisponivel: quantidade }, qtdItem)) : 'R$ total'}
          aria-label={`Valor total — ${nova}`}
          value={valorTotal}
          onChange={(e) => setValorTotal(e.target.value)}
          onKeyDown={aoTeclar}
        />
      </td>
      <td colSpan={2} className={`${cellCls} celula-larga text-right pr-2`}>
        <button
          type="button"
          onClick={handleAdicionar}
          className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          Adicionar
        </button>
      </td>
    </tr>
  )
}

/**
 * Compara cotações de fornecedores por item da cotação — direto em cima dos itens reais (ver
 * QuoteItem). Organizado como uma planilha única, no mesmo jeitão de "Itens da cotação": cada item
 * vira um bloco com cabeçalho próprio, e as cotações dele ficam embaixo, editáveis direto na célula.
 * A cada cotação adicionada/editada/removida, a mais barata já atualiza fornecedor/marca/valor
 * unitário (e prazo, se informado) do item automaticamente (via onPatchItem, o mesmo callback usado
 * em "Itens da cotação"), então não existe um passo separado de "aplicar" ou "salvar" aqui. Às vezes
 * compensa pagar mais: "Escolher" fixa outra cotação no lugar da mais barata (product.cotacaoEscolhidaId),
 * que leva o destaque, e a mais barata continua indicada.
 */
export function CompararFornecedoresPage({
  currentAdmin,
  isEditing,
  activeStatus,
  activeResponsavel,
  items,
  codigoCotacao,
  cliente,
  onPatchItem,
  onGoToCotacoes,
  onGoToPrecificacao,
}: {
  currentAdmin: string
  isEditing: boolean
  activeStatus: QuoteStatus
  activeResponsavel: string
  items: QuoteItem[]
  /** Pro nome do Excel. */
  codigoCotacao?: string
  cliente?: string
  onPatchItem: (id: string, patch: Partial<ProductInput>) => void
  onGoToCotacoes: () => void
  onGoToPrecificacao: () => void
}) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [importAberto, setImportAberto] = useState(false)
  // planilha (como o CUSTO BASE MACRO) ou detalhado (cada cotação com prazo, NCM, qtd que atende…) — por aparelho
  const [visao, setVisao] = useEstadoPersistente<'planilha' | 'detalhado'>('comparar:visao', 'planilha')
  const [busca, setBusca] = useState('')
  const [filtroFornecedor, setFiltroFornecedor] = useState('')
  const [soSemCotacao, setSoSemCotacao] = useState(false)
  // "Voltar para Precificação" acompanha a tela: quando o botão do topo sai de vista, aparece um
  // igual flutuando no canto de baixo
  const voltarRef = useRef<HTMLDivElement>(null)
  const [voltarNoTopoVisivel, setVoltarNoTopoVisivel] = useState(true)

  useEffect(() => {
    const alvo = voltarRef.current
    if (!alvo) return
    const observador = new IntersectionObserver(([entrada]) => setVoltarNoTopoVisivel(entrada.isIntersecting))
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [isEditing])

  useEffect(() => {
    listFornecedores()
      .then(setFornecedores)
      .catch(() => {
        // sugestão é só um extra — se o servidor estiver fora, o campo continua livre normalmente
      })
  }, [])

  const travadaPorOutro = activeStatus !== 'PENDENTE' && !!activeResponsavel && activeResponsavel !== currentAdmin
  const fornecedorSuggestions = fornecedores.map((f) => ({ value: f.id, label: f.nome }))

  // fornecedores que já aparecem em alguma cotação dessa tela — opções do filtro
  const fornecedoresCotados = useMemo(() => {
    const nomes = new Map<string, string>()
    for (const item of items) {
      for (const c of item.product.cotacoesFornecedores ?? []) {
        const nome = c.fornecedor.trim()
        if (nome && !nomes.has(nome.toUpperCase())) nomes.set(nome.toUpperCase(), nome)
      }
    }
    return Array.from(nomes.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [items])

  /** `escolhidaId` null tira a escolha; sem ele, vale a que o item já tem. */
  function aplicarCotacoes(item: QuoteItem, cotacoes: CotacaoFornecedorItem[], escolhidaId: string | null | undefined = item.product.cotacaoEscolhidaId) {
    // quem devolveu quantidade 0 não atende nada — não vira o fornecedor do item, por mais barato que seja
    const atendem = cotacoes.filter(cotacaoAtende)
    // a escolhida à mão vale enquanto existir e atender; senão, volta a valer a mais barata
    const escolhida = atendem.find((c) => c.id === escolhidaId)
    const alvo = escolhida ?? melhorCotacaoFornecedor(atendem)
    // o NCM do item é o do fornecedor em uso (quando ele informou um NCM válido) — cada fornecedor
    // guarda o seu na própria cotação; sem NCM nele, o do item fica como está
    const ncmDoAlvo = alvo?.ncm ? normalizarNcm(alvo.ncm) : undefined
    // a filial que fatura muda a alíquota de ICMS da compra; sem ela na cotação, ao trocar de
    // fornecedor vale o estado do cadastro dele (senão o item ficaria com a UF do fornecedor anterior)
    const uf =
      alvo?.ufOrigem ||
      (alvo && !mesmoFornecedor(alvo.fornecedor, item.product.fornecedor)
        ? fornecedores.find((f) => mesmoFornecedor(f.nome, alvo.fornecedor))?.estado
        : undefined)
    onPatchItem(item.id, {
      cotacoesFornecedores: cotacoes,
      cotacaoEscolhidaId: escolhida?.id,
      ...(alvo
        ? {
            valorUnt: alvo.valorUnitario,
            fornecedor: alvo.fornecedor,
            marca: alvo.marca,
            ...(alvo.prazoEntrega ? { prazoEntrega: alvo.prazoEntrega } : {}),
            ...(ncmDoAlvo ? { ncm: ncmDoAlvo } : {}),
            ...(uf ? { estadoOrigem: uf } : {}),
          }
        : {}),
    })
  }

  function handleAddCotacao(item: QuoteItem, cotacao: Omit<CotacaoFornecedorItem, 'id'>) {
    aplicarCotacoes(item, [...(item.product.cotacoesFornecedores ?? []), { ...cotacao, id: makeId() }])
  }

  function handleEditarCotacao(item: QuoteItem, cotacaoId: string, patch: Partial<CotacaoFornecedorItem>) {
    aplicarCotacoes(
      item,
      (item.product.cotacoesFornecedores ?? []).map((c) => (c.id === cotacaoId ? { ...c, ...patch } : c)),
    )
  }

  /** Fixa essa cotação no item, mesmo mais cara. A mais barata não precisa ficar fixa: escolher ela
   * volta ao automático, e o item acompanha se outra ficar mais barata depois. */
  function handleEscolherCotacao(item: QuoteItem, cotacao: CotacaoFornecedorItem) {
    const cotacoes = item.product.cotacoesFornecedores ?? []
    const maisBarata = melhorCotacaoFornecedor(cotacoes.filter(cotacaoAtende))
    aplicarCotacoes(item, cotacoes, cotacao.id === maisBarata?.id ? null : cotacao.id)
  }

  /** Preço digitado na planilha: muda a cotação do fornecedor, cria uma nova ou (apagado) tira. */
  async function handleDefinirPreco(item: QuoteItem, fornecedor: string, cotacao: CotacaoFornecedorItem | undefined, valor: number | undefined) {
    if (valor === undefined) {
      if (!cotacao) return
      // com prazo, NCM, quantidade… guardados, confirma antes de perder
      const temDetalhes =
        !!cotacao.prazoEntrega || !!cotacao.ncm || cotacao.quantidadeDisponivel !== undefined || cotacao.valorTotal !== undefined || !!cotacao.observacao || !!cotacao.ufOrigem
      if (temDetalhes && !(await confirmar(`Tirar a cotação de ${cotacao.fornecedor} deste item? Ela tem prazo, NCM ou outros dados guardados.`, { confirmText: 'Tirar', tone: 'danger' }))) {
        return
      }
      aplicarCotacoes(item, (item.product.cotacoesFornecedores ?? []).filter((c) => c.id !== cotacao.id))
      return
    }
    if (cotacao) handleEditarCotacao(item, cotacao.id, { valorUnitario: valor })
    else handleAddCotacao(item, { fornecedor, marca: '', valorUnitario: valor })
  }

  async function handleRemoveCotacao(item: QuoteItem, cotacaoId: string) {
    const cotacao = (item.product.cotacoesFornecedores ?? []).find((c) => c.id === cotacaoId)
    const quem = cotacao ? [cotacao.fornecedor, cotacao.marca].filter((x) => x?.trim()).join(' · ') : ''
    if (!(await confirmar(`Tirar esta cotação de fornecedor do item?${quem ? `\n\n${quem}` : ''}`, { confirmText: 'Tirar', tone: 'danger' }))) {
      return
    }
    aplicarCotacoes(
      item,
      (item.product.cotacoesFornecedores ?? []).filter((c) => c.id !== cotacaoId),
    )
  }

  // vindo do modal de importação — um lote de itens que podem pertencer a QuoteItems diferentes,
  // cada um recebe a mesma cotação (fornecedor/marca), com o valor unitário e (se o arquivo trazia)
  // o valor total mudando por item
  function handleImportarConfirmado(fornecedorNome: string, marca: string, confirmados: ItemImportadoConfirmado[]) {
    // tudo do mesmo item de uma vez: o fornecedor pode ter mandado mais de uma oferta pro item (marcas
    // diferentes) — uma de cada vez, a segunda partiria do item sem a primeira e a apagaria
    const porItem = new Map<string, ItemImportadoConfirmado[]>()
    for (const c of confirmados) porItem.set(c.itemId, [...(porItem.get(c.itemId) ?? []), c])
    for (const [itemId, ofertas] of porItem) {
      const item = items.find((i) => i.id === itemId)
      if (!item) continue
      const novas: CotacaoFornecedorItem[] = ofertas.map((c) => ({
        id: makeId(),
        fornecedor: fornecedorNome,
        // marca lida do próprio arquivo (coluna MARCA) vale mais que a marca geral digitada
        marca: c.marca || marca,
        valorUnitario: c.valorUnitario,
        ...(c.valorTotal !== undefined ? { valorTotal: c.valorTotal } : {}),
        ...(c.prazoEntrega ? { prazoEntrega: c.prazoEntrega } : {}),
        ...(c.ncm ? { ncm: c.ncm } : {}),
        ...(c.quantidadeDisponivel !== undefined ? { quantidadeDisponivel: c.quantidadeDisponivel } : {}),
        ...(c.ufOrigem ? { ufOrigem: c.ufOrigem } : {}),
        ...(c.observacao ? { observacao: c.observacao } : {}),
      }))
      aplicarCotacoes(item, [...(item.product.cotacoesFornecedores ?? []), ...novas])
    }
  }

  const termo = busca.trim().toLowerCase()
  const itensVisiveis = items
    .map((item, i) => ({ item, numero: i + 1 }))
    .filter(({ item }) => {
      const p = item.product
      const cotacoes = p.cotacoesFornecedores ?? []
      if (soSemCotacao && cotacoes.length > 0) return false
      if (filtroFornecedor && !cotacoes.some((c) => c.fornecedor.trim().toUpperCase() === filtroFornecedor.toUpperCase())) return false
      if (termo && ![p.interno, p.referencia, p.descricao, p.marca].some((v) => v.toLowerCase().includes(termo))) return false
      return true
    })
  const filtrosAtivos = !!termo || !!filtroFornecedor || soSemCotacao
  const semCotacao = items.filter((i) => (i.product.cotacoesFornecedores ?? []).length === 0).length

  if (!isEditing) {
    return (
      <div className="card text-center py-16">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Nenhuma cotação aberta</h2>
        <p className="text-sm text-ink-400 mb-5">Crie ou abra uma cotação na aba Cotações pra comparar fornecedores.</p>
        <Button variant="primary" onClick={onGoToCotacoes}>
          Ir para Cotações
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {travadaPorOutro && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            Esta cotação está sendo analisada por <strong>{activeResponsavel}</strong> — só ele(a) pode alterá-la agora.
          </p>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink-900">Comparar fornecedores</h2>
            {visao === 'planilha' ? (
              <p className="text-sm text-ink-400">
                No formato do Custo Base Macro: uma linha por item e, pra cada fornecedor, o preço e a marca. Digite o preço
                na coluna do fornecedor (apagar tira a cotação); o mais barato (VLR MÍN, em verde) já preenche o item, e o
                círculo da célula escolhe outro, mesmo mais caro. Cada coluna tem filtro e ordem no ▾, e muda de lugar
                arrastando o título. Prazo, NCM e quantidade que atende ficam no Detalhado.
              </p>
            ) : (
              <p className="text-sm text-ink-400">
                Registre as cotações que os fornecedores devolverem — edite direto na tabela. A mais barata de cada item
                (★) já atualiza o fornecedor, a marca, o valor unitário, o prazo e o NCM do item automaticamente; se
                compensar outra, mesmo mais cara, clique em "Escolher" nela. Em "Qtd atende", quanto o fornecedor tem do
                item — vazio quer dizer que ele atende a quantidade toda.
              </p>
            )}
          </div>
          {/* quebra linha no celular: lado a lado, os dois botões passavam da largura da tela */}
          <div ref={voltarRef} className="flex flex-wrap gap-2">
            {!travadaPorOutro && items.length > 0 && (
              <Button variant="secondary" onClick={() => setImportAberto(true)}>
                Importar cotação<span className="hidden sm:inline"> (planilha, PDF, foto…)</span>
              </Button>
            )}
            <Button variant="ghost" onClick={onGoToPrecificacao}>
              Voltar para Precificação
            </Button>
          </div>
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div role="group" aria-label="Como ver" className="inline-flex rounded-lg border border-ink-200 p-0.5">
              {(
                [
                  ['planilha', 'Planilha (Custo Base Macro)'],
                  ['detalhado', 'Detalhado'],
                ] as const
              ).map(([id, nome]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={visao === id}
                  onClick={() => setVisao(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${visao === id ? 'bg-ink-950 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
                >
                  {nome}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="field-input w-full sm:w-64 py-1.5 text-sm"
              placeholder="Buscar item (interno, referência, descrição…)"
              aria-label="Buscar item"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {visao === 'detalhado' && (
              <>
                <select
                  className={`field-input w-full sm:w-56 py-1.5 text-sm ${filtroFornecedor ? 'border-ink-400 bg-ink-100 font-semibold' : ''}`}
                  value={filtroFornecedor}
                  onChange={(e) => setFiltroFornecedor(e.target.value)}
                  aria-label="Mostrar só as cotações desse fornecedor"
                >
                  <option value="">Todos os fornecedores</option>
                  {fornecedoresCotados.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 text-sm text-ink-600">
                  <input type="checkbox" checked={soSemCotacao} onChange={(e) => setSoSemCotacao(e.target.checked)} />
                  Só itens sem cotação ({semCotacao})
                </label>
                {filtrosAtivos && (
                  <>
                    <span className="text-xs text-ink-500">
                      Mostrando <strong className="text-ink-900">{itensVisiveis.length}</strong> de {items.length} itens
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBusca('')
                        setFiltroFornecedor('')
                        setSoSemCotacao(false)
                      }}
                      className="pill-tab border border-ink-200 py-1 text-xs text-ink-600 hover:bg-ink-50"
                    >
                      Limpar filtros
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-10">
            Nenhum item registrado ainda — volte em "Itens da cotação" pra adicionar.
          </p>
        ) : visao === 'planilha' ? (
          <PlanilhaComparar
            items={items}
            travada={travadaPorOutro}
            busca={busca}
            fornecedoresCadastrados={fornecedores.map((f) => f.nome)}
            nomeDoArquivo={`CUSTO BASE MACRO${codigoCotacao ? ` - ${codigoCotacao}` : ''}${cliente ? ` - ${cliente.replace(/[\\/:*?"<>|]+/g, ' ').trim()}` : ''}.xlsx`}
            onDefinirPreco={(item, fornecedor, cotacao, valor) => void handleDefinirPreco(item, fornecedor, cotacao, valor)}
            onDefinirMarca={(item, cotacao, marca) => handleEditarCotacao(item, cotacao.id, { marca })}
            onEscolher={handleEscolherCotacao}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <datalist id={ID_LISTA_FORNECEDORES}>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.nome} />
              ))}
            </datalist>
            {/* no celular cada cotação vira um cartão (ver .tabela-empilhada no index.css) */}
            <table className="tabela-empilhada w-full text-sm border-collapse">
              <thead>
                <tr className="bg-ink-50 text-left text-ink-400">
                  <th className="py-2 px-2 w-8"></th>
                  <th className="py-2 px-2 font-medium min-w-[12rem]">Fornecedor</th>
                  <th className="py-2 px-2 font-medium min-w-[8rem]">Marca</th>
                  <th className="py-2 px-2 font-medium min-w-[7rem]">Prazo</th>
                  <th className="py-2 px-2 font-medium w-32">NCM</th>
                  <th className="py-2 px-2 font-medium w-28 text-right">Qtd atende</th>
                  <th className="py-2 px-2 font-medium w-32 text-right">Valor unt.</th>
                  <th className="py-2 px-2 font-medium w-32 text-right">Valor total</th>
                  <th className="py-2 px-2 font-medium w-40 text-right">Dif. p/ melhor</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {itensVisiveis.length === 0 && (
                  <tr>
                    <td colSpan={TOTAL_COLUNAS} className="celula-larga py-6 text-center text-sm text-ink-400 border-t border-ink-100">
                      Nenhum item com esses filtros.
                    </td>
                  </tr>
                )}
                {itensVisiveis.map(({ item, numero }) => {
                  const p = item.product
                  const todas = p.cotacoesFornecedores ?? []
                  const validas = todas.filter(cotacaoAtende)
                  const menorValor = validas.length > 0 ? Math.min(...validas.map((c) => c.valorUnitario)) : undefined
                  const melhor = melhorCotacaoFornecedor(validas)
                  // a que preenche o item: a escolhida à mão, se houver, senão a mais barata
                  const escolhida = validas.find((c) => c.id === p.cotacaoEscolhidaId && c !== melhor)
                  const emUso = escolhida ?? melhor
                  // fornecedores que classificaram o item com NCMs diferentes — vale um aviso, porque o
                  // NCM muda o imposto (o item fica com o do fornecedor em uso)
                  const ncmsDosFornecedores = new Set(
                    todas.map((c) => normalizarNcm(c.ncm ?? '')).filter((n): n is string => !!n),
                  )
                  const ncmDoMelhor = emUso?.ncm ? normalizarNcm(emUso.ncm) : undefined
                  // o mais barato não tem a quantidade toda: quem completa (do mais barato pro mais caro)
                  const qtdItem = p.qtd || 0
                  const melhorParcial = !!melhor && quantidadeAtendida(melhor, qtdItem) < qtdItem
                  const plano = melhorParcial && !escolhida ? planoDeAtendimento(validas, qtdItem) : undefined
                  const escolhidaParcial = !!escolhida && quantidadeAtendida(escolhida, qtdItem) < qtdItem
                  const cotacoesVisiveis = filtroFornecedor
                    ? todas.filter((c) => c.fornecedor.trim().toUpperCase() === filtroFornecedor.toUpperCase())
                    : todas
                  return (
                    <Fragment key={item.id}>
                      <tr className="bg-ink-100/70">
                        <td className="so-tela-larga px-2 py-2 border-t-2 border-ink-200 text-center text-xs text-ink-400">{numero}</td>
                        <td colSpan={TOTAL_COLUNAS - 1} className="celula-larga px-2 py-2 border-t-2 border-ink-200">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="mr-1.5 text-xs text-ink-400 md:hidden">{numero}.</span>
                              <span className="font-display font-semibold text-ink-900">
                                {p.referencia || '(sem referência)'}
                              </span>
                              {p.interno && <span className="ml-2 font-mono text-xs text-ink-500">Interno {p.interno}</span>}
                              <span className="ml-2 text-ink-600">{p.descricao || '—'}</span>
                              <span className="ml-2 text-xs text-ink-500">
                                · Qtd <strong className="text-ink-800">{p.qtd}</strong>
                                {p.ncm ? (
                                  <>
                                    {' '}· NCM <span className="font-mono">{p.ncm}</span>
                                    {ncmDoMelhor && normalizarNcm(p.ncm) === ncmDoMelhor && (
                                      <span className="text-ink-400"> (do {escolhida ? 'escolhido' : 'mais barato'})</span>
                                    )}
                                  </>
                                ) : null}
                                {' '}· {todas.length} cotaç{todas.length === 1 ? 'ão' : 'ões'}
                              </span>
                              {ncmsDosFornecedores.size > 1 && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                                  title={`NCMs informados: ${Array.from(ncmsDosFornecedores).join(', ')}`}
                                >
                                  ⚠ NCMs diferentes entre fornecedores ({Array.from(ncmsDosFornecedores).join(' · ')})
                                </span>
                              )}
                            </div>
                            {escolhida && melhor ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800">
                                  ✓ Escolhido: <strong className="font-mono tabular-nums">{formatCurrency(escolhida.valorUnitario)}</strong>
                                  · {escolhida.fornecedor}
                                  <span className="text-emerald-600">
                                    {escolhidaParcial
                                      ? `(atende ${qtdTexto(quantidadeAtendida(escolhida, qtdItem))} de ${qtdTexto(qtdItem)})`
                                      : `(total ${formatCurrency(escolhida.valorTotal ?? escolhida.valorUnitario * qtdItem)})`}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400 px-2.5 py-1 text-xs text-emerald-800 dark:text-emerald-300">
                                  ★ Mais barato: <strong className="font-mono tabular-nums">{formatCurrency(melhor.valorUnitario)}</strong>
                                  · {melhor.fornecedor}
                                </span>
                              </span>
                            ) : melhor ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800">
                                Melhor: <strong className="font-mono tabular-nums">{formatCurrency(melhor.valorUnitario)}</strong>
                                · {melhor.fornecedor}
                                <span className="text-emerald-600">
                                  {melhorParcial
                                    ? `(atende ${qtdTexto(quantidadeAtendida(melhor, qtdItem))} de ${qtdTexto(qtdItem)})`
                                    : `(total ${formatCurrency(melhor.valorTotal ?? melhor.valorUnitario * qtdItem)})`}
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-amber-700">Sem cotação ainda</span>
                            )}
                          </div>
                          {escolhidaParcial && escolhida && (
                            <p className="mt-1.5 text-xs text-amber-800">
                              ⚠ O fornecedor escolhido atende {qtdTexto(quantidadeAtendida(escolhida, qtdItem))} de {qtdTexto(qtdItem)}.
                            </p>
                          )}
                          {plano && (
                            <p className="mt-1.5 text-xs text-amber-800">
                              ⚠ O mais barato não tem a quantidade toda.{' '}
                              {plano.partes.some((parte) => parte.cotacao !== melhor) ? (
                                <>
                                  Para completar os {qtdTexto(qtdItem)}:{' '}
                                  {plano.partes.map((parte, indice) => (
                                    <Fragment key={parte.cotacao.id}>
                                      {indice > 0 && ' + '}
                                      <strong>
                                        {qtdTexto(parte.quantidade)} com {parte.cotacao.fornecedor || '(sem nome)'}
                                      </strong>{' '}
                                      ({formatCurrency(parte.cotacao.valorUnitario)} un.)
                                    </Fragment>
                                  ))}
                                  {' '}= {formatCurrency(plano.partes.reduce((soma, parte) => soma + parte.cotacao.valorUnitario * parte.quantidade, 0))}
                                </>
                              ) : (
                                'Nenhum outro fornecedor cotado tem o restante.'
                              )}
                              {plano.faltam > 0 &&
                                (plano.partes.some((parte) => parte.cotacao !== melhor)
                                  ? ` — ainda faltam ${qtdTexto(plano.faltam)}, nenhum fornecedor cotado tem.`
                                  : ` Faltam ${qtdTexto(plano.faltam)}.`)}
                            </p>
                          )}
                        </td>
                      </tr>
                      {cotacoesVisiveis.map((c) => (
                        <LinhaCotacao
                          key={c.id}
                          cotacao={c}
                          qtdItem={p.qtd || 0}
                          menorValor={menorValor}
                          emUso={c === emUso}
                          automatica={c === melhor}
                          travadaPorOutro={travadaPorOutro}
                          rotuloItem={p.referencia || p.interno || String(numero)}
                          onChange={(patch) => handleEditarCotacao(item, c.id, patch)}
                          onEscolher={() => handleEscolherCotacao(item, c)}
                          onRemover={() => handleRemoveCotacao(item, c.id)}
                        />
                      ))}
                      {!travadaPorOutro && (
                        <LinhaNovaCotacao
                          qtdItem={p.qtd || 0}
                          rotuloItem={p.referencia || p.interno || String(numero)}
                          onAdicionar={(c) => handleAddCotacao(item, c)}
                        />
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importAberto && (
        <ImportarCotacaoFornecedorModal
          items={items}
          fornecedorSuggestions={fornecedorSuggestions}
          fornecedores={fornecedores.map((f) => ({ nome: f.nome, cnpj: f.cnpj }))}
          onConfirmar={handleImportarConfirmado}
          onClose={() => setImportAberto(false)}
        />
      )}

      {!voltarNoTopoVisivel && (
        <button
          type="button"
          onClick={onGoToPrecificacao}
          className="fixed right-6 z-40 inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-[bottom,background-color] hover:bg-brand-600"
          style={{ bottom: 'calc(1.5rem + var(--altura-aviso-entregas, 0px))' }}
        >
          <span aria-hidden>←</span> Voltar para Precificação
        </button>
      )}
    </div>
  )
}
