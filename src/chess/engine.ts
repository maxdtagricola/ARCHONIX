import { Chess } from 'chess.js'
import { buscarNoLivro, chavePosicao, type LivroDeAberturas } from './pgnBook'
import { buscarAprendizado, type LanceAprendido } from '../db/xadrezAprendizadoRepo'

// valores em centésimos de peão (centipawns) — convenção padrão, casa com as tabelas de posição abaixo
const VALOR_PECA: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

// ---------------------------------------------------------------------------
// Tabelas de posição por peça (avaliação simplificada — valores clássicos de
// "piece-square tables") — recompensam casas tipicamente fortes pra cada peça
// (peões avançados e no centro, cavalos centralizados, rei protegido no início
// do jogo etc.), do ponto de vista das brancas. Pras pretas, a tabela é usada
// espelhada verticalmente.
// ---------------------------------------------------------------------------
const PST_PEAO = [
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
]
const PST_CAVALO = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15,
  20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
]
const PST_BISPO = [
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10,
  5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10,
  -10, -10, -10, -10, -10, -20,
]
const PST_TORRE = [
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0,
  0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
]
const PST_DAMA = [
  -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0,
  -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10,
  -10, -20,
]
const PST_REI_MEIO = [
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
  -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20,
  -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
]

const PST: Record<string, number[]> = { p: PST_PEAO, n: PST_CAVALO, b: PST_BISPO, r: PST_TORRE, q: PST_DAMA, k: PST_REI_MEIO }

function indiceCasa(square: string, cor: 'w' | 'b'): number {
  const coluna = square.charCodeAt(0) - 97
  const linha = 8 - parseInt(square[1], 10)
  const indice = linha * 8 + coluna
  return cor === 'w' ? indice : 63 - indice
}

/** Avalia a posição (material + tabelas de posição + mobilidade) do ponto de vista das brancas. */
function avaliarPosicao(chess: Chess): number {
  let pontos = 0
  for (const linha of chess.board()) {
    for (const casa of linha) {
      if (!casa) continue
      const valorBase = VALOR_PECA[casa.type] ?? 0
      const tabela = PST[casa.type]
      const bonus = tabela ? tabela[indiceCasa(casa.square, casa.color)] : 0
      const total = valorBase + bonus
      pontos += casa.color === 'w' ? total : -total
    }
  }
  // mobilidade — quem tem mais lances disponíveis tende a estar com a posição mais ativa
  const mobilidade = chess.moves().length
  pontos += chess.turn() === 'w' ? mobilidade * 2 : -mobilidade * 2
  return pontos
}

/** Ordena lances com capturas primeiro (as mais vantajosas antes) — melhora muito a poda alfa-beta. */
function ordenarLances(chess: Chess): string[] {
  return chess
    .moves({ verbose: true })
    .sort((a, b) => {
      const valorA = a.captured ? (VALOR_PECA[a.captured] ?? 0) - (VALOR_PECA[a.piece] ?? 0) / 10 : -1
      const valorB = b.captured ? (VALOR_PECA[b.captured] ?? 0) - (VALOR_PECA[b.piece] ?? 0) / 10 : -1
      return valorB - valorA
    })
    .map((m) => m.san)
}

interface OrcamentoBusca {
  fim: number
}

/** Busca negamax com poda alfa-beta, limitada por um orçamento de tempo (aprofundamento iterativo). */
function negamax(chess: Chess, profundidade: number, alfa: number, beta: number, sinal: 1 | -1, orcamento: OrcamentoBusca): number {
  if (chess.isCheckmate()) return sinal * (-100000 - profundidade)
  if (chess.isDraw() || chess.isStalemate()) return 0
  if (profundidade === 0 || performance.now() > orcamento.fim) return sinal * avaliarPosicao(chess)

  let melhor = -Infinity
  for (const san of ordenarLances(chess)) {
    chess.move(san)
    const valor = -negamax(chess, profundidade - 1, -beta, -alfa, (sinal * -1) as 1 | -1, orcamento)
    chess.undo()
    if (valor > melhor) melhor = valor
    if (melhor > alfa) alfa = melhor
    if (alfa >= beta) break
    if (performance.now() > orcamento.fim) break
  }
  return melhor
}

function melhorJogadaEmProfundidade(chess: Chess, profundidade: number, orcamento: OrcamentoBusca): string | null {
  const jogadas = ordenarLances(chess)
  if (jogadas.length === 0) return null

  const sinal: 1 | -1 = chess.turn() === 'w' ? 1 : -1
  let melhorMove = jogadas[0]
  let melhorValor = -Infinity

  for (const san of jogadas) {
    chess.move(san)
    const valor = -negamax(chess, profundidade - 1, -Infinity, Infinity, (sinal * -1) as 1 | -1, orcamento)
    chess.undo()
    if (valor > melhorValor) {
      melhorValor = valor
      melhorMove = san
    }
    if (performance.now() > orcamento.fim) break
  }

  return melhorMove
}

/** Tempo máximo (ms) que a máquina pode "pensar" por lance — aprofunda o quanto der dentro desse orçamento. */
const ORCAMENTO_BUSCA_MS = 900
const PROFUNDIDADE_MAXIMA = 6

/** Aprofundamento iterativo: tenta profundidade 1, 2, 3... até o orçamento de tempo acabar, ficando com o melhor lance encontrado no nível mais profundo concluído. */
function melhorJogadaPorBusca(chess: Chess): string | null {
  const orcamento: OrcamentoBusca = { fim: performance.now() + ORCAMENTO_BUSCA_MS }
  let melhor: string | null = null
  for (let profundidade = 1; profundidade <= PROFUNDIDADE_MAXIMA; profundidade++) {
    const candidato = melhorJogadaEmProfundidade(chess, profundidade, orcamento)
    if (candidato) melhor = candidato
    if (performance.now() > orcamento.fim) break
  }
  return melhor
}

function escolherPeso<T extends { count: number }>(entradas: T[]): T {
  const total = entradas.reduce((s, e) => s + e.count, 0)
  let r = Math.random() * total
  for (const e of entradas) {
    r -= e.count
    if (r <= 0) return e
  }
  return entradas[entradas.length - 1]
}

/** Só considera um lance "aprendido" se já apareceu em pelo menos essas partidas — evita decidir em cima de 1 amostra. */
const AMOSTRAS_MINIMAS_APRENDIZADO = 3

/** Pontuação de sucesso de um lance aprendido — vitória vale 2, empate 1, derrota -2. */
function pontuacaoLance(l: LanceAprendido): number {
  return l.vitorias * 2 + l.empates - l.derrotas * 2
}

/** Entre os lances aprendidos com amostra suficiente, sorteia entre os que estão perto do melhor desempenho (mantém alguma exploração, não trava sempre no mesmo). */
function escolherLanceAprendido(lances: LanceAprendido[] | undefined): string | null {
  if (!lances) return null
  const candidatos = lances
    .map((l) => ({ san: l.san, total: l.vitorias + l.derrotas + l.empates, taxa: pontuacaoLance(l) / (l.vitorias + l.derrotas + l.empates || 1) }))
    .filter((c) => c.total >= AMOSTRAS_MINIMAS_APRENDIZADO)
  if (candidatos.length === 0) return null
  const melhorTaxa = Math.max(...candidatos.map((c) => c.taxa))
  const melhores = candidatos.filter((c) => c.taxa >= melhorTaxa - 0.5)
  return melhores[Math.floor(Math.random() * melhores.length)].san
}

/**
 * Escolhe o lance da máquina, em três camadas:
 * 1. Livro de partidas de referência (livro.json), se a posição aparecer nele — resposta na hora;
 * 2. O que a própria máquina já aprendeu jogando (vitórias/derrotas/empates registrados a partir
 *    dessa posição, tanto em partidas reais quanto no modo demonstração) — quanto mais partidas
 *    concluídas, mais essa camada tem pra oferecer;
 * 3. Busca própria com aprofundamento iterativo (material + tabelas de posição + mobilidade,
 *    ~900ms de orçamento por lance) quando nenhuma das anteriores tem uma resposta.
 */
export async function escolherJogadaDaMaquina(chess: Chess, livro: LivroDeAberturas): Promise<string | null> {
  const entradasLivro = buscarNoLivro(chess, livro)
  if (entradasLivro && entradasLivro.length > 0) {
    return escolherPeso(entradasLivro).move
  }

  const aprendizado = await buscarAprendizado(chavePosicao(chess.fen())).catch(() => undefined)
  const lanceAprendido = escolherLanceAprendido(aprendizado)
  if (lanceAprendido) return lanceAprendido

  return melhorJogadaPorBusca(chess)
}
