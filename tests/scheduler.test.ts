import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { processarAlertas, processarDiarias } from '../src/services/scheduler.js'
import { subir } from './helpers.js'

// America/Sao_Paulo = UTC-3 (sem horário de verão desde 2019)
const as0630 = new Date('2026-10-26T09:30:00Z')
const as0559 = new Date('2026-10-26T08:59:00Z')
const as0600 = new Date('2026-10-26T09:00:00Z')
const as0601 = new Date('2026-10-26T09:01:00Z')
const as0603 = new Date('2026-10-26T09:03:00Z')
const as1200 = new Date('2026-10-26T15:00:00Z')
const as0800 = new Date('2026-10-26T11:00:00Z')
const as1600 = new Date('2026-10-26T19:00:00Z')
const as2000 = new Date('2026-10-26T23:00:00Z')

const contar = async (t: Awaited<ReturnType<typeof subir>>, tipo: string, status = 'enviado') => {
  const { rows } = await t.deps.db.query<{ n: number }>(
    'SELECT COUNT(*) n FROM alertas_enviados WHERE tipo=? AND status=?',
    [tipo, status],
  )
  return Number(rows[0].n)
}

describe('agendador', () => {
  let t: Awaited<ReturnType<typeof subir>>
  let u: Awaited<ReturnType<Awaited<ReturnType<typeof subir>>['novoUsuario']>>
  let cidadeId: number

  before(async () => {
    t = await subir()
  })
  after(() => t.fechar())
  beforeEach(async () => {
    await t.deps.db.query('DELETE FROM alertas_enviados')
    await t.deps.db.query('DELETE FROM preferencias')
    t.mailer.enviados.length = 0
    t.mailer.falhar = false
    t.weather.falhar = false
    t.weather.cenario = {}
    u = await t.novoUsuario()
    cidadeId = (await t.api('POST', '/cidades', { ...t.campinas, horario_envio: '06:00' }, u.token)).body.id
  })

  it('previsão diária: envia no minuto exato escolhido, nunca antes ou atrasado', async () => {
    assert.equal(await processarDiarias(t.deps, as0559), 0)
    assert.equal(await processarDiarias(t.deps, as0600), 1)
    assert.equal(await processarDiarias(t.deps, as0601), 0)
    assert.equal(t.mailer.enviados.length, 1)
    assert.match(t.mailer.enviados[0].texto, /Bom dia, Carlos/)
  })

  it('envia a atualização da tarde no horário configurado com mensagem própria do período', async () => {
    assert.equal(await processarDiarias(t.deps, as1600), 1)
    assert.match(t.mailer.enviados[0].texto, /Boa tarde, Carlos/)
    assert.match(t.mailer.enviados[0].assunto, /tarde/)
    const { rows } = await t.deps.db.query<{ turno_agendado: string; horario_agendado: string }>(
      `SELECT turno_agendado, horario_agendado FROM alertas_enviados WHERE tipo='previsao_diaria'`,
    )
    assert.deepEqual(rows, [{ turno_agendado: 'tarde', horario_agendado: '16:00' }])
  })

  it('envia até quatro previsões nos horários escolhidos com mensagem adequada ao período', async () => {
    await t.api('PUT', `/preferencias/${cidadeId}`, {
      horarios_previsao: ['06:00', '12:00', '16:00', '20:00'],
    }, u.token)
    assert.equal(await processarDiarias(t.deps, as0600), 1)
    assert.equal(await processarDiarias(t.deps, as1200), 1)
    assert.equal(await processarDiarias(t.deps, as1600), 1)
    assert.equal(await processarDiarias(t.deps, as2000), 1)
    assert.equal(t.mailer.enviados.length, 4)
    assert.match(t.mailer.enviados[0].texto, /Bom dia, Carlos/)
    assert.match(t.mailer.enviados[1].texto, /Boa tarde, Carlos/)
    assert.match(t.mailer.enviados[2].texto, /Boa tarde, Carlos/)
    assert.match(t.mailer.enviados[3].texto, /Boa noite, Carlos/)
    assert.match(t.mailer.enviados[2].texto, /programada para 16:00/)
  })

  it('faz retry independente para horários adicionais', async () => {
    await t.api('PUT', `/preferencias/${cidadeId}`, { horarios_previsao: ['06:00', '12:00'] }, u.token)
    t.mailer.falhar = true
    assert.equal(await processarDiarias(t.deps, as0600), 0)
    assert.equal(await contar(t, 'previsao_diaria', 'falhou'), 1)
    t.mailer.falhar = false
    assert.equal(await processarDiarias(t.deps, new Date(as0600.getTime() + 11 * 60_000)), 1)
    t.mailer.falhar = true
    assert.equal(await processarDiarias(t.deps, as1200), 0)
    t.mailer.falhar = false
    assert.equal(await processarDiarias(t.deps, new Date(as1200.getTime() + 11 * 60_000)), 1)
    assert.equal(await contar(t, 'previsao_diaria', 'enviado'), 2)
  })

  it('permite desativar todos os horários removendo-os', async () => {
    await t.api('PUT', `/preferencias/${cidadeId}`, { horarios_previsao: [] }, u.token)
    assert.equal(await processarDiarias(t.deps, as0600), 0)
    assert.equal(await processarDiarias(t.deps, as1600), 0)
    assert.equal(await contar(t, 'previsao_diaria'), 0)
  })

  it('não envia previsão diária atrasada se o horário daquele dia foi perdido', async () => {
    assert.equal(await processarDiarias(t.deps, as0630), 0)
    assert.equal(await contar(t, 'previsao_diaria'), 0)
    assert.equal(t.mailer.enviados.length, 0)
  })

  it('envia novamente no mesmo dia se a preferência for alterada para um novo horário', async () => {
    assert.equal(await processarDiarias(t.deps, as0600), 1)
    assert.equal(t.mailer.enviados.length, 1)

    await t.api('PUT', `/preferencias/${cidadeId}`, { horario_envio: '06:03' }, u.token)
    assert.equal(await processarDiarias(t.deps, as0603), 1)
    assert.equal(t.mailer.enviados.length, 2)

    const { rows } = await t.deps.db.query<{ horario_agendado: string }>(
      `SELECT horario_agendado FROM alertas_enviados
       WHERE usuario_id=? AND cidade_id=? AND tipo='previsao_diaria' AND status='enviado'
       ORDER BY enviado_em`,
      [u.id, cidadeId],
    )
    assert.deepEqual(rows.map((row) => row.horario_agendado), ['06:00', '06:03'])
    assert.equal(await processarDiarias(t.deps, as0603), 0)
    assert.equal(t.mailer.enviados.length, 2)
  })

  it('previsão diária: testes manuais não contam como envio nem como limite de falhas', async () => {
    for (let i = 0; i < 3; i++) {
      await t.deps.db.query(
        `INSERT INTO alertas_enviados
           (usuario_id,cidade_id,tipo,mensagem,data_ref,enviado_em,status,erro)
         VALUES (?,?,?,?,?,?,?,?)`,
        [u.id, cidadeId, 'previsao_diaria', '[TESTE] falha manual', '2026-10-26',
          new Date(as0600.getTime() - (i + 1) * 60_000).toISOString(), 'falhou', 'erro de teste'],
      )
    }
    await t.deps.db.query(
      `INSERT INTO alertas_enviados
         (usuario_id,cidade_id,tipo,mensagem,data_ref,enviado_em,status)
       VALUES (?,?,?,?,?,?,?)`,
      [u.id, cidadeId, 'previsao_diaria', '[TESTE] envio manual', '2026-10-26',
        as0600.toISOString(), 'enviado'],
    )

    assert.equal(await processarDiarias(t.deps, as0600), 1)
    assert.equal(t.mailer.enviados.length, 1)
    assert.equal(await contar(t, 'previsao_diaria', 'enviado'), 2)
  })

  it('previsão diária: respeita o toggle e não envia fora do minuto escolhido', async () => {
    await t.api('PUT', `/preferencias/${cidadeId}`, { receber_previsao_diaria: false }, u.token)
    assert.equal(await processarDiarias(t.deps, as0600), 0)
    await t.api('PUT', `/preferencias/${cidadeId}`, { receber_previsao_diaria: true }, u.token)
    assert.equal(await processarDiarias(t.deps, as0800), 0)
  })

  it('previsão diária: falha de e-mail registra "falhou" e não repete antes de 10 min', async () => {
    t.mailer.falhar = true
    assert.equal(await processarDiarias(t.deps, as0600), 0)
    assert.equal(await contar(t, 'previsao_diaria', 'falhou'), 1)
    assert.equal(await processarDiarias(t.deps, new Date(as0600.getTime() + 60_000)), 0)
    assert.equal(await contar(t, 'previsao_diaria', 'falhou'), 1)
    t.mailer.falhar = false
    assert.equal(await processarDiarias(t.deps, new Date(as0600.getTime() + 11 * 60_000)), 1)
  })

  it('previsão diária: API do tempo fora registra falha com motivo', async () => {
    t.weather.falhar = true
    await processarDiarias(t.deps, as0600)
    const { rows } = await t.deps.db.query<{ status: string; erro: string }>(
      'SELECT status, erro FROM alertas_enviados',
    )
    const row = rows[0]
    assert.equal(row.status, 'falhou')
    assert.match(row.erro, /api fora/)
    assert.equal(t.mailer.enviados.length, 0)
  })

  it('chuva forte: dispara acima do limiar e não repete em 12h', async () => {
    t.weather.cenario = { chuvaPico: 30 }
    assert.equal(await processarAlertas(t.deps, as0630), 1)
    assert.equal(await contar(t, 'chuva_forte'), 1)
    assert.equal(await contar(t, 'geada'), 0)
    assert.equal(await processarAlertas(t.deps, new Date(as0630.getTime() + 30 * 60_000)), 0)
    assert.equal(await processarAlertas(t.deps, new Date(as0630.getTime() + 13 * 3600_000)), 1)
  })

  it('alertas automáticos ignoram testes manuais enviados ou com falha', async () => {
    t.weather.cenario = { chuvaPico: 30 }
    for (const status of ['falhou', 'falhou', 'falhou', 'enviado']) {
      await t.deps.db.query(
        `INSERT INTO alertas_enviados
           (usuario_id,cidade_id,tipo,mensagem,data_ref,enviado_em,status,erro)
         VALUES (?,?,?,?,?,?,?,?)`,
        [u.id, cidadeId, 'chuva_forte', '[TESTE] alerta manual', '2026-10-26',
          new Date(as0630.getTime() - 60_000).toISOString(), status, status === 'falhou' ? 'erro de teste' : null],
      )
    }

    assert.equal(await processarAlertas(t.deps, as0630), 1)
    assert.equal(await contar(t, 'chuva_forte', 'enviado'), 2)
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
