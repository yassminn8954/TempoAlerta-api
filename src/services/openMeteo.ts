import { env } from '../env.js'

export interface CidadeBusca {
  nome: string
  estado: string | null
  uf: string | null
  pais: string
  latitude: number
  longitude: number
}
export interface Atual {
  hora: string
  temperatura: number
  sensacao: number
  umidade: number
  vento_kmh: number
  chuva_mm: number
  codigo: number
}
export interface Dia {
  data: string // YYYY-MM-DD (local)
  max: number
  min: number
  chuva_mm: number
  prob_chuva: number
  codigo: number
}
export interface Hora {
  hora: string // YYYY-MM-DDTHH:00 (local)
  temperatura: number
  chuva_mm: number // mm na hora = mm/h
  prob_chuva: number
}
export interface Previsao {
  atual: Atual
  dias: Dia[]
  horas: Hora[]
  atualizado_em: string
}

export interface WeatherClient {
  buscarCidades(q: string): Promise<CidadeBusca[]>
  previsao(lat: number, lon: number): Promise<Previsao>
}

export class WeatherError extends Error {}

const UF: Record<string, string> = {
  Acre: 'AC', Alagoas: 'AL', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceará: 'CE',
  'Distrito Federal': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO', Maranhão: 'MA',
  'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', Pará: 'PA',
  Paraíba: 'PB', Paraná: 'PR', Pernambuco: 'PE', Piauí: 'PI', 'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', Rondônia: 'RO', Roraima: 'RR',
  'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO',
}

const TTL_MS = 10 * 60 * 1000

export class OpenMeteoClient implements WeatherClient {
  private cache = new Map<string, { ate: number; dado: Previsao }>()

  private async getJson(url: string): Promise<any> {
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    } catch (e) {
      throw new WeatherError(`Open-Meteo indisponível: ${(e as Error).message}`)
    }
    if (!res.ok) throw new WeatherError(`Open-Meteo respondeu ${res.status}`)
    return res.json()
  }

  async buscarCidades(q: string): Promise<CidadeBusca[]> {
    const url =
      'https://geocoding-api.open-meteo.com/v1/search?' +
      new URLSearchParams({ name: q, count: '8', language: 'pt', format: 'json', countryCode: 'BR' })
    const json = await this.getJson(url)
    return (json.results ?? []).map((r: any) => ({
      nome: r.name,
      estado: r.admin1 ?? null,
      uf: r.admin1 ? (UF[r.admin1] ?? null) : null,
      pais: r.country ?? 'Brasil',
      latitude: r.latitude,
      longitude: r.longitude,
    }))
  }

  async previsao(lat: number, lon: number): Promise<Previsao> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const hit = this.cache.get(key)
    if (hit && hit.ate > Date.now()) return hit.dado

    const url =
      'https://api.open-meteo.com/v1/forecast?' +
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
        hourly: 'temperature_2m,precipitation,precipitation_probability',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
        timezone: env.tz,
        forecast_days: '7',
      })
    const j = await this.getJson(url)
    const c = j.current
    const d = j.daily
    const h = j.hourly
    if (!c || !d || !h) throw new WeatherError('Resposta inesperada da Open-Meteo')

    const dado: Previsao = {
      atual: {
        hora: c.time,
        temperatura: c.temperature_2m,
        sensacao: c.apparent_temperature,
        umidade: c.relative_humidity_2m,
        vento_kmh: c.wind_speed_10m,
        chuva_mm: c.precipitation ?? 0,
        codigo: c.weather_code,
      },
      dias: (d.time as string[]).map((data, i) => ({
        data,
        max: d.temperature_2m_max[i],
        min: d.temperature_2m_min[i],
        chuva_mm: d.precipitation_sum[i] ?? 0,
        prob_chuva: d.precipitation_probability_max[i] ?? 0,
        codigo: d.weather_code[i],
      })),
      horas: (h.time as string[]).map((hora, i) => ({
        hora,
        temperatura: h.temperature_2m[i],
        chuva_mm: h.precipitation[i] ?? 0,
        prob_chuva: h.precipitation_probability[i] ?? 0,
      })),
      atualizado_em: new Date().toISOString(),
    }
    this.cache.set(key, { ate: Date.now() + TTL_MS, dado })
    return dado
  }
}

/** Códigos WMO usados pela Open-Meteo. */
export function descricaoClima(codigo: number): string {
  if (codigo === 0) return 'Céu limpo'
  if (codigo === 1) return 'Predominantemente limpo'
  if (codigo === 2) return 'Parcialmente nublado'
  if (codigo === 3) return 'Nublado'
  if (codigo === 45 || codigo === 48) return 'Neblina'
  if (codigo >= 51 && codigo <= 57) return 'Garoa'
  if (codigo >= 61 && codigo <= 67) return 'Chuva'
  if (codigo >= 71 && codigo <= 77) return 'Neve'
  if (codigo >= 80 && codigo <= 82) return 'Pancadas de chuva'
  if (codigo === 85 || codigo === 86) return 'Pancadas de neve'
  if (codigo === 95) return 'Trovoadas'
  if (codigo === 96 || codigo === 99) return 'Trovoadas com granizo'
  return 'Tempo variável'
}
