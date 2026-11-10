import type { ReactNode } from 'react'

// cartão de estatística colorido com ícone — o "resumo de cima" que os dashboards (cotações,
// transferências) mostram ao lado do título. Compartilhado pra manter os dois com a mesma cara.

// nas telas grandes (xl ≥ 1280 px, 2xl ≥ 1536 px) o cartão cresce: ícone, número e rótulo
const TAMANHO_ICONE = 'h-[26px] w-[26px] xl:h-8 xl:w-8 2xl:h-9 2xl:w-9'

export function IconDocumento() {
  return (
    <svg width="26" height="26" className={TAMANHO_ICONE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  )
}

export function IconTendencia() {
  return (
    <svg width="26" height="26" className={TAMANHO_ICONE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  )
}

export function IconCheck() {
  return (
    <svg width="26" height="26" className={TAMANHO_ICONE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

export function IconCaminhao() {
  return (
    <svg width="26" height="26" className={TAMANHO_ICONE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="14" height="12" rx="1" />
      <path d="M15 10h4l3 3v5h-7z" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
    </svg>
  )
}

// tons mais escuros que os da paleta categórica (PALETA_CATEGORICA/CORES_TIPO) de propósito: aqui
// o número vem em branco por cima — os tons "claros" da paleta (ex.: #eda100) davam menos de 3:1
// de contraste com branco (quase ilegível, "lavado"), estes ficam todos acima de 4.5:1 (WCAG AA)
const TONS_KPI: Record<'agua' | 'amarelo' | 'laranja', string> = {
  agua: 'bg-[#047857]',
  amarelo: 'bg-[#b45309]',
  laranja: 'bg-[#c2410c]',
}

export function KpiCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: ReactNode
  value: string
  label: string
  tone: keyof typeof TONS_KPI
}) {
  return (
    <div className={`rounded-2xl px-4 py-3.5 2xl:px-5 2xl:py-4 text-white flex items-center gap-3 2xl:gap-4 ${TONS_KPI[tone]}`}>
      <div className="shrink-0 opacity-90">{icon}</div>
      <div className="min-w-0">
        <p className="font-display text-xl 2xl:text-2xl font-bold leading-tight truncate">{value}</p>
        <p className="text-xs 2xl:text-sm text-white/85 truncate">{label}</p>
      </div>
    </div>
  )
}
