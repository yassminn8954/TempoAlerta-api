import { randomBytes } from 'node:crypto'
import type { DB, UsuarioRow } from '../db.js'

interface TelegramResponse<T> {
  ok: boolean
  result: T
  description?: string
}

interface TelegramUpdate {
  update_id: number
  message?: {
    text?: string
    chat: { id: number }
  }
}

export interface TelegramNotifier {
  sendMessage(chatId: string, text: string): Promise<void>
}

async function telegramRequest<T>(token: string, method: string, body: Record<string, unknown>) {
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
    })
  } catch {
    throw new Error(`Telegram ${method} falhou por erro de rede`)
  }
  let data: TelegramResponse<T>
  try {
    data = (await response.json()) as TelegramResponse<T>
  } catch {
    throw new Error(`Telegram ${method} retornou uma resposta inválida`)
  }
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} falhou: ${data.description ?? response.statusText}`)
  }
  return data.result
}

export function criarTelegram(token: string): TelegramNotifier {
  return {
    async sendMessage(chatId, text) {
      await telegramRequest(token, 'sendMessage', { chat_id: chatId, text })
    },
  }
}

async function responder(token: string, chatId: number, text: string) {
  await telegramRequest(token, 'sendMessage', { chat_id: chatId, text })
}

export async function processarUpdateTelegram(db: DB, token: string, update: TelegramUpdate) {
  const message = update.message
  const text = message?.text?.trim()
  if (!message || !text?.startsWith('/start')) return

  const codigo = text.split(/\s+/, 2)[1]
  if (!codigo) {
    await responder(
      token,
      message.chat.id,
      'Para conectar sua conta, gere um link de vinculação nas configurações do TempoAlerta e abra-o pelo Telegram.',
    )
    return
  }

  const { rows } = await db.query<UsuarioRow>(
    'SELECT u.* FROM telegram_vinculos v JOIN usuarios u ON u.id = v.usuario_id WHERE v.codigo = ? AND v.expira_em > ?',
    [codigo, Date.now()],
  )
  const usuario = rows[0]
  if (!usuario) {
    await responder(token, message.chat.id, 'Esse link expirou ou já foi usado. Gere um novo link no TempoAlerta.')
    return
  }

  try {
    await db.query('UPDATE usuarios SET telegram_chat_id = ? WHERE id = ?', [
      String(message.chat.id),
      usuario.id,
    ])
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      await responder(token, message.chat.id, 'Esta conta do Telegram já está vinculada a outro usuário.')
      return
    }
    throw error
  }

  await db.query('DELETE FROM telegram_vinculos WHERE usuario_id = ?', [usuario.id])
  await responder(token, message.chat.id, 'Conta vinculada! Você receberá seus alertas do TempoAlerta por aqui.')
}

export async function iniciarPollingTelegram(db: DB, token: string) {
  let offset = 0
  console.log('Bot do Telegram conectado; aguardando vínculos.')
  while (true) {
    try {
      const updates = await telegramRequest<TelegramUpdate[]>(token, 'getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message'],
      })
      for (const update of updates) {
        offset = update.update_id + 1
        try {
          await processarUpdateTelegram(db, token, update)
        } catch (error) {
          console.error('[telegram] não foi possível processar uma atualização:', error)
        }
      }
    } catch (error) {
      console.error('[telegram] erro de conexão; nova tentativa em 5 segundos:', error)
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
}

export async function criarLinkTelegram(db: DB, usuarioId: number, botUsername: string) {
  const codigo = randomBytes(24).toString('base64url')
  const expiraEm = Date.now() + 10 * 60_000
  await db.query('DELETE FROM telegram_vinculos WHERE usuario_id = ? OR expira_em <= ?', [usuarioId, Date.now()])
  await db.query(
    'INSERT INTO telegram_vinculos (codigo, usuario_id, expira_em) VALUES (?,?,?)',
    [codigo, usuarioId, expiraEm],
  )
  return {
    url: `https://t.me/${botUsername}?start=${codigo}`,
    expira_em: new Date(expiraEm).toISOString(),
  }
}
