import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { openTestDb } from '../src/db.js'
import { MetNorwayClient } from '../src/services/metNorway.js'
import { WeatherError } from '../src/services/weather.js'

const realFetch = globalThis.fetch
const realNow = Date.now
afterEach(() => {
  globalThis.fetch = realFetch
  Date.now = realNow
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))
const forecast = {
  properties: {
    meta: { updated_at: '2026-11-06T22:00:00Z' },
    timeseries: [
      {
        time: '2026-11-06T23:00:00Z',
        data: {
          instant: { details: { air_temperature: 20, relative_humidity: 75, wind_speed: 2 } },
          next_1_hours: { summary: { symbol_code: 'heavyrain' }, details: { precipitation_amount: 3 } },
        },
      },
      {
        time: '2026-11-07T00:00:00Z',
        data: {
          instant: { details: { air_temperature: 18, relative_humidity: 80, wind_speed: 3 } },
          next_1_hours: { summary: { symbol_code: 'partlycloudy_night' }, details: { precipitation_amount: 0 } },
        },
      },
      {
        time: '2026-11-07T03:00:00Z',
        data: {
          instant: { details: { air_temperature: 16, relative_humidity: 85, wind_speed: 4 } },
          next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 1.5 } },
        },
      },
    ],
  },
}

describe('MetNorwayClient', () => {
  it('converte previsão MET Norway para o formato da aplicação e inclui fuso local', async () => {
    let url = ''
    let userAgent = ''
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      url = input
      userAgent = new Headers(init?.headers).get('User-Agent') ?? ''
      return json(forecast)
    }) as typeof fetch

    const result = await new MetNorwayClient().previsao(-23.55, -46.63)
    assert.match(url, /api\.met\.no\/weatherapi\/locationforecast\/2\.0\/complete/)
    assert.match(userAgent, /TempoAlerta/)
    assert.equal(result.atual.hora, '2026-11-06T20:00')
    assert.equal(result.atual.temperatura, 20)
    assert.equal(result.atual.vento_kmh, 7.2)
    assert.equal(result.atual.codigo, 61)
    assert.equal(result.dias[0].chuva_mm, 3)
    assert.equal(result.dias[0].prob_chuva, null)
    assert.equal(result.dias[0].codigo, 61)
    assert.equal(result.dias[1].chuva_mm, 1.5)
    assert.equal(result.atualizado_em, '2026-11-06T22:00:00.000Z')
  })

  it('busca e mapeia cidades via OpenStreetMap Nominatim', async () => {
    let url = ''
    let chamadas = 0
    globalThis.fetch = (async (input: string) => {
      url = input
      chamadas++
      return json([{ name: 'Campinas', lat: '-22.9', lon: '-47.06', address: { city: 'Campinas', state: 'São Paulo' } }])
    }) as typeof fetch
    const db = openTestDb()
    try {
      const result = await new MetNorwayClient(db).buscarCidades('Campinas')
      assert.match(url, /nominatim\.openstreetmap\.org\/search/)
      assert.deepEqual(result, [{
        nome: 'Campinas',
        estado: 'São Paulo',
        uf: null,
        pais: 'Brasil',
        latitude: -22.9,
        longitude: -47.06,
      }])
      assert.deepEqual(await new MetNorwayClient(db).buscarCidades('campinas'), result)
      assert.equal(chamadas, 1)
    } finally {
      await db.close()
    }
  })

  it('usa cache em memória e persiste previsões entre instâncias', async () => {
    let chamadas = 0
    globalThis.fetch = (async () => {
      chamadas++
      return json(forecast)
    }) as typeof fetch
    const db = openTestDb()
    try {
      const firstClient = new MetNorwayClient(db)
      const first = await firstClient.previsao(-22.9, -47.06)
      assert.deepEqual(await firstClient.previsao(-22.9, -47.06), first)
      assert.deepEqual(await new MetNorwayClient(db).previsao(-22.9, -47.06), first)
      assert.equal(chamadas, 1)
    } finally {
      await db.close()
    }
  })

  it('serve cache persistido quando o provedor responde 429', async () => {
    let now = realNow()
    Date.now = () => now
    let chamadas = 0
    globalThis.fetch = (async () => {
      chamadas++
      return chamadas === 1
        ? json(forecast)
        : new Response('', { status: 429, headers: { 'Retry-After': '60' } })
    }) as typeof fetch
    const db = openTestDb()
    try {
      const previous = await new MetNorwayClient(db).previsao(-22.9, -47.06)
      now += 11 * 60 * 1000
      const cached = await new MetNorwayClient(db).previsao(-22.9, -47.06)
      assert.deepEqual(cached, previous)
      assert.equal(chamadas, 2)
    } finally {
      await db.close()
    }
  })

  it('não repete chamadas durante cooldown de limite sem cache', async () => {
    let chamadas = 0
    globalThis.fetch = (async () => {
      chamadas++
      return new Response('', { status: 429 })
    }) as typeof fetch
    const client = new MetNorwayClient()
    await assert.rejects(client.previsao(1, 1), WeatherError)
    await assert.rejects(client.previsao(1, 1), WeatherError)
    assert.equal(chamadas, 1)
  })
})
