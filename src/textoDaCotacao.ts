import { formatCurrency } from './utils'
import type { ItemValorEnviado } from './types'

// A cotação em texto simples — pra mandar ao cliente pelo WhatsApp/e-mail sem anexar planilha. Os
// mesmos valores da planilha, item por item com marca e prazo: os da cotação aberta, na hora de enviar
// (EnvioCotacaoModal), ou os que a equipe enviou, na tela do vendedor (PlanilhaDoVendedor).

export interface DadosDoTexto {
  codigo: string
  cliente: string
  maquina: string
}

// o espaço fixo que o formatCurrency põe depois do "R$" vira espaço comum (alguns aplicativos mostram estranho)
const reais = (v: number) => formatCurrency(v).replace(/\s/g, ' ')

export function textoDaCotacao(c: DadosDoTexto, valores: { itens: ItemValorEnviado[]; total: number }): string {
  const linhas = [`COTAÇÃO ${c.codigo}`.trim()]
  if (c.cliente) linhas.push(`Cliente: ${c.cliente}`)
  if (c.maquina) linhas.push(`Máquina: ${c.maquina}`)
  // a linha em branco da precificação não vai
  const itens = valores.itens.filter((i) => i.referencia || i.descricao || i.valorTotal > 0)
  itens.forEach((i, n) => {
    linhas.push('', `${n + 1}. ${[i.referencia, i.descricao].filter(Boolean).join(' — ') || 'Item'}`)
    const marcaEPrazo = [i.marca && `Marca: ${i.marca}`, i.entrega && `Prazo: ${i.entrega}`].filter(Boolean).join(' | ')
    if (marcaEPrazo) linhas.push(`   ${marcaEPrazo}`)
    linhas.push(`   Qtd: ${i.quantidade} × ${reais(i.valorUnitario)} = ${reais(i.valorTotal)}`)
  })
  linhas.push('', `TOTAL: ${reais(valores.total)}`)
  return linhas.join('\n')
}

export function nomeDoTexto(c: DadosDoTexto): string {
  const nome = [c.codigo, c.cliente.trim(), c.maquina.trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `COTACAO - ${nome || 'cliente'}.txt`
}

const BOM = String.fromCharCode(0xfeff)

/** O arquivo .txt (com a marca de UTF-8 e quebra de linha do Windows: o Bloco de Notas abre com os acentos certos). */
export function arquivoDoTexto(texto: string): Blob {
  return new Blob([BOM + texto.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' })
}
