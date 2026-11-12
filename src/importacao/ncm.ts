// -----------------------------------------------------------------------
// NCM lido de arquivos (cotação de fornecedor): 8 dígitos, com ou sem os
// pontos (8433.90.90 / 84339090), e o capítulo (2 primeiros dígitos) entre
// 01 e 97 — fora disso não é NCM, é outro número qualquer da linha. Melhor
// ficar sem NCM do que gravar um errado: ele muda o cálculo de ICMS-ST/RBC.
// -----------------------------------------------------------------------

/** Troca letras que o OCR costuma confundir com dígitos (só usado em leitura de imagem). */
function digitosDoOcr(texto: string): string {
  return texto.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/Z/g, '2')
}

/** NCM no formato da tela (0000.00.00), ou undefined se o texto não for um NCM válido. */
export function normalizarNcm(texto: string, opcoes: { ocr?: boolean } = {}): string | undefined {
  let t = String(texto ?? '').trim()
  if (opcoes.ocr) t = digitosDoOcr(t)
  if (!/^[\d.\s-]+$/.test(t)) return undefined
  const digitos = t.replace(/\D/g, '')
  if (digitos.length !== 8) return undefined
  const capitulo = Number(digitos.slice(0, 2))
  if (capitulo < 1 || capitulo > 97) return undefined
  return `${digitos.slice(0, 4)}.${digitos.slice(4, 6)}.${digitos.slice(6)}`
}

/** NCM escrito com os pontos no lugar certo (0000.00.00) — esse formato quase só aparece pra NCM. */
const NCM_COM_PONTOS = /^\d{4}\.\d{2}\.\d{2}$/

/**
 * Procura um NCM entre as palavras de uma linha (PDF/OCR), pulando as que são a própria referência
 * do item. Sem pontos ("84339090") só vale quando o documento fala em NCM em algum lugar (título da
 * coluna) — senão, um número de 8 dígitos qualquer (código, data sem barras…) viraria NCM.
 */
export function acharNcmNasPalavras(
  palavras: string[],
  opcoes: { ignorar?: [number, number]; aceitaSemPontos: boolean; ocr?: boolean },
): string | undefined {
  let semPontos: string | undefined
  for (let i = 0; i < palavras.length; i++) {
    if (opcoes.ignorar && i >= opcoes.ignorar[0] && i < opcoes.ignorar[1]) continue
    // tira pontuação das pontas e o rótulo colado ("NCM:8708.99.90", "(8708.99.90)")
    const palavra = palavras[i].replace(/^NCM[:\s-]*/i, '').replace(/^[^\dA-Z]+|[^\dA-Z]+$/gi, '')
    const candidato = opcoes.ocr ? digitosDoOcr(palavra) : palavra
    if (NCM_COM_PONTOS.test(candidato)) {
      const ncm = normalizarNcm(candidato)
      if (ncm) return ncm
    } else if (!semPontos && opcoes.aceitaSemPontos && /^\d{8}$/.test(candidato)) {
      semPontos = normalizarNcm(candidato)
    }
  }
  return semPontos
}

/** O documento fala em NCM (ou classificação fiscal) em algum lugar — normalmente o título da coluna. */
export function documentoMencionaNcm(texto: string): boolean {
  // NBM: o nome antigo do NCM, que alguns sistemas ainda usam no título da coluna (CRUZ ATACADISTA)
  return /\bNCM\b|\bNBM\b|CLASSIF\S*\s*FISCAL/i.test(texto)
}
