export interface LineSeries {
  key: string
  label: string
  color: string
}

export interface LineDatum {
  label: string
  values: Record<string, number>
}

/** Gráfico de linhas — várias séries por categoria ao longo de um eixo (pensado pra tendência
 * mês a mês), eixo Y compartilhado (nunca duas escalas), grade e eixos discretos, com legenda fixa. */
export function LineChart({
  data,
  series,
  valueFormatter = (v: number) => String(v),
  emptyText = 'Sem dados.',
}: {
  data: LineDatum[]
  series: LineSeries[]
  valueFormatter?: (value: number) => string
  emptyText?: string
}) {
  const semDados = data.length === 0 || series.every((s) => data.every((d) => (d.values[s.key] ?? 0) === 0))
  if (semDados) {
    return <p className="text-sm text-ink-400 text-center py-8">{emptyText}</p>
  }

  const width = 760
  const height = 260
  const padLeft = 44
  const padRight = 40
  const padTop = 16
  const padBottom = 28
  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)))
  // eixo Y com passo "redondo" (1/2/5 × potência de 10), 4 divisões
  const passoBruto = max / 4
  const potencia = Math.pow(10, Math.floor(Math.log10(passoBruto || 1)))
  const passoNormalizado = passoBruto / potencia
  const passo = (passoNormalizado > 5 ? 10 : passoNormalizado > 2 ? 5 : passoNormalizado > 1 ? 2 : 1) * potencia
  const yMax = passo * 4

  function xAt(i: number) {
    return data.length > 1 ? padLeft + (i / (data.length - 1)) * plotW : padLeft + plotW / 2
  }
  function yAt(v: number) {
    return padTop + plotH - (v / yMax) * plotH
  }

  const linhasGrade = [0, 1, 2, 3, 4].map((i) => yAt(i * passo))

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {linhasGrade.map((y, i) => (
          <line key={i} x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="rgb(var(--ink-100))" strokeWidth={1} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <text key={i} x={padLeft - 8} y={yAt(i * passo)} textAnchor="end" dominantBaseline="middle" fontSize="11" fontWeight="600" style={{ fill: 'rgb(var(--ink-500))' }}>
            {valueFormatter(i * passo)}
          </text>
        ))}
        {data.map((d, i) => (
          <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize="10" style={{ fill: 'rgb(var(--ink-400))' }}>
            {d.label}
          </text>
        ))}

        {series.map((s) => {
          const pontos = data.map((d, i) => ({ x: xAt(i), y: yAt(d.values[s.key] ?? 0) }))
          const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
          const ultimoPonto = pontos[pontos.length - 1]
          const ultimoValor = data[data.length - 1]?.values[s.key] ?? 0
          return (
            <g key={s.key}>
              <path d={path} pathLength={1} className="linha-desenhar" fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {pontos.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={1.5}>
                  <title>
                    {s.label} — {data[i].label}: {valueFormatter(data[i].values[s.key] ?? 0)}
                  </title>
                </circle>
              ))}
              {ultimoPonto && (
                <text
                  x={ultimoPonto.x + 8}
                  y={ultimoPonto.y}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fontSize="11"
                  fontWeight="700"
                  style={{ fill: 'rgb(var(--ink-900))' }}
                >
                  {valueFormatter(ultimoValor)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div className="flex flex-wrap gap-3 justify-center mt-2">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-ink-600">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
