import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { OpenMeteoClient, WeatherError } from '../src/services/openMeteo.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('OpenMeteoClient (fetch simulado no formato documentado da API)', () => {
  it('geocodificação: mapeia estado para UF e envia countryCode=BR', async () => {
    let url = ''
    globalThis.fetch = (async (u: string) => {
      url = u
      return json({ results: [{ name: 'Campinas', admin1: 'São Paulo', country: 'Brasil', latitude: -22.9, longitude: -47.06 }] })
    }) as any
    const r = await new OpenMeteoClient().buscarCidades('campinas')
    assert.match(url, /countryCode=BR/)
    assert.deepEqual(r[0], { nome: 'Campinas', estado: 'São Paulo', uf: 'SP', pais: 'Brasil', latitude: -22.9, longitude: -47.06 })
  })

  it('geocodificação: sem resultados devolve lista vazia', async () => {
    globalThis.fetch = (async () => json({ generationtime_ms: 1 })) as any
    assert.deepEqual(await new OpenMeteoClient().buscarCidades('xyzxyz'), [])
  })

  it('previsão: converte resposta, trata null e usa cache', async () => {
    let chamadas = 0
    globalThis.fetch = (async () => {
      chamadas++
      return json({
        current: { time: '2026-10-26T06:30', temperature_2m: 19.2, apparent_temperature: 19, relative_humidity_2m: 70, precipitation: 0, weather_code: 2, wind_speed_10m: 11 },
        hourly: { time: ['2026-10-26T06:00', '2026-10-26T07:00'], temperature_2m: [18, 19], precipitation: [null, 3.2], precipitation_probability: [10, null] },
        daily: { time: ['2026-10-26'], weather_code: [61], temperature_2m_max: [27], temperature_2m_min: [15], precipitation_sum: [null], precipitation_probability_max: [80] },
      })
    }) as any
    const c = new OpenMeteoClient()
    const p = await c.previsao(-22.9, -47.06)
    assert.equal(p.atual.temperatura, 19.2)
    assert.equal(p.horas[0].chuva_mm, 0)
    assert.equal(p.horas[1].prob_chuva, 0)
    assert.equal(p.dias[0].chuva_mm, 0)
    assert.equal(p.dias[0].prob_chuva, 80)
    await c.previsao(-22.9, -47.06)
    assert.equal(chamadas, 1)
  })

  it('erro HTTP ou rede viram WeatherError', async () => {
    globalThis.fetch = (async () => json({}, 500)) as any
    await assert.rejects(new OpenMeteoClient().previsao(1, 1), WeatherError)
    globalThis.fetch = (async () => {
      throw new Error('timeout')
    }) as any
    await assert.rejects(new OpenMeteoClient().previsao(2, 2), WeatherError)
  })
})
