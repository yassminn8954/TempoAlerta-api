import { env } from '../env.js'
import type { CidadeRow, DB, Tipo, UsuarioRow } from '../db.js'
import { partesLocais } from '../tz.js'
import type { Mailer } from './mailer.js'
import type { Mensagem } from './mensagens.js'
import type { WeatherClient } from './openMeteo.js'
import type { TelegramNotifier } from './telegram.js'

export interface Deps {
  db: DB
  weather: WeatherClient
  mailer?: Mailer
  telegram?: TelegramNotifier
}

/** Envia o e-mail e grava o resultado em alertas_enviados (enviado ou falhou). */
export async function enviarERegistrar(
  deps: Deps,
  u: UsuarioRow,
  c: CidadeRow,
  tipo: Tipo,
  msg: Mensagem,
  agora: Date,
): Promise<{ id: number; status: 'enviado' | 'falhou' }> {
  let algumEnviado = false
  const erros: string[] = []
  if (deps.mailer) {
    try {
      await deps.mailer.enviar(u.email, msg.assunto, msg.texto, msg.html)
      algumEnviado = true
    } catch (e) {
      erros.push(`E-mail: ${(e as Error).message}`)
    }
  } else {
    erros.push('E-mail: canal desativado')
  }
  if (u.telegram_chat_id) {
    if (deps.telegram) {
      try {
        await deps.telegram.sendMessage(u.telegram_chat_id, `${msg.assunto}\n\n${msg.texto}`)
        algumEnviado = true
      } catch (e) {
        erros.push(`Telegram: ${(e as Error).message}`)
      }
    } else {
      erros.push('Telegram: envio não configurado no servidor')
    }
  }
  const status: 'enviado' | 'falhou' = algumEnviado ? 'enviado' : 'falhou'
  const erro = erros.length ? erros.join('; ') : null
  const result = await deps.db.query<{ id: number }>(
      `INSERT INTO alertas_enviados
         (usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, enviado_em, status, erro)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
      u.id,
      c.id,
      tipo,
      msg.texto,
      JSON.stringify(msg.dados),
      partesLocais(agora, env.tz).data,
      agora.toISOString(),
      status,
      erro,
      ],
    )
  return { id: Number(result.rows[0].id), status }
}

export async function registrarFalhaSemEnvio(
  deps: Deps,
  u: UsuarioRow,
  c: CidadeRow,
  tipo: Tipo,
  motivo: string,
  agora: Date,
) {
  await deps.db.query(
      `INSERT INTO alertas_enviados
         (usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, enviado_em, status, erro)
       VALUES (?,?,?, ?,NULL,?,?,'falhou',?)`,
      [
      u.id,
      c.id,
      tipo,
      'Não foi possível obter a previsão para gerar esta mensagem.',
      partesLocais(agora, env.tz).data,
      agora.toISOString(),
      motivo,
      ],
    )
}
