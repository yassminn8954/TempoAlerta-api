import cron from 'node-cron'
import { env } from '../env.js'
import type { CidadeRow, PreferenciaRow, Tipo, UsuarioRow } from '../db.js'
import { hhmmParaMinutos, partesLocais } from '../tz.js'
import { enviarERegistrar, registrarFalhaSemEnvio, type Deps } from './envio.js'
import { mensagemChuva, mensagemDiaria, mensagemGeada } from './mensagens.js'
import { chuvaForte, geada } from './regras.js'

const JANELA_ENVIO_MIN = 60 // se o servidor ficou fora do ar, ainda envia até 1h depois do horário
const ESPERA_RETRY_MS = 10 * 60 * 1000
const MAX_FALHAS = 3
const DEDUPE_ALERTA_H = 12

function carregar(deps: Deps, p: PreferenciaRow) {
  const u = deps.db.prepare('SELECT * FROM usuarios WHERE id = ?').get(p.usuario_id) as UsuarioRow
  const c = deps.db.prepare('SELECT * FROM cidades WHERE id = ?').get(p.cidade_id) as CidadeRow
  return { u, c }
}

function resumoFalhas(deps: Deps, p: PreferenciaRow, tipo: Tipo, filtro: string, valor: string) {
  return deps.db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(enviado_em) AS ultima FROM alertas_enviados
       WHERE usuario_id=? AND cidade_id=? AND tipo=? AND status='falhou' AND ${filtro}`,
    )
    .get(p.usuario_id, p.cidade_id, tipo, valor) as { n: number; ultima: string | null }
}

function throttleFalha(f: { n: number; ultima: string | null }, agora: Date) {
  if (f.n >= MAX_FALHAS) return true
  return !!f.ultima && agora.getTime() - Date.parse(f.ultima) < ESPERA_RETRY_MS
}

/** Previsão diária: roda a cada minuto e envia a quem está no horário escolhido. */
export async function processarDiarias(deps: Deps, agora = new Date()) {
  const { data, minutos } = partesLocais(agora, env.tz)
  const prefs = deps.db
    .prepare('SELECT * FROM preferencias WHERE receber_previsao_diaria = 1')
    .all() as PreferenciaRow[]
  let enviados = 0

  for (const p of prefs) {
    const atraso = minutos - hhmmParaMinutos(p.horario_envio)
    if (atraso < 0 || atraso >= JANELA_ENVIO_MIN) continue

    const ja = deps.db
      .prepare(
        `SELECT 1 FROM alertas_enviados
         WHERE usuario_id=? AND cidade_id=? AND tipo='previsao_diaria' AND data_ref=? AND status='enviado'`,
      )
      .get(p.usuario_id, p.cidade_id, data)
    if (ja) continue
    if (throttleFalha(resumoFalhas(deps, p, 'previsao_diaria', 'data_ref = ?', data), agora)) continue

    const { u, c } = carregar(deps, p)
    try {
      const prev = await deps.weather.previsao(c.latitude, c.longitude)
      const r = await enviarERegistrar(deps, u, c, 'previsao_diaria', mensagemDiaria(u, c, prev), agora)
      if (r.status === 'enviado') enviados++
    } catch (e) {
      registrarFalhaSemEnvio(deps, u, c, 'previsao_diaria', (e as Error).message, agora)
    }
  }
  return enviados
}

/** Alertas de chuva forte e geada: roda a cada 30 min olhando as próximas 24h. */
export async function processarAlertas(deps: Deps, agora = new Date()) {
  const prefs = deps.db
    .prepare('SELECT * FROM preferencias WHERE alerta_chuva_forte = 1 OR alerta_geada = 1')
    .all() as PreferenciaRow[]
  const desde = new Date(agora.getTime() - DEDUPE_ALERTA_H * 3600 * 1000).toISOString()
  let enviados = 0

  for (const p of prefs) {
    const { u, c } = carregar(deps, p)
    let prev
    try {
      prev = await deps.weather.previsao(c.latitude, c.longitude)
    } catch (e) {
      console.error(`[alertas] previsão falhou para ${c.nome}:`, (e as Error).message)
      continue
    }

    const candidatos: { tipo: Tipo; msg: ReturnType<typeof mensagemChuva> }[] = []
    if (p.alerta_chuva_forte) {
      const e = chuvaForte(prev, p.limiar_chuva_mm)
      if (e) candidatos.push({ tipo: 'chuva_forte', msg: mensagemChuva(u, c, e, p.limiar_chuva_mm) })
    }
    if (p.alerta_geada) {
      const e = geada(prev, p.limiar_geada_c)
      if (e) candidatos.push({ tipo: 'geada', msg: mensagemGeada(u, c, e, p.limiar_geada_c) })
    }

    for (const { tipo, msg } of candidatos) {
      const ja = deps.db
        .prepare(
          `SELECT 1 FROM alertas_enviados
           WHERE usuario_id=? AND cidade_id=? AND tipo=? AND status='enviado' AND enviado_em >= ?`,
        )
        .get(p.usuario_id, p.cidade_id, tipo, desde)
      if (ja) continue
      if (throttleFalha(resumoFalhas(deps, p, tipo, 'enviado_em >= ?', desde), agora)) continue
      const r = await enviarERegistrar(deps, u, c, tipo, msg, agora)
      if (r.status === 'enviado') enviados++
    }
  }
  return enviados
}

export function iniciarScheduler(deps: Deps) {
  let diariasRodando = false
  let alertasRodando = false

  cron.schedule('* * * * *', async () => {
    if (diariasRodando) return
    diariasRodando = true
    try {
      await processarDiarias(deps)
    } catch (e) {
      console.error('[scheduler diárias]', e)
    } finally {
      diariasRodando = false
    }
  })

  cron.schedule('*/30 * * * *', async () => {
    if (alertasRodando) return
    alertasRodando = true
    try {
      await processarAlertas(deps)
    } catch (e) {
      console.error('[scheduler alertas]', e)
    } finally {
      alertasRodando = false
    }
  })

  console.log('Agendador ligado: previsão diária (a cada minuto) e alertas (a cada 30 min)')
}
