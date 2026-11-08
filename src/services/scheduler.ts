import cron from 'node-cron'
import { env } from '../env.js'
import type { CidadeRow, PreferenciaRow, Tipo, UsuarioRow } from '../db.js'
import { hhmmParaMinutos, partesLocais } from '../tz.js'
import { enviarERegistrar, registrarFalhaSemEnvio, type Deps } from './envio.js'
import { mensagemChuva, mensagemDiaria, mensagemGeada, periodoDoHorario } from './mensagens.js'
import { chuvaForte, geada } from './regras.js'

const ESPERA_RETRY_MS = 10 * 60 * 1000
const MAX_FALHAS = 3
const DEDUPE_ALERTA_H = 12

const verificacoes = {
  diaria: null as string | null,
  alertas: null as string | null,
}

export function statusScheduler() {
  return {
    ativo: env.schedulerOn,
    fuso_horario: env.tz,
    ultima_verificacao_diaria: verificacoes.diaria,
    ultima_verificacao_alertas: verificacoes.alertas,
  }
}

async function carregar(deps: Deps, p: PreferenciaRow) {
  const { rows: usuarios } = await deps.db.query<UsuarioRow>('SELECT * FROM usuarios WHERE id = ?', [p.usuario_id])
  const { rows: cidades } = await deps.db.query<CidadeRow>('SELECT * FROM cidades WHERE id = ?', [p.cidade_id])
  const u = usuarios[0]
  const c = cidades[0]
  return { u, c }
}

async function resumoFalhas(
  deps: Deps,
  p: PreferenciaRow,
  tipo: Tipo,
  filtro: string,
  valor: string,
  horarioAgendado?: string,
  turnoAgendado?: 'madrugada' | 'manha' | 'tarde' | 'noite',
) {
  const filtroHorario = horarioAgendado === undefined
    ? ''
    : ' AND ((turno_agendado = ? AND horario_agendado = ?) OR (turno_agendado IS NULL AND horario_agendado = ?))'
  const valores: unknown[] = [p.usuario_id, p.cidade_id, tipo, valor]
  if (horarioAgendado !== undefined) valores.push(turnoAgendado, horarioAgendado, horarioAgendado)
  const { rows } = await deps.db.query<{ n: number; ultima: string | Date | null }>(
      `SELECT COUNT(*) AS n, MAX(enviado_em) AS ultima FROM alertas_enviados
       WHERE usuario_id=? AND cidade_id=? AND tipo=? AND status='falhou'
         AND mensagem NOT LIKE '[TESTE]%' AND ${filtro}${filtroHorario}`,
      valores,
    )
  return { n: Number(rows[0].n), ultima: rows[0].ultima }
}

function throttleFalha(f: { n: number; ultima: string | Date | null }, agora: Date) {
  if (f.n >= MAX_FALHAS) return true
  return !!f.ultima && agora.getTime() - Date.parse(String(f.ultima)) < ESPERA_RETRY_MS
}

/** Previsões diárias: roda a cada minuto e envia cada horário escolhido. */
export async function processarDiarias(deps: Deps, agora = new Date()) {
  const { data, minutos } = partesLocais(agora, env.tz)
  const { rows: prefs } = await deps.db.query<PreferenciaRow>(
    `SELECT p.* FROM preferencias p
     WHERE EXISTS (SELECT 1 FROM preferencia_horarios h WHERE h.preferencia_id=p.id)`,
  )
  let enviados = 0

  for (const p of prefs) {
    const { rows: horarios } = await deps.db.query<{ horario: string }>(
      'SELECT horario FROM preferencia_horarios WHERE preferencia_id=? ORDER BY horario',
      [p.id],
    )
    for (const { horario } of horarios) {
      const turno = periodoDoHorario(horario)
      const horarioAgendado = hhmmParaMinutos(horario)
      if (minutos < horarioAgendado) continue

      const falhas = await resumoFalhas(
        deps, p, 'previsao_diaria', 'data_ref = ?', data, horario, turno,
      )
      if (minutos !== horarioAgendado && falhas.n === 0) continue

      const ja = await deps.db.query(
          `SELECT 1 FROM alertas_enviados
           WHERE usuario_id=? AND cidade_id=? AND tipo='previsao_diaria' AND data_ref=?
             AND ((turno_agendado=? AND horario_agendado=?) OR (turno_agendado IS NULL AND horario_agendado=?))
             AND status='enviado' AND mensagem NOT LIKE '[TESTE]%'`,
          [p.usuario_id, p.cidade_id, data, turno, horario, horario],
        )
      if (ja.rowCount) continue
      if (throttleFalha(falhas, agora)) continue

      const { u, c } = await carregar(deps, p)
      try {
        const prev = await deps.weather.previsao(c.latitude, c.longitude)
        const r = await enviarERegistrar(
          deps, u, c, 'previsao_diaria', mensagemDiaria(u, c, prev, turno, horario),
          agora, horario, turno,
        )
        if (r.status === 'enviado') enviados++
        else console.error(`[scheduler] falha no envio diário ${horario} (usuário ${u.id}, cidade ${c.id}): ${r.erro}`)
      } catch (e) {
        await registrarFalhaSemEnvio(
          deps, u, c, 'previsao_diaria', (e as Error).message, agora, horario, turno,
        )
      }
    }
  }
  return enviados
}

/** Alertas de chuva forte e geada: roda a cada 30 min olhando as próximas 24h. */
export async function processarAlertas(deps: Deps, agora = new Date()) {
  const { rows: prefs } = await deps.db.query<PreferenciaRow>(
    'SELECT * FROM preferencias WHERE alerta_chuva_forte = TRUE OR alerta_geada = TRUE',
  )
  const desde = new Date(agora.getTime() - DEDUPE_ALERTA_H * 3600 * 1000).toISOString()
  let enviados = 0

  for (const p of prefs) {
    const { u, c } = await carregar(deps, p)
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
      const ja = await deps.db.query(
          `SELECT 1 FROM alertas_enviados
           WHERE usuario_id=? AND cidade_id=? AND tipo=? AND status='enviado'
             AND enviado_em >= ? AND mensagem NOT LIKE '[TESTE]%'`,
          [p.usuario_id, p.cidade_id, tipo, desde],
        )
      if (ja.rowCount) continue
      if (throttleFalha(await resumoFalhas(deps, p, tipo, 'enviado_em >= ?', desde), agora)) continue
      const r = await enviarERegistrar(deps, u, c, tipo, msg, agora)
      if (r.status === 'enviado') enviados++
      else console.error(`[scheduler] falha no alerta ${tipo} (usuário ${u.id}, cidade ${c.id}): ${r.erro}`)
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
    verificacoes.diaria = new Date().toISOString()
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
    verificacoes.alertas = new Date().toISOString()
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
