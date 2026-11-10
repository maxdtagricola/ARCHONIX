import type { ReactNode } from 'react'

// Símbolos das partes da aba Configurações — mesmo traço dos da barra lateral (IconesAbas.tsx), maiores.

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const ICONES_CONFIG = {
  // pessoa com cadeado (senha)
  conta: (
    <Icone>
      <circle cx="10" cy="7.5" r="3.2" />
      <path d="M3.5 19.5c.7-3.3 3.2-5 6.5-5 1.2 0 2.3.2 3.2.7" />
      <rect x="14.5" y="15" width="6" height="5" rx="1" />
      <path d="M15.8 15v-1.4a1.7 1.7 0 0 1 3.4 0V15" />
    </Icone>
  ),
  // relógio com a seta de sair
  saida: (
    <Icone>
      <circle cx="10" cy="12" r="7.5" />
      <path d="M10 7.5V12l2.8 1.8" />
      <path d="M17 6.2 21 4M19.2 3.2 21 4l-.8 1.8" />
    </Icone>
  ),
  // duas pessoas
  usuarios: (
    <Icone>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19.5c.6-3 2.9-4.7 6-4.7s5.4 1.7 6 4.7" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M17.5 14.3c2 .4 3.2 1.9 3.6 4" />
    </Icone>
  ),
  // documento com a seta de voltar (trazer de volta de um backup)
  restaurarBackup: (
    <Icone>
      <path d="M14 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9 15.5a3.2 3.2 0 1 0 1-2.4" />
      <path d="M9.2 11.4v2h2" />
    </Icone>
  ),
  // calendário com o dia marcado
  feriados: (
    <Icone>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="m12 12.3.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" />
    </Icone>
  ),
  // tela com o "play" (o vídeo de fundo)
  fundo: (
    <Icone>
      <rect x="2.5" y="4.5" width="19" height="12.5" rx="1.5" />
      <path d="m10.3 8.3 4.2 2.45-4.2 2.45z" />
      <path d="M8 20.5h8M12 17v3.5" />
    </Icone>
  ),
  // crachá (um tipo de usuário: função, abas e status)
  tiposUsuario: (
    <Icone>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M9.5 3.5v2h5v-2" />
      <circle cx="12" cy="11" r="2.4" />
      <path d="M8 17c.6-1.9 2.1-3 4-3s3.4 1.1 4 3" />
    </Icone>
  ),
  // paleta de cores (status das cotações: nome, cor e ordem)
  statusCotacoes: (
    <Icone>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.8 1.9-1.7 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.6-1.6h2.1a4 4 0 0 0 4-4C20.5 6.8 16.7 3.5 12 3.5z" />
      <circle cx="7.6" cy="11.5" r="1.1" />
      <circle cx="10" cy="7.6" r="1.1" />
      <circle cx="14.6" cy="7.6" r="1.1" />
    </Icone>
  ),
  // caminhão com a gota de cor (status de frete e notas)
  statusNotas: (
    <Icone>
      <path d="M2.5 7h11v9h-11z" />
      <path d="M13.5 10h4l3 3.2V16h-7" />
      <circle cx="6.5" cy="17.5" r="1.7" />
      <circle cx="16.5" cy="17.5" r="1.7" />
      <path d="M8 2.8s-1.7 1.9-1.7 3a1.7 1.7 0 0 0 3.4 0c0-1.1-1.7-3-1.7-3z" />
    </Icone>
  ),
  // etiqueta de preço com o %
  formacao: (
    <Icone>
      <path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1l9 9-8.1 8.1z" />
      <path d="m9.5 15 5-5" />
      <circle cx="9.8" cy="10.3" r="0.9" />
      <circle cx="14.2" cy="14.7" r="0.9" />
      <circle cx="7" cy="7" r="0.6" />
    </Icone>
  ),
  // prédio
  empresas: (
    <Icone>
      <path d="M4 20.5V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15" />
      <path d="M14 9.5h5a1 1 0 0 1 1 1v10" />
      <path d="M2.5 20.5h19" />
      <path d="M7.5 8h3M7.5 11.5h3M7.5 15h3M17 13.5h0M17 16.5h0" />
    </Icone>
  ),
  // planilha com a seta de subir
  importarMarkup: (
    <Icone>
      <path d="M14 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M12 17.5v-6M9.5 14 12 11.5l2.5 2.5" />
    </Icone>
  ),
  // planilhas empilhadas com o relógio (histórico)
  planilhas: (
    <Icone>
      <path d="M8 5.5V4.5a1 1 0 0 1 1-1h9.5a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-1" />
      <rect x="4.5" y="7" width="11" height="13.5" rx="1" />
      <circle cx="10" cy="13.7" r="3.3" />
      <path d="M10 12.2v1.6l1 .8" />
    </Icone>
  ),
} satisfies Record<string, ReactNode>
