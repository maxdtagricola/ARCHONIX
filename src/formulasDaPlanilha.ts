import * as XLSX from 'xlsx'

// As fórmulas da planilha do cliente, refeitas no site depois de preencher: o arquivo guarda, em cada
// célula com fórmula, o último resultado — e é ele que a prévia mostra, enquanto o Excel refaz a conta ao
// abrir. Sem refazer aqui, a prévia ficava com o resultado antigo (o total geral somava ainda o total que
// o cliente tinha guardado) ou com o total calculado pelo site, diferente da conta da planilha (o
// unitário arredondado na célula × a quantidade dela). Dá conta do que essas planilhas usam: números,
// células, + − × ÷ ^, parênteses, SOMA/SUM e ARRED/ROUND. Fórmula com outra coisa fica como veio.

type Token = { tipo: 'num'; valor: number } | { tipo: 'ref'; linha: number; coluna: number } | { tipo: 'nome'; valor: string } | { tipo: 'op'; valor: string }

const REF = /^\$?([A-Z]{1,3})\$?(\d+)/
const NUM = /^\d+(\.\d+)?([eE][+-]?\d+)?/
const NOME = /^[A-Z][A-Z0-9._]*(?=\s*\()/

function colunaDaLetra(letras: string): number {
  let n = 0
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64)
  return n
}

function tokens(formula: string): Token[] {
  const saida: Token[] = []
  let resto = formula.trim().replace(/^=/, '').toUpperCase()
  while (resto.length > 0) {
    if (/^\s/.test(resto)) {
      resto = resto.trimStart()
      continue
    }
    const nome = NOME.exec(resto)
    if (nome) {
      saida.push({ tipo: 'nome', valor: nome[0] })
      resto = resto.slice(nome[0].length)
      continue
    }
    const ref = REF.exec(resto)
    if (ref) {
      saida.push({ tipo: 'ref', linha: Number(ref[2]), coluna: colunaDaLetra(ref[1]) })
      resto = resto.slice(ref[0].length)
      continue
    }
    const num = NUM.exec(resto)
    if (num) {
      saida.push({ tipo: 'num', valor: Number(num[0]) })
      resto = resto.slice(num[0].length)
      continue
    }
    if ('+-*/^(),:;'.includes(resto[0])) {
      saida.push({ tipo: 'op', valor: resto[0] === ';' ? ',' : resto[0] })
      resto = resto.slice(1)
      continue
    }
    // texto, outra aba, nome definido…: não é com a gente
    throw new Error('fórmula não suportada')
  }
  return saida
}

/** O valor de uma célula numa conta: número; texto com número ("5") também vale, como no Excel. */
function numeroDaCelula(ws: XLSX.WorkSheet, linha: number, coluna: number, emIntervalo: boolean): number {
  const cell = ws[XLSX.utils.encode_cell({ r: linha - 1, c: coluna - 1 })] as XLSX.CellObject | undefined
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return 0
  if (typeof cell.v === 'number') return cell.v
  if (typeof cell.v === 'boolean') return emIntervalo ? 0 : Number(cell.v)
  // num intervalo (SOMA), texto não conta; numa conta direta, texto numérico vira número
  if (emIntervalo) return 0
  const n = Number(String(cell.v).trim().replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error('#VALOR!')
  return n
}

/** Resultado da fórmula com os valores que estão agora na aba — undefined se ela usa algo fora do que a
 * gente refaz (aí a célula fica com o resultado que já tinha). */
export function avaliarFormula(ws: XLSX.WorkSheet, formula: string): number | undefined {
  let lista: Token[]
  try {
    lista = tokens(formula)
  } catch {
    return undefined
  }
  let i = 0
  const olhar = () => lista[i]
  const ehOp = (v: string) => olhar()?.tipo === 'op' && (olhar() as { valor: string }).valor === v
  const esperar = (v: string) => {
    if (!ehOp(v)) throw new Error('sintaxe')
    i++
  }

  // argumento de função: intervalo (A1:B9) vira a lista dos números dele; o resto, uma expressão
  function argumento(): number[] {
    const t = olhar()
    const depois = lista[i + 1]
    if (t?.tipo === 'ref' && depois?.tipo === 'op' && depois.valor === ':') {
      const fim = lista[i + 2]
      if (fim?.tipo !== 'ref') throw new Error('sintaxe')
      i += 3
      const valores: number[] = []
      for (let r = Math.min(t.linha, fim.linha); r <= Math.max(t.linha, fim.linha); r++) {
        for (let c = Math.min(t.coluna, fim.coluna); c <= Math.max(t.coluna, fim.coluna); c++) valores.push(numeroDaCelula(ws, r, c, true))
      }
      return valores
    }
    return [expressao()]
  }

  function funcao(nome: string): number {
    esperar('(')
    const args: number[][] = []
    if (!ehOp(')')) {
      args.push(argumento())
      while (ehOp(',')) {
        i++
        args.push(argumento())
      }
    }
    esperar(')')
    if (nome === 'SUM' || nome === 'SOMA') return args.flat().reduce((s, v) => s + v, 0)
    if (nome === 'ROUND' || nome === 'ARRED') {
      const [x, casas] = [args[0]?.[0] ?? 0, args[1]?.[0] ?? 0]
      const f = 10 ** casas
      return Math.round(x * f + Math.sign(x) * 1e-9) / f
    }
    throw new Error('função não suportada')
  }

  function primario(): number {
    const t = olhar()
    if (!t) throw new Error('sintaxe')
    if (t.tipo === 'num') {
      i++
      return t.valor
    }
    if (t.tipo === 'ref') {
      i++
      return numeroDaCelula(ws, t.linha, t.coluna, false)
    }
    if (t.tipo === 'nome') {
      i++
      return funcao(t.valor.replace(/^_XLFN\./, ''))
    }
    if (ehOp('(')) {
      i++
      const v = expressao()
      esperar(')')
      return v
    }
    throw new Error('sintaxe')
  }
  function unario(): number {
    if (ehOp('-')) {
      i++
      return -unario()
    }
    if (ehOp('+')) {
      i++
      return unario()
    }
    return primario()
  }
  function potencia(): number {
    let v = unario()
    while (ehOp('^')) {
      i++
      v = v ** unario()
    }
    return v
  }
  function termo(): number {
    let v = potencia()
    while (ehOp('*') || ehOp('/')) {
      const op = (olhar() as { valor: string }).valor
      i++
      const d = potencia()
      if (op === '/' && d === 0) throw new Error('#DIV/0!')
      v = op === '*' ? v * d : v / d
    }
    return v
  }
  function expressao(): number {
    let v = termo()
    while (ehOp('+') || ehOp('-')) {
      const op = (olhar() as { valor: string }).valor
      i++
      const d = termo()
      v = op === '+' ? v + d : v - d
    }
    return v
  }

  try {
    const v = expressao()
    if (i !== lista.length || !Number.isFinite(v)) return undefined
    return v
  } catch {
    return undefined
  }
}

/** As fórmulas da aba como vieram do arquivo (o site troca o objeto da célula ao escrever nela). */
export function formulasDaAba(ws: XLSX.WorkSheet): Map<string, { linha: number; coluna: number; formula: string }> {
  const mapa = new Map<string, { linha: number; coluna: number; formula: string }>()
  for (const [endereco, cell] of Object.entries(ws)) {
    if (endereco.startsWith('!')) continue
    const f = (cell as XLSX.CellObject).f
    if (!f) continue
    const { r, c } = XLSX.utils.decode_cell(endereco)
    mapa.set(endereco, { linha: r + 1, coluna: c + 1, formula: f })
  }
  return mapa
}

/** Refaz as fórmulas (as de linha antes das de intervalo, que somam as outras) e chama `gravar` com o
 * resultado novo de cada uma que mudou. */
export function refazerFormulas(
  ws: XLSX.WorkSheet,
  formulas: Map<string, { linha: number; coluna: number; formula: string }>,
  gravar: (linha: number, coluna: number, valor: number) => void,
): void {
  const ordem = [...formulas.values()].sort((a, b) => Number(a.formula.includes(':')) - Number(b.formula.includes(':')) || a.linha - b.linha)
  // algumas voltas, pra fórmula que depende de outra (a soma das linhas, um desconto sobre a soma…)
  for (let volta = 0; volta < 3; volta++) {
    let mudou = false
    for (const { linha, coluna, formula } of ordem) {
      const v = avaliarFormula(ws, formula)
      if (v === undefined) continue
      const endereco = XLSX.utils.encode_cell({ r: linha - 1, c: coluna - 1 })
      const atual = (ws[endereco] as XLSX.CellObject | undefined)?.v
      if (typeof atual === 'number' && Math.abs(atual - v) < 1e-9) continue
      // o objeto novo continua com a fórmula, pra quem ler a aba depois
      ws[endereco] = { t: 'n', v, f: formula }
      gravar(linha, coluna, v)
      mudou = true
    }
    if (!mudou) break
  }
}
