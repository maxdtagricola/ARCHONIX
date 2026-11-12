import { statusDe } from './statusConfig'

// paleta categórica fixa (8 tons validados) — mesma usada no gráfico do Dashboard
export const PALETA_CATEGORICA = [
  '#2a78d6', // azul
  '#eb6834', // laranja
  '#1baf7a', // água
  '#eda100', // amarelo
  '#e87ba4', // magenta
  '#008300', // verde
  '#4a3aa7', // violeta
  '#e34948', // vermelho
]
export const COR_OUTROS = '#c3c2b7'

// status do sistema que chegaram depois: cor própria, e não contam na posição dos outros — assim os que
// já existiam continuam com a cor de sempre
const COR_FIXA: Record<string, string> = { 'FATURADO PARCIALMENTE': '#008300' }

/** Cor padrão pra um status, pela posição dele numa lista — mesma paleta fixa pra todos os fluxos de status do app. */
export function corPadraoDoStatus(status: string, lista: readonly string[] = statusDe('cotacoes')): string {
  if (COR_FIXA[status]) return COR_FIXA[status]
  const indice = lista.filter((s) => !COR_FIXA[s]).indexOf(status)
  return PALETA_CATEGORICA[(indice === -1 ? 0 : indice) % PALETA_CATEGORICA.length]
}

/** Luminância relativa (WCAG) de uma cor hex — 0 (preto) a 1 (branco), já linearizando o sRGB. */
function luminanciaRelativa(hex: string): number {
  const linearizar = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const r = linearizar(parseInt(hex.slice(1, 3), 16) / 255)
  const g = linearizar(parseInt(hex.slice(3, 5), 16) / 255)
  const b = linearizar(parseInt(hex.slice(5, 7), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Escolhe texto preto ou branco pra contrastar com a cor de fundo — preto é o padrão (a maioria
 * dos tons da paleta é "média", nem clara nem escura de verdade, e preto lê melhor neles do que
 * parecia com o cálculo antigo, que era só uma aproximação grosseira de luminância); troca pra
 * branco só quando ele realmente ganha em contraste (fórmula de contraste do WCAG) — cores de
 * verdade escuras/saturadas, tipo o violeta ou o verde escuro da paleta. */
export function corTexto(hexFundo: string): string {
  const l = luminanciaRelativa(hexFundo)
  const contrastePreto = (l + 0.05) / 0.05
  const contrasteBranco = 1.05 / (l + 0.05)
  return contrastePreto >= contrasteBranco ? '#0b0b0b' : '#ffffff'
}
