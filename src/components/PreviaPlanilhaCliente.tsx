import { useEffect, useState } from 'react'
import type { PlanilhaAtualizada } from '../planilhaCliente'
import { formatCurrency } from '../utils'

type Montar = () => Promise<PlanilhaAtualizada>

/** Monta a planilha (importada ou do molde padrão) ao abrir e sempre que `montar` mudar. Sem `montar`,
 * nada: quem chama está mostrando outra coisa. O resultado fica ligado a quem o montou: ao trocar de
 * planilha, a anterior some na hora — um "Baixar" nesse instante não leva o arquivo errado. */
export function usePlanilhaMontada(montar: Montar | null) {
  const [montada, setMontada] = useState<{ de: Montar; resultado?: PlanilhaAtualizada; erro?: string } | null>(null)

  useEffect(() => {
    if (!montar) return
    let ativo = true
    montar()
      .then((resultado) => {
        if (ativo) setMontada({ de: montar, resultado })
      })
      .catch((err) => {
        if (ativo) setMontada({ de: montar, erro: err instanceof Error ? err.message : 'Erro ao montar a planilha.' })
      })
    return () => {
      ativo = false
    }
  }, [montar])

  const atual = montada?.de === montar ? montada : undefined
  return { resultado: atual?.resultado, erro: atual?.erro }
}

/** A planilha como ela é, mais o resumo do que o site preencheu. */
export function PreviaPlanilhaCliente({ resultado, gerada = false }: { resultado: PlanilhaAtualizada; gerada?: boolean }) {
  return (
    <>
      <p className="text-xs text-ink-400 my-2">
        {gerada
          ? `Molde padrão com ${resultado.itensAtualizados} item(ns) da cotação. O que o site não sabe (endereço, CPF/CNPJ, contato) fica em branco: baixe pra preencher.`
          : resultado.itensAtualizados > 0
            ? `${resultado.itensAtualizados} item(ns) atualizado(s) com marca, prazo e valor.`
            : resultado.itensComValorNaPlanilha.length > 0
              ? 'Nenhum item preenchido pelo site — todos os que bateram já tinham valor na planilha.'
              : 'Nenhum item da cotação bateu com a Referência de alguma linha dessa planilha.'}
      </p>
      {resultado.itensComValorNaPlanilha.length > 0 && (
        <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="mb-1 font-semibold">{resultado.itensComValorNaPlanilha.length} item(ns) já com valor na planilha — mantidos como estavam:</p>
          <ul className="space-y-0.5">
            {resultado.itensComValorNaPlanilha.map((c) => (
              <li key={`${c.linha}-${c.referencia}`}>
                <span className="font-mono">{c.referencia}</span>
                {c.descricao ? ` — ${c.descricao}` : ''}: {formatCurrency(c.valorNaPlanilha)} ({c.tipoDoValor}) na planilha · o site calculou{' '}
                {formatCurrency(c.valorDoSite)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* prévia fiel: a planilha como ela é (fundo branco de papel, cores e bordas dela), também no modo escuro */}
      <div
        data-testid="previa-planilha-cliente"
        className={`${resultado.previaFiel ? 'bg-white p-2' : 'planilha-preview'} flex-1 overflow-auto rounded-xl border border-ink-100 mb-4`}
        dangerouslySetInnerHTML={{ __html: resultado.htmlPreview }}
      />
    </>
  )
}
