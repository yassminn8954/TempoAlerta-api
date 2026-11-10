import { Router } from 'express'
import { env } from '../env.js'
import { auth } from '../middleware/auth.js'
import type { DB } from '../db.js'
import { criarLinkTelegram } from '../services/telegram.js'

export function telegramRoutes(db: DB) {
  const router = Router()
  router.use(auth)

  router.get('/status', async (req, res) => {
    const { rows } = await db.query<{ telegram_chat_id: string | null }>(
      'SELECT telegram_chat_id FROM usuarios WHERE id = ?',
      [req.userId],
    )
    res.json({
      vinculado: Boolean(rows[0]?.telegram_chat_id),
      bot_username: env.telegramBotUsername,
      bot_configurado: Boolean(env.telegramBotToken),
      email_ativo: env.mailMode !== 'off',
    })
  })

  router.post('/vinculo', async (req, res) => {
    if (!env.telegramBotToken) {
      res.status(503).json({ erro: 'Integração com Telegram não configurada no servidor' })
      return
    }
    const link = await criarLinkTelegram(db, req.userId!, env.telegramBotUsername)
    res.status(201).json(link)
  })

  router.delete('/vinculo', async (req, res) => {
    await db.transaction(async (tx) => {
      await tx.query('UPDATE usuarios SET telegram_chat_id = NULL WHERE id = ?', [req.userId])
      await tx.query('DELETE FROM telegram_vinculos WHERE usuario_id = ?', [req.userId])
    })
    res.status(204).end()
  })

  return router
}
