import { useCallback, useMemo, useState } from 'react'
import { useFecharComEsc } from '../teclaEsc'
import { Button } from './ui/Basics'
import { PreviaPlanilhaCliente, usePlanilhaMontada } from './PreviaPlanilhaCliente'
import { baixarBlob, compartilharArquivo, linkEmail, montarPlanilhaImportada, suportaCompartilharArquivo } from '../planilhaCliente'
import { gerarPlanilhaPadrao, nomePlanilhaPadrao } from '../planilhaClientePadrao'
import { gerarPdfCotacaoCliente } from '../cotacaoParaCliente'
import { calculateItem } from '../calc/calculator'
import { avisar } from '../dialogs'
import { formatCurrency } from '../utils'
import { nomeDoTexto, textoDaCotacao } from '../textoDaCotacao'
import { itensParaOVendedor } from '../valoresEnviados'
import { BotoesDoTexto, PreviaDoTexto } from './TextoDaCotacao'
import type { PlanilhaClienteArquivo } from '../db/planilhasClienteRepo'
import type { QuoteItem } from '../types'

const MIME_PDF = 'application/pdf'

type Formato = 'importada' | 'padrao' | 'pdf' | 'texto'

export function EnvioCotacaoModal({
  items,
  cliente,
  maquina,
  codigo,
  vendedor,
  planilhaCliente,
  onClose,
  onEnviado,
}: {
  items: QuoteItem[]
  cliente: string
  maquina: string
  codigo: string
  vendedor: string
  /** A planilha que veio do cliente, se a cotação foi importada de uma. */
  planilhaCliente?: { nomeArquivo: string; carregar: () => Promise<PlanilhaClienteArquivo | undefined> }
  onClose: () => void
  onEnviado: () => void
}) {
  const [formato, setFormato] = useState<Formato>(planilhaCliente ? 'importada' : 'padrao')
  const [enviando, setEnviando] = useState(false)

  const linhas = useMemo(
    () => items.map((item) => ({ item, resultado: calculateItem(item.product, item.pricing) })),
    [items],
  )
  const valorTotalGeral = useMemo(() => linhas.reduce((s, l) => s + l.resultado.precoVendaTotal, 0), [linhas])

  useFecharComEsc(onClose)

  const titulo = `Cotação — ${cliente || 'cliente'} — ${maquina || 'máquina'}`
  const mensagem = `Segue a cotação (${cliente || 'cliente'} — ${maquina || 'máquina'}).`
  const nomePdf = `cotacao-${(cliente || 'cliente').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
  const nomePadrao = nomePlanilhaPadrao({ cliente, maquina })
  const nomeImportada = planilhaCliente?.nomeArquivo ?? ''
  // o mesmo texto que o vendedor manda (com os valores de agora, que são os que vão pro cliente)
  const texto = useMemo(() => {
    const itens = itensParaOVendedor(items)
    return textoDaCotacao({ codigo, cliente, maquina }, { itens, total: itens.reduce((s, i) => s + i.valorTotal, 0) })
  }, [items, codigo, cliente, maquina])
  const nomeDoArquivo =
    formato === 'pdf' ? nomePdf : formato === 'importada' ? nomeImportada : formato === 'texto' ? nomeDoTexto({ codigo, cliente, maquina }) : nomePadrao

  const montar = useCallback(
    () =>
      formato === 'importada' && planilhaCliente
        ? montarPlanilhaImportada(planilhaCliente.carregar, items, nomeImportada, titulo)
        : gerarPlanilhaPadrao(items, { cliente, maquina, vendedor }, titulo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formato, items, cliente, maquina, vendedor],
  )
  const { resultado, erro } = usePlanilhaMontada(formato === 'pdf' || formato === 'texto' ? null : montar)

  const mime = formato === 'pdf' ? MIME_PDF : (resultado?.arquivo.type ?? '')
  const podeCompartilharArquivo = useMemo(() => !!mime && suportaCompartilharArquivo(mime), [mime])

  function arquivoAtual(): Blob | undefined {
    return formato === 'pdf' ? gerarPdfCotacaoCliente(items, cliente, maquina, codigo) : resultado?.arquivo
  }

  function handleBaixar() {
    const arquivo = arquivoAtual()
    if (arquivo) baixarBlob(arquivo, nomeDoArquivo)
  }

  async function handleCompartilhar() {
    const arquivo = arquivoAtual()
    if (!arquivo) return
    setEnviando(true)
    try {
      await compartilharArquivo(arquivo, nomeDoArquivo, titulo, mensagem, mime)
      onEnviado()
    } catch (err) {
      // fechar a folha de compartilhamento não é erro, e a cotação não conta como enviada
      if (err instanceof Error && err.name === 'AbortError') return
      await avisar('Não consegui compartilhar o arquivo direto — baixe e anexe manualmente.')
    } finally {
      setEnviando(false)
    }
  }

  const formatos: { id: Formato; rotulo: string }[] = [
    ...(planilhaCliente ? [{ id: 'importada' as const, rotulo: 'Planilha do cliente' }] : []),
    { id: 'padrao', rotulo: 'Planilha padrão' },
    { id: 'pdf', rotulo: 'Resumo em PDF' },
    { id: 'texto', rotulo: 'Texto' },
  ]
  const semArquivo = formato !== 'pdf' && !resultado

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink-900">Enviar cotação</h3>
            <p className="text-sm text-ink-400 break-all">{nomeDoArquivo}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-ink-400 hover:text-ink-700 text-xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="flex flex-wrap gap-2 my-2" role="group" aria-label="Formato do arquivo">
          {formatos.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={formato === f.id}
              onClick={() => setFormato(f.id)}
              className={`pill-tab border ${formato === f.id ? 'bg-ink-950 border-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        {formato === 'texto' ? (
          <PreviaDoTexto texto={texto} />
        ) : formato === 'pdf' ? (
          <div className="flex-1 overflow-auto rounded-xl border border-ink-100 my-2">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-ink-50 text-left text-ink-400">
                  <th className="py-2 px-2 font-medium">Referência</th>
                  <th className="py-2 px-2 font-medium">Descrição</th>
                  <th className="py-2 px-2 font-medium text-right">Qtd</th>
                  <th className="py-2 px-2 font-medium">Prazo</th>
                  <th className="py-2 px-2 font-medium text-right">Valor total</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ item, resultado: r }) => (
                  <tr key={item.id} className="border-t border-ink-100">
                    <td className="py-1.5 px-2 font-mono">{item.product.referencia || '—'}</td>
                    <td className="py-1.5 px-2">{item.product.descricao || '—'}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{item.product.qtd}</td>
                    <td className="py-1.5 px-2">{item.product.prazoEntrega || '—'}</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">{formatCurrency(r.precoVendaTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink-200 bg-ink-50 font-semibold">
                  <td className="py-1.5 px-2" colSpan={4}>
                    Total geral
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">{formatCurrency(valorTotalGeral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : erro ? (
          <p className="text-sm text-rose-600 py-4">{erro}</p>
        ) : resultado ? (
          <PreviaPlanilhaCliente resultado={resultado} gerada={formato === 'padrao'} />
        ) : (
          <p className="text-sm text-ink-400 py-4">Montando a planilha…</p>
        )}

        <div className="mt-3 border-t border-ink-100 pt-3">
          <p className="field-label mb-1">Enviar ao cliente</p>
          <p className="text-[11px] text-ink-400 mb-2">
            {formato === 'texto'
              ? 'Ao compartilhar, mandar pelo WhatsApp ou por e-mail, o status da cotação muda pra "ENVIADO". Copiando o texto pra colar na conversa, clique depois em "Marcar como enviada".'
              : 'Ao compartilhar ou mandar por e-mail, o status da cotação muda pra "ENVIADO". Pra ajustar algo antes, baixe o arquivo, edite no Excel e encaminhe; depois clique em "Marcar como enviada".'}
          </p>
          {formato === 'texto' ? (
            <div className="flex flex-wrap items-start gap-2">
              <BotoesDoTexto texto={texto} titulo={titulo} nomeArquivo={nomeDoArquivo} mensagemCurta={mensagem} onEnviado={onEnviado} />
              <Button variant="ghost" onClick={onEnviado}>
                Marcar como enviada
              </Button>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            {podeCompartilharArquivo && (
              <Button variant="primary" onClick={handleCompartilhar} disabled={enviando || semArquivo}>
                Compartilhar com cliente
              </Button>
            )}
            <Button variant="secondary" onClick={handleBaixar} disabled={semArquivo}>
              {formato === 'pdf' ? 'Baixar PDF' : `Baixar planilha (.${nomeDoArquivo.split('.').pop()?.toLowerCase() || 'xlsx'})`}
            </Button>
            <a href={linkEmail(titulo, mensagem)} onClick={onEnviado} className="pill-tab border border-ink-200 text-ink-600 hover:bg-ink-50">
              E-mail
            </a>
            <Button variant="ghost" onClick={onEnviado}>
              Marcar como enviada
            </Button>
          </div>
          )}
          {formato !== 'texto' && !podeCompartilharArquivo && (
            <p className="text-[11px] text-ink-400 mt-2">
              Seu navegador não compartilha o arquivo direto pro WhatsApp — baixe o arquivo acima e anexe manualmente.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
