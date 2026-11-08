import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { openTestDb } from '../src/db.js'
import {
  criarWhatsApp,
  criarLinkWhatsApp,
  processarWebhookWhatsApp,
  verificarAssinaturaWhatsApp,
  type WhatsAppNotifier,
} from '../src/services/whatsapp.js'

describe('WhatsApp Cloud API', () => {
  it('envia alertas com template aprovado e reporta falhas do provedor', async () => {
    const config = {
      accessToken: 'test-token',
      phoneNumberId: '12345',
      businessNumber: '5511999999999',
      verifyToken: 'verify',
      appSecret: 'app-secret',
      templateName: 'tempoalerta_alerta',
      templateLanguage: 'pt_BR',
      graphApiVersion: 'v23.0',
    }
    const originalFetch = globalThis.fetch
    let request: { url: string; init?: RequestInit } | undefined
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init }
      return new Response('{}', { status: 200 })
    }
    try {
      await criarWhatsApp(config).sendMessage('5511888887777', 'Alerta de chuva')
      assert.equal(request?.url, 'https://graph.facebook.com/v23.0/12345/messages')
      assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer test-token')
      const body = JSON.parse(String(request?.init?.body))
      assert.equal(body.template.name, 'tempoalerta_alerta')
      assert.equal(body.template.components[0].parameters[0].text, 'Alerta de chuva')

      globalThis.fetch = async () => new Response('provider error', { status: 400 })
      await assert.rejects(
        criarWhatsApp(config).sendMessage('5511888887777', 'Alerta de chuva'),
        /WhatsApp Cloud API respondeu 400/,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('valida assinatura HMAC do corpo original do webhook', () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}')
    const appSecret = 'test-secret'
    const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`
    assert.equal(verificarAssinaturaWhatsApp(body, signature, appSecret), true)
    assert.equal(verificarAssinaturaWhatsApp(body, signature, 'wrong-secret'), false)
    assert.equal(verificarAssinaturaWhatsApp(body, undefined, appSecret), false)
  })

  it('vincula por código único e expira, e permite opt-out por mensagem', async () => {
    const db = openTestDb()
    const user = await db.query<{ id: number }>(
      `INSERT INTO usuarios (nome,email,senha_hash,perfil) VALUES (?,?,?,?) RETURNING id`,
      ['Ana', 'ana@example.test', 'hash', 'produtor_rural'],
    )
    const userId = user.rows[0].id
    const link = await criarLinkWhatsApp(db, userId, '5511999999999')
    assert.match(link.url, /^https:\/\/wa\.me\/5511999999999\?text=/)

    const notifications: string[] = []
    const notifier: WhatsAppNotifier = {
      async sendMessage() {},
      async sendText(to, text) { notifications.push(`${to}:${text}`) },
    }
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.test',
              from: '5511888887777',
              type: 'text',
              text: { body: link.texto },
            }],
          },
        }],
      }],
    }
    await processarWebhookWhatsApp(db, notifier, payload)
    let rows = await db.query<{ whatsapp_phone: string | null }>(
      'SELECT whatsapp_phone FROM usuarios WHERE id = ?',
      [userId],
    )
    assert.equal(rows.rows[0].whatsapp_phone, '5511888887777')
    assert.equal(notifications.length, 1)

    await processarWebhookWhatsApp(db, notifier, payload)
    assert.equal(notifications.length, 1)
    await processarWebhookWhatsApp(db, notifier, {
      entry: [{
        changes: [{
          value: {
            messages: [{ from: '5511888887777', type: 'text', text: { body: 'STOP' } }],
          },
        }],
      }],
    })
    rows = await db.query<{ whatsapp_phone: string | null }>(
      'SELECT whatsapp_phone FROM usuarios WHERE id = ?',
      [userId],
    )
    assert.equal(rows.rows[0].whatsapp_phone, null)
    assert.match(notifications[1], /desconectado/)

    const expired = await criarLinkWhatsApp(db, userId, '5511999999999')
    await db.query('UPDATE whatsapp_vinculos SET expira_em = ? WHERE usuario_id = ?', [Date.now() - 1, userId])
    await processarWebhookWhatsApp(db, notifier, {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '5511888887777',
              type: 'text',
              text: { body: expired.texto },
            }],
          },
        }],
      }],
    })
    rows = await db.query<{ whatsapp_phone: string | null }>(
      'SELECT whatsapp_phone FROM usuarios WHERE id = ?',
      [userId],
    )
    assert.equal(rows.rows[0].whatsapp_phone, null)
    await db.close()
  })
})
