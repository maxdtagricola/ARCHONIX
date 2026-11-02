import type { ReactNode } from 'react'
import type { TabKey } from './Layout'

// Símbolos das abas da barra lateral — traço simples na cor do texto (currentColor), então
// acompanham o tema claro/escuro e o destaque da aba aberta. Com o menu recolhido, são eles que
// identificam cada aba.

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

// rodapé da barra lateral recolhida: "minha conta" (pessoa) e "sair" (porta com seta)
export const ICONE_MINHA_CONTA = (
  <Icone>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20.5c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icone>
)

export const ICONE_SAIR = (
  <Icone>
    <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
    <path d="M14 8l4 4-4 4M18 12H9" />
  </Icone>
)

export const ICONES_ABAS: Record<TabKey, ReactNode> = {
  // casa
  telaInicial: (
    <Icone>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9v11h4.5v-6h4v6h4.5V9" />
    </Icone>
  ),
  // prancheta com a lista de cotações
  cotacoes: (
    <Icone>
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1z" />
      <path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
      <path d="M9 11h6M9 15h4" />
    </Icone>
  ),
  // calculadora — formação do preço
  dashboard: (
    <Icone>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8.5 7h7" />
      <path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01" />
    </Icone>
  ),
  // balança — comparar fornecedores
  comparar: (
    <Icone>
      <path d="M12 3v18M7 21h10M5 7h14" />
      <path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0z" />
      <path d="m19 7-2.5 6a2.5 2.5 0 0 0 5 0z" />
    </Icone>
  ),
  // carrinho — pedido de compra
  pedidoCompra: (
    <Icone>
      <circle cx="9" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
      <path d="M2.5 3.5h2.6l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6.2" />
    </Icone>
  ),
  // recibo com cifrão — faturamento
  faturamento: (
    <Icone>
      <path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z" />
      <path d="M14.3 8.6c-.4-.8-1.3-1.3-2.3-1.3-1.3 0-2.3.7-2.3 1.7 0 2.4 4.6 1.3 4.6 3.8 0 1-1 1.8-2.3 1.8-1.1 0-2-.5-2.4-1.3M12 6.3v1M12 14.6v1" />
    </Icone>
  ),
  // setas de ida e volta — transferências entre filiais
  acompanhamentoNotas: (
    <Icone>
      <path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5" />
      <path d="M20 16H5M8.5 12.5 5 16l3.5 3.5" />
    </Icone>
  ),
  // documento — notas fiscais
  notasFiscais: (
    <Icone>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </Icone>
  ),
  // gráfico de barras — dashboard das cotações
  analytics: (
    <Icone>
      <path d="M4 20h16" />
      <path d="M7.5 16v-5M12 16V6.5M16.5 16V9.5" />
    </Icone>
  ),
  // folha com barras — relatório geral pros supervisores
  relatorios: (
    <Icone>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 17v-3M12 17v-6M15 17v-4" />
    </Icone>
  ),
  // gráfico de pizza — dashboard das transferências
  notasFiscaisDashboard: (
    <Icone>
      <path d="M11 4a8 8 0 1 0 8 8h-8z" />
      <path d="M14 2.6A8 8 0 0 1 20.4 9H14z" />
    </Icone>
  ),
  // caixa — produtos
  produtos: (
    <Icone>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="m4 7 8 4 8-4M12 11v10" />
    </Icone>
  ),
  // fábrica — fornecedores
  fornecedores: (
    <Icone>
      <path d="M3 21V10.5l5 3v-3l5 3V7l8 4v10z" />
      <path d="M7 17.5h1.5M11.5 17.5H13M16 17.5h1.5" />
    </Icone>
  ),
  // caminhão — frete
  frete: (
    <Icone>
      <path d="M2.5 6h11v10.5h-11z" />
      <path d="M13.5 9.5h4l3 3.5v3.5h-7" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </Icone>
  ),
  // relógio com a seta pra trás — histórico
  history: (
    <Icone>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l2.8 1.8" />
    </Icone>
  ),
  // engrenagem — configurações
  configuracoes: (
    <Icone>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="12" r="6" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2" />
    </Icone>
  ),
}
