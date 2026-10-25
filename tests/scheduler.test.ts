import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { processarAlertas, processarDiarias } from '../src/services/scheduler.js'
import { subir } from './helpers.js'

// America/Sao_Paulo = UTC-3 (sem horário de verão desde 2019)
const as0630 = new Date('2026-10-26T09:30:00Z')
const as0559 = new Date('2026-10-26T08:59:00Z')
const as0800 = new Date('2026-10-26T11:00:00Z')

const contar = (t: Awaited<ReturnType<typeof subir>>, tipo: string, status = 'enviado') =>
  (t.deps.db.prepare('SELECT COUNT(*) n FROM alertas_enviados WHERE tipo=? AND status=?').get(tipo, status) as any).n

describe('agendador', () => {
  let t: Awaited<ReturnType<typeof subir>>
  let u: Awaited<ReturnType<Awaited<ReturnType<typeof subir>>['novoUsuario']>>
  let cidadeId: number

  before(async () => {
    t = await subir()
  })
  after(() => t.fechar())
  beforeEach(async () => {
    t.deps.db.exec('DELETE FROM alertas_enviados; DELETE FROM preferencias;')
    t.mailer.enviados.length = 0
    t.mailer.falhar = false
    t.weather.falhar = false
    t.weather.cenario = {}
    u = await t.novoUsuario()
    cidadeId = (await t.api('POST', '/cidades', { ...t.campinas, horario_envio: '06:00' }, u.token)).body.id
  })

  it('previsão diária: só a partir do horário, uma vez por dia', async () => {
    assert.equal(await processarDiarias(t.deps, as0559), 0)
    assert.equal(await processarDiarias(t.deps, as0630), 1)
    assert.equal(await processarDiarias(t.deps, as0630), 0)
    assert.equal(t.mailer.enviados.length, 1)
    assert.match(t.mailer.enviados[0].texto, /Bom dia, Carlos/)
  })

  it('previsão diária: respeita o toggle e não envia fora da janela de 1h', async () => {
    await t.api('PUT', `/preferencias/${cidadeId}`, { receber_previsao_diaria: false }, u.token)
    assert.equal(await processarDiarias(t.deps, as0630), 0)
    await t.api('PUT', `/preferencias/${cidadeId}`, { receber_previsao_diaria: true }, u.token)
    assert.equal(await processarDiarias(t.deps, as0800), 0)
  })

  it('previsão diária: falha de e-mail registra "falhou" e não repete antes de 10 min', async () => {
    t.mailer.falhar = true
    assert.equal(await processarDiarias(t.deps, as0630), 0)
    assert.equal(contar(t, 'previsao_diaria', 'falhou'), 1)
    assert.equal(await processarDiarias(t.deps, new Date(as0630.getTime() + 60_000)), 0)
    assert.equal(contar(t, 'previsao_diaria', 'falhou'), 1)
    t.mailer.falhar = false
    assert.equal(await processarDiarias(t.deps, new Date(as0630.getTime() + 11 * 60_000)), 1)
  })

  it('previsão diária: API do tempo fora registra falha com motivo', async () => {
    t.weather.falhar = true
    await processarDiarias(t.deps, as0630)
    const row = t.deps.db.prepare("SELECT status, erro FROM alertas_enviados").get() as any
    assert.equal(row.status, 'falhou')
    assert.match(row.erro, /api fora/)
    assert.equal(t.mailer.enviados.length, 0)
  })

  it('chuva forte: dispara acima do limiar e não repete em 12h', async () => {
    t.weather.cenario = { chuvaPico: 30 }
    assert.equal(await processarAlertas(t.deps, as0630), 1)
    assert.equal(contar(t, 'chuva_forte'), 1)
    assert.equal(contar(t, 'geada'), 0)
    assert.equal(await processarAlertas(t.deps, new Date(as0630.getTime() + 30 * 60_000)), 0)
    assert.equal(await processarAlertas(t.deps, new Date(as0630.getTime() + 13 * 3600_000)), 1)
  })

  it('chuva forte: abaixo do limiar do usuário não dispara', async () => {
    t.weather.cenario = { chuvaPico: 20 }
    assert.equal(await processarAlertas(t.deps, as0630), 0)
    await t.api('PUT', `/preferencias/${cidadeId}`, { limiar_chuva_mm: 10 }, u.token)
    assert.equal(await processarAlertas(t.deps, as0630), 1)
  })

  it('geada: dispara com mínima <= limiar e respeita o toggle', async () => {
    t.weather.cenario = { minima: 2 }
    await t.api('PUT', `/preferencias/${cidadeId}`, { alerta_geada: false }, u.token)
    assert.equal(await processarAlertas(t.deps, as0630), 0)
    await t.api('PUT', `/preferencias/${cidadeId}`, { alerta_geada: true }, u.token)
    assert.equal(await processarAlertas(t.deps, as0630), 1)
    assert.match(t.mailer.enviados[0].texto, /mínima prevista de 2°C/)
  })

  it('sem condição de risco, não envia nada', async () => {
    assert.equal(await processarAlertas(t.deps, as0630), 0)
  })
})
