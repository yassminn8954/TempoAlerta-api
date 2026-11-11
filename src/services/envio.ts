import { env } from '../env.js'
import type { CidadeRow, DB, Tipo, UsuarioRow } from '../db.js'
import { partesLocais } from '../tz.js'
import type { Mensagem, PeriodoDiario } from './mensagens.js'
import type { WeatherClient } from './weather.js'
import type { TelegramNotifier } from './telegram.js'

export interface Deps {
  db: DB
  weather: WeatherClient
  telegram?: TelegramNotifier
}

/** Envia pelo Telegram e grava o resultado em alertas_enviados (enviado ou falhou). */
export async function enviarERegistrar(
  deps: Deps,
  u: UsuarioRow,
  c: CidadeRow,
  tipo: Tipo,
  msg: Mensagem,
  agora: Date,
  horarioAgendado?: string,
  turnoAgendado?: PeriodoDiario,
): Promise<{ id: number; status: 'enviado' | 'falhou'; erro: string | null }> {
  let algumEnviado = false
  const erros: string[] = []
  if (u.telegram_chat_id) {
    if (deps.telegram) {
      try {
        await deps.telegram.sendMessage(u.telegram_chat_id, `${msg.assunto}\n\n${msg.texto}`)
        algumEnviado = true
      } catch (e) {
        erros.push(`Telegram: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      erros.push('Telegram: envio não configurado no servidor')
    }
  } else {
    erros.push(env.telegramBotToken
      ? 'Telegram: esta conta não está vinculada ao bot'
      : 'Telegram: bot não configurado no servidor')
  }
  const status: 'enviado' | 'falhou' = algumEnviado ? 'enviado' : 'falhou'
  const erro = erros.length ? erros.join('; ') : null
  const result = await deps.db.query<{ id: number }>(
      `INSERT INTO alertas_enviados
         (usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, horario_agendado, turno_agendado, enviado_em, status, erro)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
      u.id,
      c.id,
      tipo,
      msg.texto,
      JSON.stringify(msg.dados),
      partesLocais(agora, env.tz).data,
      horarioAgendado ?? null,
      turnoAgendado ?? null,
      agora.toISOString(),
      status,
      erro,
      ],
    )
  return { id: Number(result.rows[0].id), status, erro }
}

export async function registrarFalhaSemEnvio(
  deps: Deps,
  u: UsuarioRow,
  c: CidadeRow,
  tipo: Tipo,
  motivo: string,
  agora: Date,
  horarioAgendado?: string,
  turnoAgendado?: PeriodoDiario,
) {
  await deps.db.query(
      `INSERT INTO alertas_enviados
         (usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, horario_agendado, turno_agendado, enviado_em, status, erro)
       VALUES (?,?,?, ?,NULL,?,?,?,?, 'falhou',?)`,
      [
      u.id,
      c.id,
      tipo,
      'Não foi possível obter a previsão para gerar esta mensagem.',
      partesLocais(agora, env.tz).data,
      horarioAgendado ?? null,
      turnoAgendado ?? null,
      agora.toISOString(),
      motivo,
      ],
    )
}
