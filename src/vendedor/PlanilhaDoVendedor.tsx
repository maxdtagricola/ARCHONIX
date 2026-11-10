import { useCallback, useMemo, useState } from 'react'
import { dbGet } from '../db/db'
import { avisar } from '../dialogs'
import { useFecharComEsc } from '../teclaEsc'
import { PreviaPlanilhaCliente, usePlanilhaMontada } from '../components/PreviaPlanilhaCliente'
import {
  abrirPaginaParaImpressao,
  baixarBlob,
  compartilharArquivo,
  linkEmail,
  linkWhatsApp,
  preencherPlanilhaDoCliente,
  suportaCompartilharArquivo,
} from '../planilhaCliente'
import { gerarPlanilhaPadraoDosValores, nomePlanilhaPadrao } from '../planilhaClientePadrao'
import { formatCurrency } from '../utils'
import type { CotacaoDoVendedor, ValoresParaOVendedor } from './cotacaoDoVendedor'

type Formato = 'cliente' | 'padrao'

/** A planilha da cotação pro vendedor ver, baixar e compartilhar — a mesma que a equipe gera em
 * "Enviar cotação": a do cliente preenchida (quando ele mandou uma) ou o molde padrão. Sempre com os
 * valores que foram enviados ao vendedor (valoresEnviados), nunca os de agora. A planilha original
 * continua anexada à cotação, do jeito que veio. */
export function PlanilhaDoVendedor({ c, valores, onFechar }: { c: CotacaoDoVendedor; valores: ValoresParaOVendedor; onFechar: () => void }) {
  const temPlanilha = !!c.planilhaCliente
  const [formato, setFormato] = useState<Formato>(temPlanilha ? 'cliente' : 'padrao')
  const [compartilhando, setCompartilhando] = useState(false)
  useFecharComEsc(onFechar)

  const titulo = `Cotação ${c.codigo} — ${c.cliente || 'cliente'} — ${c.maquina || 'máquina'}`
  const mensagem = `Segue a cotação ${c.codigo} (${c.cliente || 'cliente'}${c.maquina ? ` — ${c.maquina}` : ''}). Total: ${formatCurrency(valores.total)}.`
  const nomeDoArquivo = formato === 'cliente' && c.planilhaCliente ? c.planilhaCliente : nomePlanilhaPadrao({ cliente: c.cliente, maquina: c.maquina })

  const montar = useCallback(async () => {
    if (formato === 'cliente') {
      const original = await dbGet<{ conteudoBase64: string }>('planilhasCliente', c.id, { semCache: true })
      if (!original) throw new Error('A planilha do cliente não foi encontrada no servidor.')
      const linhas = valores.itens.map((i) => ({ referencia: i.referencia, descricao: i.descricao, entrega: i.entrega, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal }))
      return preencherPlanilhaDoCliente(original.conteudoBase64, linhas, nomeDoArquivo, titulo)
    }
    return gerarPlanilhaPadraoDosValores(valores.itens, { cliente: c.cliente, maquina: c.maquina, vendedor: c.vendedor }, valores.uf ?? 'RO', titulo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formato, c.id, valores])
  const { resultado, erro } = usePlanilhaMontada(montar)
  const mime = resultado?.arquivo.type ?? ''
  const podeCompartilharArquivo = useMemo(() => !!mime && suportaCompartilharArquivo(mime), [mime])

  async function compartilhar() {
    if (!resultado) return
    setCompartilhando(true)
    try {
      await compartilharArquivo(resultado.arquivo, nomeDoArquivo, titulo, mensagem, mime)
    } catch (err) {
      // fechar a folha de compartilhamento não é erro
      if (err instanceof Error && err.name === 'AbortError') return
      void avisar('Não consegui compartilhar o arquivo direto — baixe a planilha e anexe na conversa.')
    } finally {
      setCompartilhando(false)
    }
  }

  const botao = 'rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Planilha da cotação ${c.codigo}`}
        className="card flex max-h-[92vh] w-full max-w-4xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-ink-900">Planilha da cotação {c.codigo}</h3>
            <p className="break-all text-sm text-ink-400">{nomeDoArquivo}</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="px-1 text-xl leading-none text-ink-400 hover:text-ink-700">
            ×
          </button>
        </div>

        {temPlanilha && (
          <div className="my-2 flex flex-wrap gap-2" role="group" aria-label="Qual planilha">
            {(
              [
                ['cliente', 'Planilha do cliente'],
                ['padrao', 'Planilha padrão'],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                aria-pressed={formato === id}
                onClick={() => setFormato(id)}
                className={`pill-tab border ${formato === id ? 'border-ink-950 bg-ink-950 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        )}

        {erro ? (
          <p className="py-4 text-sm text-rose-600">{erro}</p>
        ) : resultado ? (
          <PreviaPlanilhaCliente resultado={resultado} gerada={formato === 'padrao'} />
        ) : (
          <p className="py-4 text-sm text-ink-400">Montando a planilha…</p>
        )}

        <div className="border-t border-ink-100 pt-3">
          <p className="field-label mb-2">Compartilhar a cotação</p>
          <div className="flex flex-wrap gap-2">
            {podeCompartilharArquivo && (
              <button
                type="button"
                disabled={!resultado || compartilhando}
                onClick={() => void compartilhar()}
                className="rounded-lg bg-ink-900 px-3 py-2 text-sm font-semibold text-surface transition hover:opacity-90 disabled:opacity-50"
              >
                Compartilhar planilha
              </button>
            )}
            <button type="button" disabled={!resultado} onClick={() => resultado && baixarBlob(resultado.arquivo, nomeDoArquivo)} className={botao}>
              Baixar planilha (.{nomeDoArquivo.split('.').pop()?.toLowerCase() || 'xlsx'})
            </button>
            <button type="button" disabled={!resultado} onClick={() => resultado && abrirPaginaParaImpressao(resultado.paginaImpressao)} className={botao}>
              Imprimir / PDF
            </button>
            <a href={linkWhatsApp(mensagem)} target="_blank" rel="noreferrer" className={botao}>
              WhatsApp (mensagem)
            </a>
            <a href={linkEmail(titulo, mensagem)} className={botao}>
              E-mail
            </a>
          </div>
          {!podeCompartilharArquivo && (
            <p className="mt-2 text-[11px] text-ink-400">
              Este navegador não manda o arquivo direto pro WhatsApp — baixe a planilha e anexe na conversa.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
