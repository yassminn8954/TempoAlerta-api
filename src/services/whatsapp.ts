import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DB } from '../db.js'

export interface WhatsAppConfig {
  accessToken: string
  phoneNumberId: string
  businessNumber: string
  verifyToken: string
  appSecret: string
  templateName: string
  templateLanguage: string
  graphApiVersion: string
}

export interface WhatsAppNotifier {
  sendMessage(to: string, text: string): Promise<void>
  sendText(to: string, text: string): Promise<void>
}

export function whatsappConfigurado(config: WhatsAppConfig): boolean {
  return Boolean(config.accessToken && config.phoneNumberId && config.templateName)
}

export function verificarAssinaturaWhatsApp(
  body: Buffer,
  signature: string | undefined,
  appSecret: string,
): boolean {
  if (!signature || !appSecret) return false
  const expected = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`
  const receivedBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

export function criarWhatsApp(config: WhatsAppConfig): WhatsAppNotifier {
  async function post(to: string, payload: Record<string, unknown>) {
    const response = await fetch(
      `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`WhatsApp Cloud API respondeu ${response.status}: ${body.slice(0, 500)}`)
    }
  }

  return {
    async sendMessage(to, text) {
      if (!whatsappConfigurado(config)) throw new Error('Canal WhatsApp não configurado')
      await post(to, {
        type: 'template',
        template: {
          name: config.templateName,
          language: { code: config.templateLanguage },
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: `${text}`.slice(0, 1024) }],
          }],
        },
      })
    },
    async sendText(to, text) {
      await post(to, {
        type: 'text',
        text: { preview_url: false, body: text.slice(0, 4096) },
      })
    },
  }
}

export async function criarLinkWhatsApp(db: DB, usuarioId: number, businessNumber: string) {
  if (!businessNumber) throw new Error('Número comercial do WhatsApp não configurado')
  const codigo = randomBytes(18).toString('base64url')
  const expiraEm = Date.now() + 10 * 60 * 1000
  await db.query('DELETE FROM whatsapp_vinculos WHERE usuario_id = ?', [usuarioId])
  await db.query(
    'INSERT INTO whatsapp_vinculos (codigo, usuario_id, expira_em) VALUES (?,?,?)',
    [codigo, usuarioId, expiraEm],
  )
  const texto = `VINCULAR ${codigo}`
  return {
    url: `https://wa.me/${businessNumber}?text=${encodeURIComponent(texto)}`,
    texto,
    expira_em: new Date(expiraEm).toISOString(),
  }
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string
          type?: string
          text?: { body?: string }
        }>
      }
    }>
  }>
}

export async function processarWebhookWhatsApp(
  db: DB,
  notifier: WhatsAppNotifier | undefined,
  payload: WhatsAppWebhookPayload,
) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const from = message.from?.replace(/\D/g, '')
        const text = message.type === 'text' ? message.text?.body?.trim() : undefined
        if (from && text && /^(PARAR|SAIR|STOP|CANCELAR)$/i.test(text)) {
          const removed = await db.query(
            'UPDATE usuarios SET whatsapp_phone = NULL WHERE whatsapp_phone = ?',
            [from],
          )
          if (removed.rowCount && notifier) {
            await notifier.sendText(from, 'WhatsApp desconectado. Você não receberá mais alertas por este canal.')
          }
          continue
        }
        const match = text?.match(/^VINCULAR\s+([A-Za-z0-9_-]{20,40})$/i)
        if (!from || !match) continue

        const result = await db.transaction(async (tx) => {
          const claimed = await tx.query<{ usuario_id: number }>(
            'DELETE FROM whatsapp_vinculos WHERE codigo = ? AND expira_em > ? RETURNING usuario_id',
            [match[1], Date.now()],
          )
          const usuarioId = claimed.rows[0]?.usuario_id
          if (!usuarioId) return false
          await tx.query('UPDATE usuarios SET whatsapp_phone = ? WHERE id = ?', [from, usuarioId])
          return true
        })
        if (result && notifier) {
          await notifier.sendText(from, 'WhatsApp conectado ao TempoAlerta. Você receberá seus alertas por aqui. Para cancelar, desconecte o canal nas configurações.')
        }
      }
    }
  }
}
