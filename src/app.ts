import cors from 'cors'
import express from 'express'
import { env } from './env.js'
import { erros } from './middleware/erros.js'
import { alertasRoutes } from './routes/alertas.js'
import { authRoutes } from './routes/auth.js'
import { cidadesRoutes } from './routes/cidades.js'
import { preferenciasRoutes } from './routes/preferencias.js'
import { previsaoRoutes } from './routes/previsao.js'
import { telegramRoutes } from './routes/telegram.js'
import { whatsappRoutes, whatsappWebhookRoutes } from './routes/whatsapp.js'
import type { Deps } from './services/envio.js'

export function createApp(deps: Deps) {
  const app = express()
  app.use(cors({ origin: env.corsOrigin }))
  app.use('/api/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use(express.json({ limit: '50kb' }))

  app.get('/api/saude', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes(deps))
  app.use('/api/cidades', cidadesRoutes(deps))
  app.use('/api/preferencias', preferenciasRoutes(deps))
  app.use('/api/previsao', previsaoRoutes(deps))
  app.use('/api/alertas', alertasRoutes(deps))
  app.use('/api/telegram', telegramRoutes(deps.db))
  app.use('/api/whatsapp/webhook', whatsappWebhookRoutes(deps.db, deps.whatsapp, env.whatsapp))
  app.use('/api/whatsapp', whatsappRoutes(deps.db, env.whatsapp))

  app.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }))
  app.use(erros)
  return app
}
