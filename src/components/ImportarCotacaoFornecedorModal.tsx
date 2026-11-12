import { useState } from 'react'
import { Button } from './ui/Basics'
import { AutocompleteField, TextField } from './ui/Field'
import {
  importarCotacaoFornecedor,
  type FornecedorConhecido,
  type ItemDetectadoFornecedor,
  type LinhaNaoEncontrada,
} from '../cotacaoFornecedorImport'
import type { TipoCasamento } from '../importacao/codigosFornecedor'
import { formatarNumeroBR, formatarNumeroCurtoBR, parseNumeroFlexivel } from '../numeros'
import { normalizarNcm } from '../importacao/ncm'
import { avisar } from '../dialogs'
import { useFecharComEsc } from '../teclaEsc'
import type { QuoteItem } from '../types'

interface LinhaEditavel extends ItemDetectadoFornecedor {
  incluir: boolean
  valorUnitarioTexto: string
  valorTotalTexto: string
  marcaTexto: string
  prazoTexto: string
  ncmTexto: string
  quantidadeTexto: string
}

/** NCM digitado/lido é válido? (vazio também vale — fica sem NCM) */
function ncmValidoOuVazio(texto: string): boolean {
  return !texto.trim() || normalizarNcm(texto) !== undefined
}

/** "1.234,56" / "123,45" / "R$ 9,90" -> number; vazio/inválido/zero -> undefined. */
function textoParaValor(texto: string): number | undefined {
  const valor = parseNumeroFlexivel(texto)
  return valor !== undefined && valor > 0 ? valor : undefined
}

/** Preço com as casas que o fornecedor mandou (a SOLUS manda 3: "29,808") — arredondar pra 2 mudaria o
 * total do item. */
function valorParaTexto(valor: number | undefined): string {
  if (valor === undefined) return ''
  const casas = Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6 ? 3 : 2
  return formatarNumeroBR(valor, casas)
}

/** Quantidade que o fornecedor atende: vazio = a quantidade toda (undefined); texto que não é número
 * (ou negativo) = inválido (null). */
function textoParaQuantidade(texto: string): number | undefined | null {
  if (!texto.trim()) return undefined
  const valor = parseNumeroFlexivel(texto)
  return valor !== undefined && valor >= 0 ? valor : null
}

/** "pedimos 5, o fornecedor devolveu 2 (faltam 3)" — pro aviso logo depois de ler o arquivo. */
function textoDiferencaDeQuantidade(referencia: string, pedida: number, devolvida: number): string {
  const diferenca = devolvida - pedida
  const detalhe = diferenca < 0 ? `faltam ${formatarNumeroCurtoBR(-diferenca, 3)}` : `${formatarNumeroCurtoBR(diferenca, 3)} a mais`
  return `• ${referencia}: pedimos ${formatarNumeroCurtoBR(pedida, 3)}, o fornecedor devolveu ${formatarNumeroCurtoBR(devolvida, 3)} (${detalhe})`
}

const ACEITA_ARQUIVOS = '.xlsx,.xlsm,.xls,.csv,.ods,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,image/*'

/** Como o código do arquivo bate com o nosso, quando não é igual — selo na linha. */
const SELO_CASAMENTO: Record<Exclude<TipoCasamento, 'exato'>, { texto: string; classe: string }> = {
  alternativo: { texto: 'código alternativo', classe: 'bg-sky-100 text-sky-800' },
  variacao: { texto: 'código parecido', classe: 'bg-amber-100 text-amber-800' },
  proximo: { texto: 'confira: código diferente', classe: 'bg-rose-100 text-rose-800' },
}

export interface ItemImportadoConfirmado {
  itemId: string
  valorUnitario: number
  valorTotal?: number
  marca?: string
  prazoEntrega?: string
  /** NCM informado pelo fornecedor (0000.00.00). */
  ncm?: string
  /** Quantas unidades o fornecedor atende (vazio: a quantidade toda). */
  quantidadeDisponivel?: number
  /** UF de onde a mercadoria sai (filial que fatura). */
  ufOrigem?: string
  observacao?: string
}

export function ImportarCotacaoFornecedorModal({
  items,
  fornecedorSuggestions,
  fornecedores,
  onConfirmar,
  onClose,
}: {
  items: QuoteItem[]
  fornecedorSuggestions: { value: string; label: string }[]
  fornecedores: FornecedorConhecido[]
  onConfirmar: (fornecedor: string, marca: string, itens: ItemImportadoConfirmado[]) => void
  onClose: () => void
}) {
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | undefined>(undefined)
  const [avisoLeituraFraca, setAvisoLeituraFraca] = useState<string | undefined>(undefined)
  const [fornecedorDetectado, setFornecedorDetectado] = useState<string | undefined>(undefined)
  const [fornecedor, setFornecedor] = useState('')
  const [marca, setMarca] = useState('')
  const [linhas, setLinhas] = useState<LinhaEditavel[] | undefined>(undefined)
  const [padrao, setPadrao] = useState<{ fornecedor: string; descricao: string } | undefined>(undefined)
  const [naoEncontrados, setNaoEncontrados] = useState<LinhaNaoEncontrada[]>([])
  const [avisos, setAvisos] = useState<string[]>([])

  async function handleArquivoSelecionado(file: File) {
    setLendo(true)
    setErro(undefined)
    setAvisoLeituraFraca(undefined)
    setLinhas(undefined)
    setPadrao(undefined)
    setNaoEncontrados([])
    setAvisos([])
    setNomeArquivo(file.name)
    try {
      const resultado = await importarCotacaoFornecedor(file, items, fornecedores)
      // quantidade devolvida diferente da pedida (menor ou maior) e itens sem estoque: avisa já, antes
      // de revisar a tabela
      const diferencas = resultado.itens.flatMap((item) => {
        const pedida = items.find((i) => i.id === item.itemId)?.product.qtd || 0
        return !item.semEstoque && item.quantidadeDetectada !== undefined && item.quantidadeDetectada !== pedida
          ? [textoDiferencaDeQuantidade(item.referencia, pedida, item.quantidadeDetectada)]
          : []
      })
      const semEstoque = resultado.itens.filter((item) => item.semEstoque).map((item) => `• ${item.referencia}`)
      if (diferencas.length > 0 || semEstoque.length > 0) {
        const LIMITE = 15
        const partes: string[] = []
        if (diferencas.length > 0) {
          partes.push(
            `${diferencas.length === 1 ? 'Um item veio' : `${diferencas.length} itens vieram`} com quantidade diferente da que pedimos:\n\n` +
              diferencas.slice(0, LIMITE).join('\n') +
              (diferencas.length > LIMITE ? `\n… e mais ${diferencas.length - LIMITE}.` : ''),
          )
        }
        if (semEstoque.length > 0) {
          partes.push(
            `${semEstoque.length === 1 ? 'Um item está' : `${semEstoque.length} itens estão`} sem estoque no fornecedor agora:\n\n` +
              semEstoque.slice(0, LIMITE).join('\n') +
              (semEstoque.length > LIMITE ? `\n… e mais ${semEstoque.length - LIMITE}.` : ''),
          )
        }
        void avisar(`${partes.join('\n\n')}\n\nConfira na coluna "Qtd que atende" antes de adicionar ao comparador.`, {
          titulo: diferencas.length > 0 ? 'Quantidade diferente da solicitada' : 'Itens sem estoque',
        })
      }
      setFornecedorDetectado(resultado.fornecedorDetectado)
      setFornecedor(resultado.fornecedorDetectado ?? '')
      setAvisoLeituraFraca(resultado.avisoLeituraFraca)
      setPadrao(resultado.padrao)
      setNaoEncontrados(resultado.naoEncontrados)
      setAvisos(resultado.avisos ?? [])
      setLinhas(
        resultado.itens.map((item) => ({
          ...item,
          // código só "parecido em um caractere" pode ser outra peça, e valor que não fecha a conta pode
          // estar errado — os dois ficam pra marcar na mão, depois de conferir
          incluir: item.valorUnitarioDetectado !== undefined && item.casamento !== 'proximo' && !item.conferir,
          valorUnitarioTexto: valorParaTexto(item.valorUnitarioDetectado),
          valorTotalTexto: valorParaTexto(item.valorTotalDetectado),
          marcaTexto: item.marcaDetectada ?? '',
          prazoTexto: item.prazoDetectado ?? '',
          ncmTexto: item.ncmDetectado ?? '',
          quantidadeTexto: item.quantidadeDetectada !== undefined ? formatarNumeroCurtoBR(item.quantidadeDetectada, 3) : '',
        })),
      )
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao ler o arquivo.')
    } finally {
      setLendo(false)
    }
  }

  function patchLinha(chave: string, patch: Partial<LinhaEditavel>) {
    setLinhas((prev) => prev?.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))
  }

  const linhasProntas = (linhas ?? []).filter((l) => l.incluir && textoParaValor(l.valorUnitarioTexto) !== undefined)
  // NCM errado não entra: ele muda o cálculo de ICMS-ST/RBC do item — corrige ou apaga antes
  const linhasComNcmInvalido = linhasProntas.filter((l) => !ncmValidoOuVazio(l.ncmTexto))
  const linhasComQuantidadeInvalida = linhasProntas.filter((l) => textoParaQuantidade(l.quantidadeTexto) === null)
  const podeConfirmar =
    fornecedor.trim().length > 0 && linhasProntas.length > 0 && linhasComNcmInvalido.length === 0 && linhasComQuantidadeInvalida.length === 0
  const temMarcaOuPrazo = (linhas ?? []).some((l) => l.marcaDetectada || l.prazoDetectado)
  const ncmsLidos = (linhas ?? []).filter((l) => l.ncmDetectado).length
  const quantidadesLidas = (linhas ?? []).filter((l) => l.quantidadeDetectada !== undefined).length
  /** Quantidade que o fornecedor atende menos a pedida: negativa = faltam, positiva = a mais, 0 = igual
   * (ou não informada, que vale como a quantidade toda). */
  function diferencaNaLinha(l: LinhaEditavel): number {
    const quantidade = textoParaQuantidade(l.quantidadeTexto)
    const qtdItem = items.find((i) => i.id === l.itemId)?.product.qtd || 0
    return typeof quantidade === 'number' ? quantidade - qtdItem : 0
  }
  const linhasComMenos = (linhas ?? []).filter((l) => diferencaNaLinha(l) < 0).length
  const linhasComMais = (linhas ?? []).filter((l) => diferencaNaLinha(l) > 0).length

  function handleConfirmar() {
    if (!podeConfirmar) return
    onConfirmar(
      fornecedor.trim(),
      marca.trim(),
      linhasProntas.map((l) => {
        const ncm = normalizarNcm(l.ncmTexto)
        const quantidade = textoParaQuantidade(l.quantidadeTexto)
        return {
          itemId: l.itemId,
          ...(typeof quantidade === 'number' ? { quantidadeDisponivel: quantidade } : {}),
          valorUnitario: textoParaValor(l.valorUnitarioTexto)!,
          valorTotal: textoParaValor(l.valorTotalTexto),
          ...(l.marcaTexto.trim() ? { marca: l.marcaTexto.trim() } : {}),
          ...(l.prazoTexto.trim() ? { prazoEntrega: l.prazoTexto.trim() } : {}),
          ...(ncm ? { ncm } : {}),
          ...(l.ufOrigem ? { ufOrigem: l.ufOrigem } : {}),
          ...(l.observacao ? { observacao: l.observacao } : {}),
        }
      }),
    )
    onClose()
  }

  const inputCls = 'field-input text-right tabular-nums py-1'
  useFecharComEsc(onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink-900">Importar cotação do fornecedor</h3>
            <p className="text-sm text-ink-400">
              Planilha, PDF ou foto/print da cotação — os fornecedores conhecidos (SOLUS, INGÁ, CAMBUCI, MG, TOLEAGRI, MINAS,
              REDEPARTS, PAVONI, ENGEPEÇAS, ROMAR MANN) são lidos no padrão de cada um; os outros, pela Referência. Cada valor
              é conferido pela conta (unitário × quantidade = total): o que não fecha vem desmarcado, pra conferir.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 py-3">
          <label className="block">
            <span className="field-label">Arquivo</span>
            <input
              type="file"
              accept={ACEITA_ARQUIVOS}
              disabled={lendo}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleArquivoSelecionado(file)
                e.target.value = ''
              }}
              className="field-input"
            />
          </label>
          {nomeArquivo && !lendo && <p className="text-xs text-ink-400">{nomeArquivo}</p>}
          {lendo && (
            <p className="text-sm text-ink-400">
              Lendo arquivo… {nomeArquivo.match(/\.(pdf|png|jpe?g|webp|bmp|gif)$/i) && 'imagem e PDF escaneado podem levar alguns segundos (OCR).'}
            </p>
          )}
          {erro && <p className="text-sm text-rose-600">{erro}</p>}

          {linhas !== undefined && (
            <>
              {avisoLeituraFraca && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{avisoLeituraFraca}</p>
              )}

              {fornecedorDetectado && (
                <p className="text-xs text-emerald-700">
                  Fornecedor identificado no arquivo: <strong>{fornecedorDetectado}</strong> — confirme ou troque abaixo.
                </p>
              )}
              {avisos.map((a) => (
                <p key={a} role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {a}
                </p>
              ))}
              {(linhas ?? []).some((l) => l.conferir) && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {(linhas ?? []).filter((l) => l.conferir).length} item(ns) com valores que não fecham a conta (unitário × quantidade ≠ total) —
                  vieram desmarcados: confira no documento e marque se estiver certo.
                </p>
              )}
              {padrao && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Lido no padrão de <strong>{padrao.fornecedor}</strong>: {padrao.descricao}.
                </p>
              )}
              <p className="text-xs text-ink-500">
                {ncmsLidos > 0
                  ? `NCM lido em ${ncmsLidos} item(ns). `
                  : 'Não achei NCM no arquivo — dá pra digitar abaixo, se o fornecedor informou. '}
                O NCM fica guardado na cotação desse fornecedor, e o do fornecedor mais barato vira o NCM do item.
              </p>
              <p className="text-xs text-ink-500">
                <strong className="font-medium text-ink-700">Qtd que atende</strong> é quanto o fornecedor tem do item
                {quantidadesLidas > 0 ? ` (lida em ${quantidadesLidas} item(ns))` : ''} — vazio quer dizer que ele atende a
                quantidade toda. Menor que a nossa, a cotação fica marcada como parcial no comparador.
                {linhasComMenos > 0 && (
                  <span className="font-medium text-amber-700"> {linhasComMenos} item(ns) com menos que o pedido.</span>
                )}
                {linhasComMais > 0 && <span className="font-medium text-sky-700"> {linhasComMais} item(ns) com mais que o pedido.</span>}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <AutocompleteField label="Fornecedor" value={fornecedor} onChange={setFornecedor} suggestions={fornecedorSuggestions} />
                <TextField
                  label="Marca (opcional, vale pros itens sem marca própria)"
                  value={marca}
                  onChange={setMarca}
                />
              </div>

              {linhas.length > 0 ? (
                <div className="rounded-xl border border-ink-100 overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-ink-50 text-left text-ink-400">
                        <th className="py-2 px-2 w-8"></th>
                        <th className="py-2 px-2 font-medium">Item da cotação</th>
                        <th className="py-2 px-2 font-medium w-28 text-right">Valor unt.</th>
                        <th className="py-2 px-2 font-medium w-28 text-right">Valor total</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">Qtd que atende</th>
                        <th className="py-2 px-2 font-medium w-32">NCM</th>
                        {temMarcaOuPrazo && <th className="py-2 px-2 font-medium w-28">Marca</th>}
                        {temMarcaOuPrazo && <th className="py-2 px-2 font-medium w-24">Prazo</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l) => {
                        const item = items.find((i) => i.id === l.itemId)
                        const selo = l.casamento !== 'exato' ? SELO_CASAMENTO[l.casamento] : undefined
                        return (
                          <tr key={l.chave} className="border-t border-ink-100" data-referencia={l.referencia}>
                            <td className="py-2 px-2 text-center">
                              <input
                                type="checkbox"
                                checked={l.incluir}
                                aria-label={`Incluir ${l.referencia}${l.codigoNoArquivo ? ` (${l.codigoNoArquivo})` : ''}`}
                                onChange={(e) => patchLinha(l.chave, { incluir: e.target.checked })}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <p className="text-ink-800">{l.descricao || l.referencia || '(sem descrição)'}</p>
                              <p className="text-xs text-ink-400">
                                Ref. {l.referencia}
                                {item ? ` · qtd ${item.product.qtd}` : ''}
                                {l.conferido && (
                                  <span
                                    className="ml-1.5 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"
                                    title="O valor unitário × a quantidade do item bate com o valor total do arquivo"
                                  >
                                    ✓ unit. × qtd = total
                                  </span>
                                )}
                              </p>
                              {l.conferir && (
                                <p className="mt-0.5 text-[11px] font-medium text-amber-800" role="note" aria-label={`Conferir ${l.referencia}`}>
                                  ⚠ {l.conferir}
                                </p>
                              )}
                              {(selo || l.semEstoque || l.ufOrigem || l.observacao) && (
                                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                                  {selo && (
                                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${selo.classe}`} title={l.detalheCasamento}>
                                      {selo.texto}: {l.codigoNoArquivo}
                                      {l.detalheCasamento ? ` · ${l.detalheCasamento}` : ''}
                                    </span>
                                  )}
                                  {l.semEstoque && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">sem estoque</span>}
                                  {l.ufOrigem && <span className="rounded-full bg-ink-100 px-1.5 py-0.5 font-semibold text-ink-700">sai de {l.ufOrigem}</span>}
                                  {l.observacao && <span className="text-ink-500">{l.observacao}</span>}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="R$"
                                value={l.valorUnitarioTexto}
                                onChange={(e) => patchLinha(l.chave, { valorUnitarioTexto: e.target.value, incluir: true })}
                                className={inputCls}
                              />
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="R$ (opcional)"
                                value={l.valorTotalTexto}
                                onChange={(e) => patchLinha(l.chave, { valorTotalTexto: e.target.value })}
                                className={inputCls}
                              />
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder={item ? String(item.product.qtd) : 'todas'}
                                value={l.quantidadeTexto}
                                onChange={(e) => patchLinha(l.chave, { quantidadeTexto: e.target.value })}
                                aria-invalid={textoParaQuantidade(l.quantidadeTexto) === null}
                                aria-label={`Quantidade que o fornecedor atende — ${l.referencia}`}
                                title="Quanto o fornecedor tem desse item — vazio: atende a quantidade toda"
                                className={`${inputCls} ${
                                  textoParaQuantidade(l.quantidadeTexto) === null
                                    ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
                                    : diferencaNaLinha(l) < 0
                                      ? 'border-amber-400 text-amber-800'
                                      : diferencaNaLinha(l) > 0
                                        ? 'border-sky-400 text-sky-800'
                                        : ''
                                }`}
                              />
                              {diferencaNaLinha(l) < 0 && (
                                <p className="mt-0.5 text-right text-[10px] font-medium text-amber-700">
                                  parcial · faltam {formatarNumeroCurtoBR(-diferencaNaLinha(l), 3)}
                                </p>
                              )}
                              {diferencaNaLinha(l) > 0 && (
                                <p className="mt-0.5 text-right text-[10px] font-medium text-sky-700">
                                  +{formatarNumeroCurtoBR(diferencaNaLinha(l), 3)} a mais
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-1">
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="0000.00.00"
                                value={l.ncmTexto}
                                onChange={(e) => patchLinha(l.chave, { ncmTexto: e.target.value })}
                                onBlur={() => {
                                  const ncm = normalizarNcm(l.ncmTexto)
                                  if (ncm) patchLinha(l.chave, { ncmTexto: ncm })
                                }}
                                aria-invalid={!ncmValidoOuVazio(l.ncmTexto)}
                                title={
                                  ncmValidoOuVazio(l.ncmTexto)
                                    ? item?.product.ncm && l.ncmTexto && normalizarNcm(l.ncmTexto) !== normalizarNcm(item.product.ncm)
                                      ? `Diferente do NCM atual do item (${item.product.ncm})`
                                      : 'NCM informado pelo fornecedor'
                                    : 'NCM precisa ter 8 dígitos (ex.: 8433.90.90)'
                                }
                                className={`field-input py-1 font-mono text-sm ${
                                  ncmValidoOuVazio(l.ncmTexto) ? '' : 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
                                }`}
                              />
                              {item?.product.ncm &&
                                l.ncmTexto &&
                                ncmValidoOuVazio(l.ncmTexto) &&
                                normalizarNcm(l.ncmTexto) !== normalizarNcm(item.product.ncm) && (
                                  <p className="mt-0.5 text-[10px] text-amber-700">item hoje: {item.product.ncm}</p>
                                )}
                            </td>
                            {temMarcaOuPrazo && (
                              <td className="py-2 px-1">
                                <input
                                  type="text"
                                  value={l.marcaTexto}
                                  onChange={(e) => patchLinha(l.chave, { marcaTexto: e.target.value.toUpperCase() })}
                                  className="field-input py-1 text-sm"
                                />
                              </td>
                            )}
                            {temMarcaOuPrazo && (
                              <td className="py-2 px-1">
                                <input
                                  type="text"
                                  value={l.prazoTexto}
                                  onChange={(e) => patchLinha(l.chave, { prazoTexto: e.target.value.toUpperCase() })}
                                  className="field-input py-1 text-sm"
                                />
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !avisoLeituraFraca && (
                  <p className="text-sm text-ink-400 text-center py-4">Não encontrei nenhuma referência dessa cotação nesse arquivo.</p>
                )
              )}

              {naoEncontrados.length > 0 && (
                <details className="rounded-lg border border-ink-100 px-3 py-2 text-xs text-ink-600">
                  <summary className="cursor-pointer font-medium text-ink-700">
                    {naoEncontrados.length === 1 ? '1 item do arquivo não está' : `${naoEncontrados.length} itens do arquivo não estão`} nesta
                    cotação
                  </summary>
                  <ul className="mt-2 space-y-0.5">
                    {naoEncontrados.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-mono text-ink-800">{n.codigo}</span>
                        <span className="min-w-0 flex-1 truncate">{n.descricao}</span>
                        {n.valorUnitario !== undefined && <span className="tabular-nums">{valorParaTexto(n.valorUnitario)}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 pt-3 border-t border-ink-100">
          <p
            className={`text-xs ${linhasComNcmInvalido.length > 0 || linhasComQuantidadeInvalida.length > 0 ? 'text-rose-600' : 'text-ink-400'}`}
          >
            {linhasComNcmInvalido.length > 0
              ? `NCM inválido em ${linhasComNcmInvalido.length} item(ns) — precisa ter 8 dígitos; corrija ou apague.`
              : linhasComQuantidadeInvalida.length > 0
                ? `Quantidade inválida em ${linhasComQuantidadeInvalida.length} item(ns) — use um número, ou deixe vazio se atende tudo.`
                : linhasProntas.length > 0 && `${linhasProntas.length} item(ns) pronto(s) — confira os valores antes de confirmar.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleConfirmar} disabled={!podeConfirmar}>
              Adicionar {linhasProntas.length > 0 ? `(${linhasProntas.length})` : ''} ao comparador
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
