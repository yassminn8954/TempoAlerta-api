import type { Previsao } from './openMeteo.js'

export interface EventoChuva {
  pico_mm: number
  hora_pico: string // YYYY-MM-DDTHH:00
  total_24h_mm: number
}
export interface EventoGeada {
  minima: number
  hora_minima: string
}

function proximas24h(prev: Previsao) {
  const agora = prev.atual.hora.slice(0, 13) // YYYY-MM-DDTHH
  return prev.horas.filter((h) => h.hora.slice(0, 13) >= agora).slice(0, 24)
}

/** Maior precipitação horária (mm/h) nas próximas 24h. */
export function picoDeChuva(prev: Previsao): EventoChuva | null {
  const hs = proximas24h(prev)
  if (!hs.length) return null
  const pico = hs.reduce((a, b) => (b.chuva_mm > a.chuva_mm ? b : a))
  return {
    pico_mm: pico.chuva_mm,
    hora_pico: pico.hora,
    total_24h_mm: Math.round(hs.reduce((s, h) => s + h.chuva_mm, 0) * 10) / 10,
  }
}

/** Menor temperatura horária nas próximas 24h. */
export function menorTemperatura(prev: Previsao): EventoGeada | null {
  const hs = proximas24h(prev)
  if (!hs.length) return null
  const m = hs.reduce((a, b) => (b.temperatura < a.temperatura ? b : a))
  return { minima: m.temperatura, hora_minima: m.hora }
}

export function chuvaForte(prev: Previsao, limiarMm: number): EventoChuva | null {
  const e = picoDeChuva(prev)
  return e && e.pico_mm >= limiarMm ? e : null
}

export function geada(prev: Previsao, limiarC: number): EventoGeada | null {
  const e = menorTemperatura(prev)
  return e && e.minima <= limiarC ? e : null
}
