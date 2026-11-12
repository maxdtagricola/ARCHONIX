import { formatarNumeroBR, parseNumeroFlexivel } from '../numeros'

// -----------------------------------------------------------------------
// Os números de uma linha de item do retorno do fornecedor e a conta que
// diz quais deles são o unitário e o total. A regra é uma só: vale o par que
// FECHA — unitário × quantidade = total (direto, ou com o desconto/imposto
// que está na mesma linha). Sem conta que feche, o valor ainda aparece, mas
// marcado pra conferir e desmarcado: é assim que o peso, a alíquota de IPI
// ou um dígito trocado pelo OCR deixam de entrar calados como preço.
//
// Casos dos retornos reais (pasta retornodefornecedor):
//  - preço com 3 a 5 casas: "19,55000" (NB), "1.361,0860" (NS), "331,590"
//    (REDEPARTS), "7,390 … 739,000" (COMMERSUL);
//  - total com o IPI somado: "1.868,05 … 2,60 … 1.916,62" (VENTUROSO, pela
//    alíquota) e "13,75 … 13,41 … 425,91" (CL BORRACHAS, pelo valor);
//  - desconto por item: "2.210,01  442,00  3.978,02" (PAMPA), e desconto que
//    nem aparece na linha: 2 × 134,83 com total 242,68 (ARADO, 10%);
//  - foto/print (OCR): vírgula que some ("1274335" = 12.743,35, "1853" =
//    18,53), ponto no lugar dela ("242.68"), centavos soltos ("6.004 40") e
//    dígito trocado (495,25 lido 455,25 — a conta não fecha e a linha avisa).
// -----------------------------------------------------------------------

export interface NumeroLido {
  valor: number
  /** Casas depois da vírgula como estava escrito (2 = jeito de dinheiro). */
  casas: number
  /** Só na leitura de imagem: número sem a vírgula (ou com ponto) que o OCR pode ter comido — só vale
   * se fechar a conta, nunca como palpite. */
  reparado?: boolean
}

export interface ValoresDaLinha {
  unitario?: number
  /** Valor dos produtos (unitário × quantidade), sem imposto somado. */
  total?: number
  /** A conta fechou (unitário × quantidade = total, direto ou com desconto/imposto da linha). */
  conferido: boolean
  /** Quantidade que o fornecedor atende, quando a conta fecha com outra que não a pedida. */
  quantidade?: number
  /** Desconto ou imposto achado na conta ("desconto de R$ 442,00", "IPI 2,6%"…). */
  observacao?: string
  /** Por que essa linha precisa ser conferida antes de entrar (nada fechou). */
  conferir?: string
}

const COM_VIRGULA = /^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,6}$/

function reais(valor: number): string {
  return `R$ ${formatarNumeroBR(valor, 2)}`
}

/** Limpa o que gruda nos números: "R$", "%", "|" das tabelas em texto, travessão que o OCR põe na frente. */
function pedacos(texto: string): string[] {
  return texto
    .replace(/R\$/gi, ' ')
    .replace(/[|%]/g, ' ')
    .split(/\s+/)
    .map((p) => p.replace(/^[—–\-*'"“”(]+(?=\d)/, '').replace(/(?<=\d)[*'"“”);:]+$/, ''))
    .filter(Boolean)
}

/** Os números com vírgula de um trecho, na ordem. `ocr`: recupera também os que a leitura de imagem
 * estragou (marcados como `reparado`). Zeros ficam de fora. */
export function numerosDaLinha(texto: string, ocr = false): NumeroLido[] {
  const lista: NumeroLido[] = []
  const ps = pedacos(texto)
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    if (COM_VIRGULA.test(p)) {
      const valor = parseNumeroFlexivel(p)
      if (valor !== undefined && valor > 0) lista.push({ valor, casas: p.length - p.indexOf(',') - 1 })
      continue
    }
    if (!ocr) continue
    // "6.004 40": os centavos se soltaram
    if (/^\d{1,3}(\.\d{3})+$/.test(p) && /^\d{2}$/.test(ps[i + 1] ?? '')) {
      lista.push({ valor: Number(p.replace(/\./g, '')) + Number(ps[i + 1]) / 100, casas: 2, reparado: true })
      i++
    } else if (/^\d+[./]0000$/.test(p)) {
      // quantidade com 4 casas: "2.0000", "1/0000"
      lista.push({ valor: Number(p.split(/[./]/)[0]), casas: 4, reparado: true })
    } else if (/^\d{1,6}\.\d{2}$/.test(p)) {
      // ponto no lugar da vírgula: "242.68"
      lista.push({ valor: Number(p), casas: 2, reparado: true })
    } else if (/^\d{3,7}$/.test(p)) {
      // a vírgula sumiu: "1340" = 13,40, "1274335" = 12.743,35
      lista.push({ valor: Number(p) / 100, casas: 2, reparado: true })
    }
  }
  return lista.filter((n) => n.valor > 0)
}

/** Inteiros soltos ("2", "3 UN", "2UN") e números redondos com vírgula ("10,0000", "2,00") — as
 * quantidades que a linha pode estar dizendo. */
export function quantidadesDaLinha(texto: string): number[] {
  const lista: number[] = []
  for (const p of pedacos(texto)) {
    const m = p.match(/^(\d{1,5})(?:,0{1,6})?(?:UN|UND|PC|PÇ|PCS|PR|CJ|JG|KIT)?$/i)
    if (m && Number(m[1]) > 0) lista.push(Number(m[1]))
  }
  return [...new Set(lista)]
}

/** Folga de arredondamento: o unitário vem com 2 casas, então até meio centavo por unidade. */
function fecha(unitario: number, quantidade: number, total: number): boolean {
  return Math.abs(unitario * quantidade - total) <= Math.max(0.02, 0.0051 * quantidade, total * 0.0005)
}

const arredonda = (v: number) => Math.round(v * 100) / 100

/**
 * Acha o unitário e o total entre os números da linha. `quantidade`: a que pedimos (0 = não sei).
 * `quantidadesNaLinha`: as que o fornecedor escreveu — se a conta só fecha com uma delas, é o que ele atende.
 */
export function resolverValores(numeros: NumeroLido[], quantidade: number, quantidadesNaLinha: number[] = []): ValoresDaLinha {
  const nums = numeros.filter((n) => n.valor > 0)
  if (nums.length === 0) return { conferido: false }
  const qtd = quantidade > 0 ? quantidade : 1
  /** A própria quantidade escrita como número ("10,0000", "2,00") não é preço. */
  const ehAQuantidade = (n: NumeroLido, q: number) => n.valor === q && (n.casas !== 2 || nums.filter((x) => x.valor === q).length === 1)

  // 1. unitário × quantidade pedida = total
  const direto = (q: number): [NumeroLido, NumeroLido] | undefined => {
    let melhor: [NumeroLido, NumeroLido] | undefined
    for (let i = 0; i < nums.length; i++) {
      if (ehAQuantidade(nums[i], q)) continue
      for (let j = 0; j < nums.length; j++) {
        if (i === j || !fecha(nums[i].valor, q, nums[j].valor)) continue
        // com quantidade 1 qualquer número repetido "fecha": vale o par de dinheiro (2 casas) que vier primeiro
        const par: [NumeroLido, NumeroLido] = [nums[i], nums[j]]
        const nota = (p: [NumeroLido, NumeroLido]) => Number(p[1].casas === 2 && !p[1].reparado) + Number(!p[0].reparado)
        if (!melhor || nota(par) > nota(melhor)) melhor = par
      }
    }
    return melhor
  }
  const comPedida = direto(qtd)
  if (comPedida) return { unitario: comPedida[0].valor, total: comPedida[1].valor, conferido: true }

  // 2. fecha com outra quantidade escrita na linha: é o que o fornecedor atende (menos ou mais que o pedido)
  for (const q of quantidadesNaLinha) {
    if (!(q > 0) || q === qtd) continue
    const par = direto(q)
    // o "unitário" não pode ser uma das quantidades da linha: 1,00 (a quantidade) × 12,00 (o ICMS %) = 12
    // não é preço nenhum (VENTUROSO)
    if (par && par[0].valor !== q && par[0].valor !== qtd && !quantidadesNaLinha.includes(par[0].valor)) {
      return { unitario: par[0].valor, total: par[1].valor, conferido: true, quantidade: q }
    }
  }

  // 3–6. a conta fecha com um terceiro número da linha: imposto somado ou desconto tirado, em valor ou em %
  for (const u of nums) {
    if (ehAQuantidade(u, qtd)) continue
    const bruto = u.valor * qtd
    for (const t of nums) {
      if (t === u || t.casas > 3) continue
      for (const v of nums) {
        if (v === u || v === t || v.reparado) continue
        const folga = Math.max(0.02, 0.0051 * qtd)
        if (v.valor < bruto && Math.abs(bruto + v.valor - t.valor) <= folga) {
          return { unitario: u.valor, total: arredonda(bruto), conferido: true, observacao: `imposto de ${reais(v.valor)} somado no total (${reais(t.valor)})` }
        }
        // desconto é a parte menor: 1.538,00 − 153,80 = 1.384,20 (e não 1.538,00 − 1.384,20 = 153,80)
        if (v.valor < t.valor && Math.abs(bruto - v.valor - t.valor) <= folga) {
          return { unitario: t.valor / qtd, total: t.valor, conferido: true, observacao: `desconto de ${reais(v.valor)} (tabela ${reais(u.valor)})` }
        }
        if (v.valor <= 35 && Math.abs(bruto * (1 + v.valor / 100) - t.valor) <= folga) {
          return {
            unitario: u.valor,
            total: arredonda(bruto),
            conferido: true,
            observacao: `IPI ${formatarNumeroBR(v.valor, 2).replace(/,?0+$/, '')}% somado no total (${reais(t.valor)})`,
          }
        }
        if (v.valor <= 60 && Math.abs(bruto * (1 - v.valor / 100) - t.valor) <= folga) {
          return { unitario: t.valor / qtd, total: t.valor, conferido: true, observacao: `desconto de ${formatarNumeroBR(v.valor, 2).replace(/,?0+$/, '')}% (tabela ${reais(u.valor)})` }
        }
      }
    }
  }

  // nada fechou — o que vier daqui é palpite, e a linha vai marcada pra conferir
  const firmes = nums.filter((n) => !n.reparado)
  const dinheiro = firmes.filter((n) => n.casas === 2)
  let candidatos = dinheiro.length > 0 ? dinheiro : firmes.length > 0 ? firmes : nums
  if (candidatos.length >= 2 && quantidade > 0 && candidatos[0].valor === quantidade) candidatos = candidatos.slice(1)
  // um valor só: é o unitário, e não tem com o que conferir
  if (candidatos.length === 1 && nums.filter((n) => !ehAQuantidade(n, qtd)).length === 1) {
    return { unitario: candidatos[0].valor, total: qtd === 1 ? candidatos[0].valor : undefined, conferido: false }
  }

  // o par mais perto de fechar (até 60% de diferença pra baixo: desconto; 15% pra qualquer lado: dígito trocado)
  let perto: { u: NumeroLido; t: NumeroLido; erro: number } | undefined
  for (const u of nums) {
    if (ehAQuantidade(u, qtd)) continue
    for (const t of nums) {
      if (t === u || t.valor <= 0) continue
      if (qtd === 1 && (u.reparado || t.reparado)) continue
      const erro = (u.valor * qtd - t.valor) / t.valor
      if (Math.abs(erro) < 0.0005 || erro < -0.15 || erro > 1.5) continue
      if (!perto || Math.abs(erro) < Math.abs(perto.erro)) perto = { u, t, erro }
    }
  }
  if (perto && qtd > 1) {
    const bruto = perto.u.valor * qtd
    const pct = (1 - perto.t.valor / bruto) * 100
    // desconto "redondo" (5%, 10%, 12,5%…) que não aparece na linha
    if (pct >= 1 && pct <= 60 && Math.abs(pct * 2 - Math.round(pct * 2)) < 0.02) {
      const texto = formatarNumeroBR(Math.round(pct * 2) / 2, 1).replace(',0', '')
      return {
        unitario: perto.t.valor / qtd,
        total: perto.t.valor,
        conferido: false,
        observacao: `desconto de ${texto}% (tabela ${reais(perto.u.valor)})`,
        conferir: `o total (${reais(perto.t.valor)}) é ${texto}% menor que ${formatarNumeroBR(qtd, 0)} × ${reais(perto.u.valor)} — parece desconto; confira`,
      }
    }
    if (Math.abs(perto.erro) <= 0.15) {
      return {
        unitario: perto.u.valor,
        total: perto.t.valor,
        conferido: false,
        conferir: `${formatarNumeroBR(qtd, 0)} × ${reais(perto.u.valor)} = ${reais(bruto)}, mas o total lido é ${reais(perto.t.valor)} — confira os valores`,
      }
    }
  }
  const [unitario, ...resto] = candidatos
  const total = resto.find((v) => v.valor >= unitario.valor)
  return {
    unitario: unitario.valor,
    total: total?.valor,
    conferido: false,
    conferir: 'vários valores na linha e nenhum fecha com a quantidade — confira qual é o unitário',
  }
}
