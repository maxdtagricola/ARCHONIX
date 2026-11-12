import { normalizarReferencia, referenciaTolerante } from './referencias'

// -----------------------------------------------------------------------
// O código que pedimos × o código que o fornecedor devolveu. Raramente vem
// idêntico: cada fornecedor escreve do seu jeito, e é isso que essas regras
// reconhecem (padrões vistos nos retornos de INGÁ, MG, TOLEAGRI, SOLUS,
// CAMBUCI, MINAS e REDEPARTS):
//  - separadores e espaços: "GE40 KRRB" = "GE40KRRB";
//  - marca colada no código: "AH170744INA", "JD9268 FAG", "JD10384 PEER",
//    "HXE16927 GA" — a marca vai pra cotação;
//  - sufixo de variação/linha do fornecedor: "AH219846N", "6210523M1",
//    "GE40KRRB/1", "GE25KRRB/205";
//  - códigos alternativos separados por barra: "AH216678/H215532",
//    "H215004/H142141" — qualquer um deles pode ser o nosso;
//  - zeros à esquerda: "068344" = "68344";
//  - um caractere diferente (digitação nossa ou do fornecedor): "M161581" ×
//    "H161581" — esse só vira sugestão, sem marcar sozinho.
// -----------------------------------------------------------------------

/** Do mais confiável pro menos: igual, um dos códigos alternativos, o nosso com algo a mais (marca,
 * sufixo, zeros), e diferente em um caractere só. */
export type TipoCasamento = 'exato' | 'alternativo' | 'variacao' | 'proximo'

export const ORDEM_CASAMENTO: Record<TipoCasamento, number> = { exato: 0, alternativo: 1, variacao: 2, proximo: 3 }

export interface CasamentoCodigo {
  tipo: TipoCasamento
  /** Marca que veio colada no código (rolamento INA, FAG, PEER…). */
  marca?: string
  /** O que muda do nosso código pro dele ("sufixo N", "variação /1"…) — pra mostrar na revisão. */
  detalhe?: string
}

/** Marcas que os fornecedores colam no código do item. */
const MARCAS_NO_CODIGO = ['INA', 'NSK', 'FAG', 'PEER', 'SKF', 'TIMKEN', 'KOYO', 'NTN', 'ZEN', 'GA', 'GATES', 'SABO', 'CORTECO', 'NAK', 'IKO', 'DAYCO', 'URB', 'ZKL']

/** Sufixo de até 4 caracteres (ou uma marca conhecida) colado no fim do código. */
const SUFIXO_MAXIMO = 4
/** Código curto demais casa por acaso com qualquer coisa — sufixo/prefixo só a partir disso. */
const BASE_MINIMA = 5

function marcaDoSufixo(sufixo: string): string | undefined {
  return MARCAS_NO_CODIGO.includes(sufixo) ? sufixo : undefined
}

/** Dígito colado em código que termina em dígito é outro número de peça (H20172 × H201727), não sufixo. */
function sufixoValido(base: string, sufixo: string): boolean {
  return !(/^\d/.test(sufixo) && /\d$/.test(base))
}

/** Compara um pedaço (sem barra) do código do fornecedor com o nosso, já normalizados. */
function compararNormalizados(nosso: string, dele: string): CasamentoCodigo | undefined {
  if (!nosso || !dele) return undefined
  if (nosso === dele) return { tipo: 'exato' }
  if (nosso.length >= BASE_MINIMA && dele.startsWith(nosso)) {
    const sufixo = dele.slice(nosso.length)
    const marca = marcaDoSufixo(sufixo)
    if (marca || (sufixo.length <= SUFIXO_MAXIMO && sufixoValido(nosso, sufixo))) {
      return { tipo: 'variacao', marca, detalhe: marca ? `marca ${marca}` : `sufixo ${sufixo}` }
    }
  }
  if (dele.length >= BASE_MINIMA && nosso.startsWith(dele)) {
    const sobra = nosso.slice(dele.length)
    if (sobra.length <= SUFIXO_MAXIMO && sufixoValido(dele, sobra)) return { tipo: 'variacao', detalhe: `sem o ${sobra}` }
  }
  if (/^0/.test(nosso + dele) && nosso.replace(/^0+/, '') === dele.replace(/^0+/, '') && nosso.replace(/^0+/, '').length >= 4) {
    return { tipo: 'variacao', detalhe: 'zeros à esquerda' }
  }
  return undefined
}

/** Um caractere trocado, a mais ou a menos — só em códigos de tamanho razoável. */
function diferencaDeUmCaractere(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  const [maior, menor] = a.length > b.length ? [a, b] : [b, a]
  return maior.slice(i + 1) === menor.slice(i)
}

/** Compara o código que pedimos com um código escrito pelo fornecedor (pode ter barra, espaço, marca
 * colada…). `ocr`: tolera as trocas típicas de leitura de imagem (O/0, I/1, S/5…). */
export function compararCodigo(nosso: string, dele: string, ocr = false): CasamentoCodigo | undefined {
  const forma = ocr ? referenciaTolerante : normalizarReferencia
  const n = forma(nosso)
  if (n.length < 3) return undefined

  // "AH216678/H215532" (alternativos) e "GE40KRRB/1" (o código e a variação dele)
  const pedacos = dele.split('/').map((p) => forma(p)).filter(Boolean)
  const longos = pedacos.filter((p) => p.length >= 4)
  if (pedacos.length > 1) {
    for (const p of longos) {
      const c = compararNormalizados(n, p)
      if (!c) continue
      if (c.tipo === 'exato' && longos.length === 1) {
        const variacao = pedacos.filter((x) => x !== p).join('/')
        return { tipo: 'variacao', detalhe: `variação /${variacao}` }
      }
      return c.tipo === 'exato' ? { tipo: 'alternativo', detalhe: `um dos códigos (${dele.trim()})` } : c
    }
  }

  // código com espaço ("GE40 KRRB", "JD9268 FAG"): junta tudo
  const junto = forma(dele)
  const direto = compararNormalizados(n, junto)
  if (direto) return direto
  return undefined
}

/** Diferença de um caractere entre o nosso código e o do fornecedor — só como sugestão (pode ser
 * outra peça: HXE27047 × HXE27048). */
export function codigoProximo(nosso: string, dele: string, ocr = false): CasamentoCodigo | undefined {
  // na foto, O/0, S/5… já contam como a mesma letra: "ACVWO410880" fica a um caractere de "ACW0410880"
  const forma = ocr ? referenciaTolerante : normalizarReferencia
  const n = forma(nosso)
  for (const pedaco of dele.split('/')) {
    const d = forma(pedaco)
    if (n !== d && diferencaDeUmCaractere(n, d)) return { tipo: 'proximo', detalhe: `um caractere diferente (${pedaco.trim()})` }
  }
  return undefined
}

/** Código com o prefixo do fornecedor separado por hífen ("01-859058" da CRUZ ATACADISTA: o 01 é a marca
 * no sistema dele) — o nosso é o que vem depois do hífen. Só com prefixo curto e base de tamanho razoável,
 * pra não confundir com código que tem hífen de verdade ("KK-45376"). */
export function codigoComPrefixo(nosso: string, dele: string): CasamentoCodigo | undefined {
  const m = dele.trim().match(/^([A-Z0-9]{1,3})-(.+)$/i)
  if (!m) return undefined
  const base = normalizarReferencia(m[2])
  if (base.length < 5 || base !== normalizarReferencia(nosso)) return undefined
  return { tipo: 'variacao', detalhe: `prefixo ${m[1]}-` }
}
