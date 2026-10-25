import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { subir } from './helpers.js'

describe('API', () => {
  let t: Awaited<ReturnType<typeof subir>>
  before(async () => {
    t = await subir()
  })
  after(() => t.fechar())

  it('cadastro, login e /me; rejeita duplicado e senha errada', async () => {
    const r = await t.api('POST', '/auth/cadastro', { nome: 'Ana Lima', email: 'ANA@x.com', senha: '12345678', perfil: 'organizador_eventos' })
    assert.equal(r.status, 201)
    assert.equal(r.body.usuario.email, 'ana@x.com')
    assert.equal(r.body.usuario.senha_hash, undefined)

    assert.equal((await t.api('POST', '/auth/cadastro', { nome: 'Ana', email: 'ana@x.com', senha: '12345678' })).status, 409)
    assert.equal((await t.api('POST', '/auth/login', { email: 'ana@x.com', senha: 'errada' })).status, 401)
    const l = await t.api('POST', '/auth/login', { email: 'ana@x.com', senha: '12345678' })
    assert.equal(l.status, 200)
    const me = await t.api('GET', '/auth/me', undefined, l.body.token)
    assert.equal(me.body.nome, 'Ana Lima')
    const pf = await t.api('PATCH', '/auth/me', { perfil: 'produtor_rural' }, l.body.token)
    assert.equal(pf.body.perfil, 'produtor_rural')
    assert.equal((await t.api('PATCH', '/auth/me', { perfil: 'x' }, l.body.token)).status, 400)
  })

  it('valida entrada e exige token', async () => {
    const r = await t.api('POST', '/auth/cadastro', { nome: 'A', email: 'x', senha: '1' })
    assert.equal(r.status, 400)
    assert.ok(r.body.detalhes.length >= 2)
    assert.equal((await t.api('GET', '/cidades')).status, 401)
    assert.equal((await t.api('GET', '/cidades', undefined, 'lixo')).status, 401)
  })

  it('cidades: primeira vira principal, trocar principal, remover promove outra', async () => {
    const u = await t.novoUsuario()
    const a = await t.api('POST', '/cidades', t.campinas, u.token)
    const b = await t.api('POST', '/cidades', { ...t.holambra, horario_envio: '07:15' }, u.token)
    assert.equal(a.status, 201)
    assert.equal(a.body.principal, true)
    assert.equal(b.body.principal, false)
    assert.equal(b.body.preferencia.horario_envio, '07:15')
    assert.equal((await t.api('POST', '/cidades', t.campinas, u.token)).status, 409)

    await t.api('PATCH', `/cidades/${b.body.id}/principal`, undefined, u.token)
    let lista = (await t.api('GET', '/cidades', undefined, u.token)).body
    assert.equal(lista[0].nome, 'Holambra')
    assert.equal(lista.filter((c: any) => c.principal).length, 1)

    assert.equal((await t.api('DELETE', `/cidades/${b.body.id}`, undefined, u.token)).status, 204)
    lista = (await t.api('GET', '/cidades', undefined, u.token)).body
    assert.equal(lista.length, 1)
    assert.equal(lista[0].principal, true)
  })

  it('cidade é compartilhada, preferências são por usuário', async () => {
    const u1 = await t.novoUsuario()
    const u2 = await t.novoUsuario()
    const c1 = await t.api('POST', '/cidades', t.campinas, u1.token)
    const c2 = await t.api('POST', '/cidades', t.campinas, u2.token)
    assert.equal(c1.body.id, c2.body.id)
    await t.api('PUT', `/preferencias/${c1.body.id}`, { horario_envio: '05:00' }, u1.token)
    const p2 = await t.api('GET', `/preferencias/${c2.body.id}`, undefined, u2.token)
    assert.equal(p2.body.horario_envio, '06:00')
  })

  it('preferências: atualização parcial e validação', async () => {
    const u = await t.novoUsuario()
    const c = (await t.api('POST', '/cidades', t.campinas, u.token)).body
    const ok = await t.api('PUT', `/preferencias/${c.id}`, { alerta_geada: false, limiar_chuva_mm: 40 }, u.token)
    assert.equal(ok.status, 200)
    assert.equal(ok.body.alerta_geada, false)
    assert.equal(ok.body.limiar_chuva_mm, 40)
    assert.equal(ok.body.alerta_chuva_forte, true)
    assert.equal((await t.api('PUT', `/preferencias/${c.id}`, { horario_envio: '25:99' }, u.token)).status, 400)
    // outro usuário não enxerga
    const outro = await t.novoUsuario()
    assert.equal((await t.api('GET', `/preferencias/${c.id}`, undefined, outro.token)).status, 404)
  })

  it('previsão: formato para o dashboard e alertas ativos pelos limiares do usuário', async () => {
    const u = await t.novoUsuario()
    const c = (await t.api('POST', '/cidades', t.campinas, u.token)).body
    t.weather.cenario = {}
    let p = await t.api('GET', `/previsao/${c.id}`, undefined, u.token)
    assert.equal(p.status, 200)
    assert.equal(p.body.dias.length, 7)
    assert.equal(p.body.dias[0].dia_semana, 'Hoje')
    assert.equal(p.body.fonte, 'Open-Meteo')
    assert.deepEqual(p.body.alertas_ativos, [])
    assert.equal(p.body.status_geral.risco_geada_48h, false)

    t.weather.cenario = { chuvaPico: 32, minima: 2 }
    p = await t.api('GET', `/previsao/${c.id}`, undefined, u.token)
    assert.deepEqual(p.body.alertas_ativos.map((a: any) => a.tipo).sort(), ['chuva_forte', 'geada'])
    assert.equal(p.body.status_geral.risco_geada_48h, true)

    t.weather.falhar = true
    assert.equal((await t.api('GET', `/previsao/${c.id}`, undefined, u.token)).status, 500) // erro genérico do fake
    t.weather.falhar = false
    t.weather.cenario = {}
  })

  it('busca de cidades usa o cliente de geocodificação', async () => {
    const u = await t.novoUsuario()
    const r = await t.api('GET', '/cidades/busca?q=camp', undefined, u.token)
    assert.equal(r.body[0].uf, 'SP')
    assert.equal((await t.api('GET', '/cidades/busca?q=c', undefined, u.token)).status, 400)
  })

  it('histórico: teste de envio, filtros, detalhe e isolamento entre usuários', async () => {
    const u = await t.novoUsuario()
    const c = (await t.api('POST', '/cidades', t.campinas, u.token)).body
    const a = await t.api('POST', '/alertas/teste', { cidadeId: c.id, tipo: 'previsao_diaria' }, u.token)
    assert.equal(a.body.status, 'enviado')
    await t.api('POST', '/alertas/teste', { cidadeId: c.id, tipo: 'geada' }, u.token)
    assert.equal(t.mailer.enviados.at(-1)!.para, u.email)

    const todos = await t.api('GET', '/alertas', undefined, u.token)
    assert.equal(todos.body.total, 2)
    assert.equal((await t.api('GET', '/alertas?tipo=geada', undefined, u.token)).body.total, 1)
    assert.equal((await t.api('GET', '/alertas?busca=geada&periodo=30', undefined, u.token)).body.total, 1)
    assert.equal((await t.api('GET', '/alertas?busca=100%25', undefined, u.token)).body.total, 0)

    const det = await t.api('GET', `/alertas/${a.body.id}`, undefined, u.token)
    assert.equal(det.body.destinatario, u.email)
    assert.ok(det.body.dados)

    const outro = await t.novoUsuario()
    assert.equal((await t.api('GET', `/alertas/${a.body.id}`, undefined, outro.token)).status, 404)
    assert.equal((await t.api('GET', '/alertas', undefined, outro.token)).body.total, 0)
  })
})
