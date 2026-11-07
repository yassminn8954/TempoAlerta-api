import { env } from '../env.js'
import type { DB } from '../db.js'
import type { CidadeBusca, Previsao, WeatherClient } from './weather.js'
import { WeatherError } from './weather.js'

const CACHE_MS = 10 * 60 * 1000
const CITY_CACHE_MS = 24 * 60 * 60 * 1000
const MAX_STALE_MS = 24 * 60 * 60 * 1000
const ERROR_COOLDOWN_MS = 5 * 60 * 1000
const REQUEST_GAP_MS = 1000

interface CacheEntry {
  expiresAt: number
  savedAt: number
  forecast: Previsao
}

class ProviderRateLimitError extends WeatherError {}

type Json = Record<string, any>

const weatherCode = (symbol = ''): number => {
  const code = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (code.includes('thunder')) return 95
  if (code.includes('snow') || code.includes('sleet')) return 71
  if (code.includes('rainshowers')) return 80
  if (code.includes('heavyrain') || code === 'rain') return 61
  if (code.includes('rain') || code.includes('drizzle')) return 51
  if (code === 'fog') return 45
  if (code === 'partlycloudy') return 2
  if (code === 'cloudy') return 3
  if (code === 'fair') return 1
  if (code === 'clearsky') return 0
  return 3
}

function localParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`,
  }
}

function precipitationAmount(data: Json): number {
  const value = data.next_1_hours?.details?.precipitation_amount
    ?? data.next_6_hours?.details?.precipitation_amount
    ?? data.next_12_hours?.details?.precipitation_amount
    ?? 0
  return Number.isFinite(value) ? value : 0
}

export class MetNorwayClient implements WeatherClient {
  private cache = new Map<string, CacheEntry>()
  private cityCache = new Map<string, { expiresAt: number; cities: CidadeBusca[] }>()
  private inFlight = new Map<string, Promise<Previsao>>()
  private citySearchInFlight = new Map<string, Promise<CidadeBusca[]>>()
  private citySearchBlockedUntil = 0
  private blockedUntil = 0
  private nextRequestAt = 0
  private requestQueue: Promise<void> = Promise.resolve()

  constructor(private readonly db?: DB) {}

  async buscarCidades(q: string): Promise<CidadeBusca[]> {
    const key = q.trim().toLocaleLowerCase('pt-BR')
    const hit = await this.readCityCache(key)
    if (hit) return hit
    if (this.citySearchBlockedUntil > Date.now()) {
      throw new WeatherError('A busca de cidades está temporariamente limitada; tente novamente mais tarde')
    }
    const pending = this.citySearchInFlight.get(key)
    if (pending) return pending
    const request = this.loadCities(q, key)
    this.citySearchInFlight.set(key, request)
    try {
      return await request
    } finally {
      this.citySearchInFlight.delete(key)
    }
  }

  private async readCityCache(key: string): Promise<CidadeBusca[] | undefined> {
    const memory = this.cityCache.get(key)
    if (memory && memory.expiresAt > Date.now()) return memory.cities
    if (!this.db) return undefined

    const { rows } = await this.db.query<{ resultados: CidadeBusca[] | string; buscado_em: string | Date }>(
      'SELECT resultados, buscado_em FROM cidades_busca_cache WHERE consulta = ?',
      [key],
    )
    const row = rows[0]
    if (!row) return undefined
    const searchedAt = Date.parse(String(row.buscado_em))
    if (Date.now() - searchedAt > CITY_CACHE_MS) return undefined
    const cities = typeof row.resultados === 'string' ? JSON.parse(row.resultados) as CidadeBusca[] : row.resultados
    this.cityCache.set(key, { expiresAt: searchedAt + CITY_CACHE_MS, cities })
    return cities
  }

  private async loadCities(q: string, key: string): Promise<CidadeBusca[]> {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: `${q}, Brasil`,
      format: 'jsonv2',
      addressdetails: '1',
      countrycodes: 'br',
      limit: '8',
    })
    try {
      const results = await this.getJson(url)
      if (!Array.isArray(results)) throw new WeatherError('Resposta inválida do serviço de busca de cidades')
      const cities = results.map((r: Json) => ({
        nome: r.address?.city ?? r.address?.town ?? r.address?.village ?? r.name,
        estado: r.address?.state ?? null,
        uf: null,
        pais: 'Brasil',
        latitude: Number(r.lat),
        longitude: Number(r.lon),
      })).filter((c: CidadeBusca) => c.nome && Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
      const searchedAt = Date.now()
      this.cityCache.set(key, { expiresAt: searchedAt + CITY_CACHE_MS, cities })
      if (this.db) {
        await this.db.query(
          `INSERT INTO cidades_busca_cache (consulta, resultados, buscado_em) VALUES (?, ?, ?)
           ON CONFLICT (consulta) DO UPDATE SET resultados = excluded.resultados, buscado_em = excluded.buscado_em`,
          [key, JSON.stringify(cities), new Date(searchedAt).toISOString()],
        )
      }
      return cities
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        this.citySearchBlockedUntil = Date.now() + ERROR_COOLDOWN_MS
      }
      throw error
    }
  }

  async previsao(lat: number, lon: number): Promise<Previsao> {
    const key = `metno:${lat.toFixed(2)},${lon.toFixed(2)}`
    const hit = await this.readCache(key)
    const now = Date.now()
    if (hit && hit.expiresAt > now) return hit.forecast
    if (this.blockedUntil > now) {
      if (hit && now - hit.savedAt <= MAX_STALE_MS) return hit.forecast
      throw new WeatherError('O serviço meteorológico está temporariamente limitando consultas; tente novamente mais tarde')
    }

    const pending = this.inFlight.get(key)
    if (pending) return pending
    const request = this.loadForecast(lat, lon, key, hit)
    this.inFlight.set(key, request)
    try {
      return await request
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async readCache(key: string): Promise<CacheEntry | undefined> {
    const memory = this.cache.get(key)
    if (memory) return memory
    if (!this.db) return undefined

    const { rows } = await this.db.query<{ previsao: Previsao | string; salvo_em: string | Date }>(
      'SELECT previsao, salvo_em FROM previsoes_cache WHERE chave = ?',
      [key],
    )
    const row = rows[0]
    if (!row) return undefined
    const forecast = typeof row.previsao === 'string' ? JSON.parse(row.previsao) as Previsao : row.previsao
    const savedAt = Date.parse(String(row.salvo_em))
    const entry = { expiresAt: savedAt + CACHE_MS, savedAt, forecast }
    this.cache.set(key, entry)
    return entry
  }

  private async getJson(url: string): Promise<any> {
    const previous = this.requestQueue
    let release!: () => void
    this.requestQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const wait = this.nextRequestAt - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      this.nextRequestAt = Date.now() + REQUEST_GAP_MS
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'TempoAlerta/1.0 (https://tempoalerta.onrender.com)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 429) {
        this.blockedUntil = Date.now() + ERROR_COOLDOWN_MS
        throw new ProviderRateLimitError('O serviço limitou consultas (HTTP 429)')
      }
      if (!response.ok) throw new WeatherError(`Serviço meteorológico respondeu HTTP ${response.status}`)
      return response.json()
    } catch (error) {
      if (error instanceof WeatherError) throw error
      throw new WeatherError(`Serviço meteorológico indisponível: ${(error as Error).message}`)
    } finally {
      release()
    }
  }

  private async loadForecast(
    lat: number,
    lon: number,
    key: string,
    hit?: CacheEntry,
  ): Promise<Previsao> {
    const url = 'https://api.met.no/weatherapi/locationforecast/2.0/complete?' + new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
    })
    try {
      const json = await this.getJson(url)
      const series: Json[] = json.properties?.timeseries
      if (!Array.isArray(series) || series.length === 0) {
        throw new WeatherError('O serviço meteorológico retornou uma previsão vazia')
      }

      const pontos = series.map((item) => {
        const instant = item.data?.instant?.details
        if (!instant || !Number.isFinite(instant.air_temperature)) return null
        const local = localParts(item.time)
        const next = item.data.next_1_hours ?? item.data.next_6_hours ?? item.data.next_12_hours
        const symbol = next?.summary?.symbol_code ?? item.data.next_6_hours?.summary?.symbol_code ?? ''
        return {
          data: local.date,
          hora: local.hour,
          temperatura: instant.air_temperature as number,
          umidade: Number(instant.relative_humidity ?? 0),
          vento: Number(instant.wind_speed ?? 0) * 3.6,
          chuva: precipitationAmount(item.data),
          codigo: weatherCode(symbol),
        }
      }).filter((p): p is NonNullable<typeof p> => p !== null)
      if (!pontos.length) throw new WeatherError('O serviço meteorológico retornou dados incompletos')

      const agrupados = new Map<string, typeof pontos>()
      for (const ponto of pontos) {
        const dia = agrupados.get(ponto.data) ?? []
        dia.push(ponto)
        agrupados.set(ponto.data, dia)
      }
      const dias = [...agrupados.entries()].map(([data, dia]) => ({
        data,
        max: Math.max(...dia.map((p) => p.temperatura)),
        min: Math.min(...dia.map((p) => p.temperatura)),
        chuva_mm: Math.round(dia.reduce((sum, p) => sum + p.chuva, 0) * 10) / 10,
        prob_chuva: null,
        codigo: codigoMaisFrequente(dia.map((p) => p.codigo)),
      })).slice(0, 7)
      const primeiro = pontos[0]
      const atualizado = json.properties?.meta?.updated_at
      const forecast: Previsao = {
        atual: {
          hora: primeiro.hora,
          temperatura: primeiro.temperatura,
          umidade: primeiro.umidade,
          vento_kmh: Math.round(primeiro.vento * 10) / 10,
          chuva_mm: primeiro.chuva,
          codigo: primeiro.codigo,
        },
        dias,
        horas: pontos.map((p) => ({
          hora: p.hora,
          temperatura: p.temperatura,
          chuva_mm: p.chuva,
          prob_chuva: null,
        })),
        atualizado_em: atualizado ? new Date(atualizado).toISOString() : new Date().toISOString(),
      }
      const savedAt = Date.now()
      const entry = { expiresAt: savedAt + CACHE_MS, savedAt, forecast }
      this.cache.set(key, entry)
      if (this.db) {
        try {
          await this.db.query(
            `INSERT INTO previsoes_cache (chave, previsao, salvo_em) VALUES (?, ?, ?)
             ON CONFLICT (chave) DO UPDATE SET previsao = excluded.previsao, salvo_em = excluded.salvo_em`,
            [key, JSON.stringify(forecast), new Date(savedAt).toISOString()],
          )
        } catch (error) {
          console.error('[weather cache] não foi possível persistir previsão:', error)
        }
      }
      return forecast
    } catch (error) {
      if (hit && Date.now() - hit.savedAt <= MAX_STALE_MS) return hit.forecast
      throw error
    }
  }
}

function codigoMaisFrequente(codigos: number[]) {
  const frequencias = new Map<number, number>()
  for (const codigo of codigos) frequencias.set(codigo, (frequencias.get(codigo) ?? 0) + 1)
  return [...frequencias.entries()].reduce((melhor, atual) =>
    atual[1] > melhor[1] ? atual : melhor,
  )[0]
}

export function descricaoClima(codigo: number): string {
  if (codigo === 0) return 'Céu limpo'
  if (codigo === 1) return 'Predominantemente limpo'
  if (codigo === 2) return 'Parcialmente nublado'
  if (codigo === 3) return 'Nublado'
  if (codigo === 45) return 'Neblina'
  if (codigo === 51) return 'Garoa'
  if (codigo === 61) return 'Chuva'
  if (codigo === 71) return 'Neve'
  if (codigo === 80) return 'Pancadas de chuva'
  if (codigo === 95) return 'Trovoadas'
  return 'Tempo variável'
}
