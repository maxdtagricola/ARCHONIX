import type { Chess } from 'chess.js'

export interface LivroEntrada {
  move: string
  count: number
}

export type LivroDeAberturas = Map<string, LivroEntrada[]>

/** Chave de posição — ignora o contador de lances (últimos dois campos do FEN), só compara tabuleiro/vez/roque/en passant. */
export function chavePosicao(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/** O arquivo chess/livro.json: pra cada posição, os lances e quantas vezes cada um foi jogado. */
interface LivroCompilado {
  posicoes: Record<string, [string, number][]>
}

export function buscarNoLivro(chess: Chess, livro: LivroDeAberturas): LivroEntrada[] | undefined {
  return livro.get(chavePosicao(chess.fen()))
}

let livroPromise: Promise<LivroDeAberturas> | null = null

/**
 * Carrega o livro de aberturas, compilado de public/chess/games.pgn (ver scripts/compilar-livro-xadrez.mjs):
 * ler as partidas aqui travaria a tela por vários segundos. Sem o arquivo, retorna um livro vazio — a
 * máquina passa a jogar só pela busca própria.
 */
export function carregarLivroDeAberturas(): Promise<LivroDeAberturas> {
  if (!livroPromise) {
    livroPromise = fetch(`${import.meta.env.BASE_URL}chess/livro.json`)
      .then((res) => (res.ok ? (res.json() as Promise<LivroCompilado>) : Promise.reject(new Error('sem livro'))))
      .then(({ posicoes }) => new Map(Object.entries(posicoes).map(([chave, lances]) => [chave, lances.map(([move, count]) => ({ move, count }))])))
      .catch(() => new Map())
  }
  return livroPromise
}
