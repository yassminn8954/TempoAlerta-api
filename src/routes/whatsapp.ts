import { Router } from 'express'
import { auth } from '../middleware/auth.js'
import type { DB } from '../db.js'
import {
  criarLinkWhatsApp,
  processarWebhookWhatsApp,
  verificarAssinaturaWhatsApp,
  whatsappConfigurado,
  type WhatsAppConfig,
  type WhatsAppNotifier,
} from '../services/whatsapp.js'

export function whatsappWebhookRoutes(db: DB, notifier: WhatsAppNotifier | undefined, config: WhatsAppConfig) {
  const router = Router()

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (!config.verifyToken) {
      res.status(503).send('Webhook do WhatsApp não configurado')
      return
    }
    if (mode === 'subscribe' && token === config.verifyToken && typeof challenge === 'string') {
      res.status(200).type('text/plain').send(challenge)
      return
    }
    res.status(403).send('Verificação inválida')
  })

  router.post('/', async (req, res) => {
    if (!config.appSecret) {
      res.status(503).json({ erro: 'Assinatura do webhook não configurada' })
      return
    }
    if (!Buffer.isBuffer(req.body) || !verificarAssinaturaWhatsApp(
      req.body,
      req.header('x-hub-signature-256'),
      config.appSecret,
    )) {
      res.status(401).json({ erro: 'Assinatura do webhook inválida' })
      return
    }
    let payload: Parameters<typeof processarWebhookWhatsApp>[2]
    try {
      payload = JSON.parse(req.body.toString('utf8'))
    } catch {
      res.status(400).json({ erro: 'JSON inválido' })
      return
    }
    await processarWebhookWhatsApp(db, notifier, payload)
    res.status(200).json({ ok: true })
  })

  return router
}

export function whatsappRoutes(db: DB, config: WhatsAppConfig) {
  const router = Router()
  router.use(auth)

  router.get('/status', async (req, res) => {
    const { rows } = await db.query<{ whatsapp_phone: string | null }>(
      'SELECT whatsapp_phone FROM usuarios WHERE id = ?',
      [req.userId],
    )
    const phone = rows[0]?.whatsapp_phone ?? null
    res.json({
      vinculado: Boolean(phone),
      telefone_final: phone ? phone.slice(-4) : null,
      configurado: whatsappConfigurado(config) && Boolean(config.businessNumber),
      webhook_configurado: Boolean(config.appSecret && config.verifyToken),
      template_configurado: Boolean(config.templateName),
    })
  })

  router.post('/vinculo', async (req, res) => {
    if (!whatsappConfigurado(config) || !config.businessNumber) {
      res.status(503).json({ erro: 'Integração WhatsApp não configurada no servidor' })
      return
    }
    const link = await criarLinkWhatsApp(db, req.userId!, config.businessNumber)
    res.status(201).json(link)
  })

  router.delete('/vinculo', async (req, res) => {
    await db.transaction(async (tx) => {
      await tx.query('UPDATE usuarios SET whatsapp_phone = NULL WHERE id = ?', [req.userId])
      await tx.query('DELETE FROM whatsapp_vinculos WHERE usuario_id = ?', [req.userId])
    })
    res.status(204).end()
  })

  return router
}
