import { statusAntesDe } from './statusConfig'
import type { ItemPedidoVendedor, QuoteItem, QuoteRecord } from './types'

// Os itens que o vendedor pede e altera (ver "vendedores" no server.js) entram na Precificação quando
// alguém abre a cotação — e só ficam gravados quando ela é salva, como qualquer outra mudança:
//  - cotação que ele registrou (ainda sem nada na precificação): os itens que ele pediu viram os itens
//    da precificação, cada um com o mesmo id do pedido;
//  - cotação já com itens: o que ele mudou depois (adicionou, corrigiu, retirou — `itens` de cada
//    alteração dele) é aplicado nos itens, pelo id. Ao salvar, a alteração fica marcada como aplicada
//    (`aplicadaEm`) e não entra de novo — o que a equipe mudar depois vale.
// Até antes do PEDIDO DE COMPRA: dali em diante o vendedor não altera mais (o servidor recusa) e o que
// tiver ficado pra trás não mexe num pedido já feito.

const temCodigo = (p: { interno: string; referencia: string; descricao?: string }) =>
  !!(p.interno.trim() || p.referencia.trim() || (p.descricao ?? '').trim())

/** Linha com algum dado (a linha em branco de toda cotação nova não conta). */
const temDados = (item: QuoteItem) => temCodigo(item.product) || !!item.product.fornecedor.trim() || item.product.valorUnt > 0

const nomeDoItem = (p: { interno: string; referencia: string; descricao?: string }) =>
  [p.referencia.trim() || p.interno.trim(), (p.descricao ?? '').trim()].filter(Boolean).join(' — ') || 'item'

/** O status ainda é de antes do PEDIDO DE COMPRA (na ordem do fluxo configurada)? */
export function antesDoPedidoDeCompra(status: string): boolean {
  return statusAntesDe(status, 'PEDIDO DE COMPRA')
}

export interface ItensDoVendedorAplicados {
  items: QuoteItem[]
  /** As alterações (ids) que entraram — ao salvar, ficam marcadas como aplicadas. */
  alteracoes: string[]
  /** Os itens pedidos viraram os itens da precificação: ao salvar, a lista de itens pedidos sai (é a mesma). */
  doPedido: boolean
  /** Os que o vendedor retirou (vão pros itens excluídos da cotação, com opção de trazer de volta). */
  retirados: QuoteItem[]
  /** O que mudou, em palavras (pro aviso de quem abriu). Vazio = nada mudou nos itens da tela. */
  resumo: string[]
}

function itemNovo(pedido: ItemPedidoVendedor, novoItem: () => QuoteItem): QuoteItem {
  const item = novoItem()
  return {
    ...item,
    id: pedido.id || item.id,
    product: {
      ...item.product,
      interno: pedido.interno,
      referencia: pedido.referencia,
      descricao: pedido.descricao,
      qtd: pedido.quantidade > 0 ? pedido.quantidade : 1,
    },
  }
}

/** Os itens da cotação com o que o vendedor pediu/mudou e a equipe ainda não salvou. `items` são os
 * que a tela vai mostrar (os gravados ou a linha em branco); undefined = nada do vendedor pra aplicar. */
export function aplicarItensDoVendedor(record: QuoteRecord, items: QuoteItem[], novoItem: () => QuoteItem): ItensDoVendedorAplicados | undefined {
  if (!record.vendedor || !antesDoPedidoDeCompra(record.status)) return undefined
  const pendentes = (record.alteracoesVendedor ?? []).filter((a) => a.itens && !a.aplicadaEm)
  const pedidos = (record.itensPreRegistro ?? []).filter(temCodigo)

  if (!items.some((i) => temCodigo(i.product)) && pedidos.length > 0) {
    const novos = pedidos.map((p) => itemNovo({ ...p, descricao: p.descricao ?? '' }, novoItem))
    return {
      items: [...novos, ...items.filter(temDados)],
      alteracoes: pendentes.map((a) => a.id),
      doPedido: true,
      retirados: [],
      resumo: [novos.length === 1 ? 'O item que ele pediu entrou na precificação.' : `Os ${novos.length} itens que ele pediu entraram na precificação.`],
    }
  }

  if (pendentes.length === 0) return undefined
  let lista = [...items]
  const retirados: QuoteItem[] = []
  const resumo: string[] = []
  for (const { itens } of pendentes) {
    for (const id of itens!.retirados) {
      const item = lista.find((i) => i.id === id)
      if (!item) continue
      lista = lista.filter((i) => i.id !== id)
      retirados.push(item)
      resumo.push(`Retirado: ${nomeDoItem(item.product)}`)
    }
    for (const alterado of itens!.alterados) {
      const item = lista.find((i) => i.id === alterado.id)
      if (!item) continue
      const p = item.product
      const qtd = alterado.quantidade > 0 ? alterado.quantidade : p.qtd
      if (p.interno === alterado.interno && p.referencia === alterado.referencia && p.descricao === alterado.descricao && p.qtd === qtd) continue
      lista = lista.map((i) =>
        i.id === alterado.id ? { ...i, product: { ...p, interno: alterado.interno, referencia: alterado.referencia, descricao: alterado.descricao, qtd } } : i,
      )
      resumo.push(`Alterado: ${nomeDoItem(p)}${p.qtd !== qtd ? ` (quantidade ${p.qtd} → ${qtd})` : ''}`)
    }
    for (const adicionado of itens!.adicionados) {
      if (lista.some((i) => i.id === adicionado.id)) continue
      // a linha em branco do começo dá lugar ao item novo
      lista = [...lista.filter(temDados), itemNovo(adicionado, novoItem)]
      resumo.push(`Adicionado: ${nomeDoItem(adicionado)} (quantidade ${adicionado.quantidade || 1})`)
    }
  }
  return { items: lista.length > 0 ? lista : [novoItem()], alteracoes: pendentes.map((a) => a.id), doPedido: false, retirados, resumo }
}
