// Itens a partir de texto solto — o que sai do OCR de uma foto/print, de um PDF ou de uma mensagem
// colada (WhatsApp, e-mail). Cada linha vira, no máximo, um item: o código (a "palavra" com número,
// como RE504836, 51516-11198 ou 16X4.5X80), a quantidade ("2x", "2 un", "qtd 2", "(2)", um número no
// fim) e o resto como descrição. É um palpite: o vendedor confere a lista antes de salvar.

export interface ItemLido {
  referencia: string
  descricao: string
  quantidade: number
}

const MAX_ITENS = 300
const UNIDADE = String.raw`(?:UN|UND|UNID|UNIDADES?|PC|PCS|PÇ|PÇS|PECAS?|PEÇAS?|CX|CXS|KG|JG|JOGOS?|KITS?|MTS?|LTS?|PARES|PAR|CJ|CONJ)\.?`
const NUMERO = String.raw`(\d{1,5}(?:[.,]\d{1,3})?)`

// mensagem de WhatsApp: "[10/11 14:32] Fulano: …" ou "10/11/2026 14:32 - Fulano: …"
const PREFIXO_WHATSAPP = /^\[?\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?[^:\d]{1,40}:\s*/
const MARCADOR = /^[-•*·–—>]+\s*/
const NUMERACAO = /^\d{1,3}[.)]\s+/
// linhas que são cabeçalho, rodapé ou conversa, não item
const NAO_E_ITEM = /^(TOTAL|SUB ?TOTAL|CLIENTE|TELEFONE|FONE|CELULAR|CNPJ|CPF|E-?MAIL|DATA|VALIDADE|ENDERE[CÇ]O|CIDADE|VENDEDOR|CONDI[CÇ][AÃ]O|PAGAMENTO|FRETE|OBS)\b/i
const CABECALHO = /\b(DESCRI[CÇ][AÃ]O|DESCRICAO)\b.*\b(QTD|QTDE|QUANT|QUANTIDADE)\b|\b(QTD|QTDE|QUANT|QUANTIDADE)\b.*\b(DESCRI[CÇ][AÃ]O|DESCRICAO)\b/i
// (fim da palavra sem \b, que não entende acento)
const CONVERSA = /\b(?:BOM DIA|BOA TARDE|BOA NOITE|OL[AÁ]|OI|OBRIGAD\w*|VALEU|POR FAVOR|PRECIS\w*|OR[CÇ]AMENTO|COTA[CÇ][AÃ]O|AGUARD\w*|SEGUE|ABRA[CÇ]OS?)(?![A-Za-zÀ-ú])/i
const ROTULO_CODIGO = /\b(?:REF(?:ER[EÊ]NCIA)?|C[OÓ]D(?:IGO)?|PART ?NUMBER|PN)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9.\-/]*)/i

const paraNumero = (texto: string) => Number(texto.replace(',', '.'))

/** A "palavra" parece um código de peça? (tem número e não é preço, data nem quantidade solta) */
function pareceCodigo(palavra: string): boolean {
  const p = palavra.replace(/[,;:]+$/, '')
  if (p.length < 3 || !/\d/.test(p) || !/^[A-Z0-9][A-Z0-9.\-/]*$/i.test(p)) return false
  if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(p)) return false // data
  if (/^\d{1,4}$/.test(p)) return false // número pequeno: quantidade, não código
  return true
}

/** A quantidade da linha e a linha sem ela. */
function tirarQuantidade(linha: string): { quantidade?: number; resto: string } {
  const padroes: RegExp[] = [
    new RegExp(String.raw`\b(?:QTD|QTDE|QUANT|QUANTIDADE)\.?\s*[:=-]?\s*${NUMERO}\s*(?:${UNIDADE})?`, 'i'),
    new RegExp(String.raw`^${NUMERO}\s*[xX×]\s+`),
    new RegExp(String.raw`^${NUMERO}\s*${UNIDADE}\s+`, 'i'),
    new RegExp(String.raw`\s[xX×]\s*${NUMERO}\s*(?:${UNIDADE})?$`, 'i'),
    new RegExp(String.raw`\(\s*${NUMERO}\s*(?:${UNIDADE})?\s*\)\s*$`, 'i'),
    new RegExp(String.raw`[\s\-–]${NUMERO}\s*${UNIDADE}$`, 'i'),
  ]
  for (const padrao of padroes) {
    const m = padrao.exec(linha)
    if (m) return { quantidade: paraNumero(m[1]), resto: (linha.slice(0, m.index) + ' ' + linha.slice(m.index + m[0].length)).trim() }
  }
  // "02 - FILTRO…": no começo, com traço, é a quantidade
  const comTraco = /^(\d{1,4})\s*[-–]\s+/.exec(linha)
  if (comTraco) return { quantidade: Number(comTraco[1]), resto: linha.slice(comTraco[0].length) }
  // um número pequeno sozinho no fim ("FILTRO RE504836 2")
  const noFim = /\s(\d{1,4})$/.exec(linha)
  if (noFim) return { quantidade: Number(noFim[1]), resto: linha.slice(0, noFim.index) }
  return { resto: linha }
}

/** Um item da linha, ou nada (linha vazia, cabeçalho, conversa). */
export function itemDaLinha(bruta: string): ItemLido | undefined {
  let linha = bruta.replace(/\s+/g, ' ').trim().replace(PREFIXO_WHATSAPP, '').replace(MARCADOR, '').trim()
  if (linha.length < 3 || NAO_E_ITEM.test(linha) || CABECALHO.test(linha) || /:\s*$/.test(linha)) return undefined
  // preço na linha (R$ 10,00) não é quantidade nem código
  linha = linha.replace(/R\$\s*[\d.]+(?:,\d{2})?/gi, ' ').replace(/\s+/g, ' ').trim()

  const { quantidade, resto } = tirarQuantidade(linha)
  // a numeração do item ("1. ", "3) ", ou "1 " numa linha de tabela) sai quando a quantidade estava
  // em outro lugar
  let texto = quantidade !== undefined ? resto.replace(NUMERACAO, '').replace(/^\d{1,3}\s+(?=\S)/, '') : resto
  if (quantidade === undefined && NUMERACAO.test(texto)) texto = texto.replace(NUMERACAO, '')

  let referencia = ''
  const rotulado = ROTULO_CODIGO.exec(texto)
  if (rotulado && /\d/.test(rotulado[1])) {
    referencia = rotulado[1]
    texto = (texto.slice(0, rotulado.index) + ' ' + texto.slice(rotulado.index + rotulado[0].length)).trim()
  } else {
    const palavras = texto.split(' ')
    const i = palavras.findIndex(pareceCodigo)
    if (i >= 0) {
      referencia = palavras[i].replace(/[,;:]+$/, '')
      palavras.splice(i, 1)
      texto = palavras.join(' ')
    }
  }
  const descricao = texto
    .replace(new RegExp(String.raw`\b${UNIDADE}$`, 'i'), '')
    .replace(/^[\s\-–:;,.]+|[\s\-–:;,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // sem código e sem quantidade dita, frase de conversa não é item
  if (!referencia && quantidade === undefined && CONVERSA.test(descricao)) return undefined
  if (!referencia && !/[A-Za-zÀ-ú]{3,}/.test(descricao)) return undefined
  const qtd = quantidade !== undefined && Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 1
  return { referencia: referencia.toUpperCase(), descricao: descricao.toUpperCase(), quantidade: qtd }
}

/** Os itens de um texto (uma linha por item). */
export function itensDoTexto(texto: string): ItemLido[] {
  const itens: ItemLido[] = []
  for (const linha of texto.split(/\r?\n/)) {
    const item = itemDaLinha(linha)
    if (item) itens.push(item)
    if (itens.length >= MAX_ITENS) break
  }
  return itens
}
