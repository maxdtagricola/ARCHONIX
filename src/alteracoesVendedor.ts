import type { AlteracaoVendedor, QuoteRecord } from './types'

// Avisos das alterações que o vendedor faz nas cotações dele (o servidor grava cada uma em
// `alteracoesVendedor`, com quem estava com a cotação na hora em `para`). O aviso é pra quem estava
// cotando; com a cotação ainda sem ninguém (PENDENTE), pra todo mundo que vê as cotações.

/** Os avisos dessa cotação que essa pessoa (nome no app) ainda não viu. */
export function alteracoesNaoVistas(r: Pick<QuoteRecord, 'alteracoesVendedor'>, nome: string): AlteracaoVendedor[] {
  return (r.alteracoesVendedor ?? []).filter((a) => !(a.vistaPor ?? []).includes(nome) && (!a.para || a.para === nome))
}

/** "Cliente, Item adicionado (2)" — os campos que mudaram, juntando os repetidos. */
export function resumoDosCampos(alteracoes: AlteracaoVendedor[]): string {
  const contagem = new Map<string, number>()
  for (const a of alteracoes) {
    for (const c of a.campos) {
      const campo = c.campo.startsWith('Item ') && c.campo !== 'Item adicionado' && c.campo !== 'Item retirado' ? 'Item alterado' : c.campo
      contagem.set(campo, (contagem.get(campo) ?? 0) + 1)
    }
  }
  return Array.from(contagem.entries())
    .map(([campo, n]) => (n > 1 ? `${campo} (${n})` : campo))
    .join(', ')
}
