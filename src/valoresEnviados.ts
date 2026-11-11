import { calculateItem } from './calc/calculator'
import type { ItemValorEnviado, QuoteItem, QuoteRecord, ValoresEnviados } from './types'

// O que o vendedor vê de valores da cotação dele: uma cópia tirada quando ela vai pra ENVIADO, com as
// mesmas colunas da planilha do cliente (marca, entrega, referência, descrição, quantidade, unitário e
// total). Fica assim mesmo que os valores mudem depois — no Pedido de Compra, por exemplo, se o
// fornecedor fizer por menos. Só troca quando quem cota confirma (ao salvar a Precificação com valores
// diferentes, ou pelo botão no cartão da cotação em Cotações). O servidor entrega isso ao vendedor e
// nada mais de preço (ver "vendedores" no server.js).

/** Os itens como iriam pro vendedor agora (os mesmos valores da planilha do cliente). */
export function itensParaOVendedor(items: QuoteItem[]): ItemValorEnviado[] {
  return items.map(({ id, product, pricing }) => {
    const { precoVendaTotal } = calculateItem(product, pricing)
    const quantidade = product.qtd || 0
    return {
      id,
      marca: product.marca.trim(),
      entrega: product.prazoEntrega.trim(),
      referencia: product.referencia.trim() || product.interno.trim(),
      descricao: product.descricao.trim(),
      quantidade,
      valorUnitario: quantidade > 0 ? precoVendaTotal / quantidade : 0,
      valorTotal: precoVendaTotal,
    }
  })
}

export function montarValoresEnviados(items: QuoteItem[], por: string, em: number, anterior?: ValoresEnviados): ValoresEnviados {
  const itens = itensParaOVendedor(items)
  const total = itens.reduce((s, i) => s + i.valorTotal, 0)
  // o estado de destino (vai no cabeçalho da planilha padrão que o vendedor baixa)
  const uf = items[0]?.product.perfil ?? 'RO'
  // trocar os valores mantém quando foi o envio; só a primeira vez é envio
  return anterior
    ? { itens, total, uf, enviadoEm: anterior.enviadoEm, enviadoPor: anterior.enviadoPor, atualizadoEm: em, atualizadoPor: por }
    : { itens, total, uf, enviadoEm: em, enviadoPor: por }
}

const centavos = (v: number) => Math.round(v * 100)

/** Os valores de agora são diferentes dos que o vendedor está vendo? (centavo a centavo) */
export function valoresMudaram(cotacao: Pick<QuoteRecord, 'items' | 'valoresEnviados'>): boolean {
  const enviados = cotacao.valoresEnviados
  if (!enviados) return false
  const agora = itensParaOVendedor(cotacao.items)
  if (agora.length !== enviados.itens.length) return true
  return agora.some((a, i) => {
    const e = enviados.itens[i]
    return (
      a.referencia !== e.referencia ||
      a.descricao !== e.descricao ||
      a.marca !== e.marca ||
      a.entrega !== e.entrega ||
      a.quantidade !== e.quantidade ||
      centavos(a.valorUnitario) !== centavos(e.valorUnitario) ||
      centavos(a.valorTotal) !== centavos(e.valorTotal)
    )
  })
}

/** Total de agora — pra mostrar ao lado do que o vendedor está vendo. */
export function totalAtualParaOVendedor(items: QuoteItem[]): number {
  return itensParaOVendedor(items).reduce((s, i) => s + i.valorTotal, 0)
}
