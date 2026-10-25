import { env } from '../env.js'
import type { CidadeRow, DB, Tipo, UsuarioRow } from '../db.js'
import { partesLocais } from '../tz.js'
import type { Mailer } from './mailer.js'
import type { Mensagem } from './mensagens.js'
import type { WeatherClient } from './openMeteo.js'

export interface Deps {
  db: DB
  weather: WeatherClient
  mailer: Mailer
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
  let status: 'enviado' | 'falhou' = 'enviado'
  let erro: string | null = null
  try {
    await deps.mailer.enviar(u.email, msg.assunto, msg.texto, msg.html)
  } catch (e) {
    status = 'falhou'
    erro = (e as Error).message
  }
  const info = deps.db
    .prepare(
      `INSERT INTO alertas_enviados
         (usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, enviado_em, status, erro)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      u.id,
      c.id,
      tipo,
      msg.texto,
      JSON.stringify(msg.dados),
      partesLocais(agora, env.tz).data,
      agora.toISOString(),
      status,
      erro,
    )
  return { id: Number(info.lastInsertRowid), status }
}

export function registrarFalhaSemEnvio(
  deps: Deps,
  u: UsuarioRow,
  c: CidadeRow,
  tipo: Tipo,
  motivo: string,
  agora: Date,
) {
  deps.db
    .prepare(
      `INSERT INTO alertas_enviados
         (usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, enviado_em, status, erro)
       VALUES (?,?,?,?,NULL,?,?,'falhou',?)`,
    )
    .run(
      u.id,
      c.id,
      tipo,
      'Não foi possível obter a previsão para gerar esta mensagem.',
      partesLocais(agora, env.tz).data,
      agora.toISOString(),
      motivo,
    )
}
