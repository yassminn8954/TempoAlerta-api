import { createApp } from './app.js'
import { openDb } from './db.js'
import { env } from './env.js'
import { criarMailer } from './services/mailer.js'
import { MetNorwayClient } from './services/metNorway.js'
import { iniciarScheduler } from './services/scheduler.js'
import { criarTelegram, iniciarPollingTelegram } from './services/telegram.js'
import { criarWhatsApp, whatsappConfigurado } from './services/whatsapp.js'

if (process.env.NODE_ENV === 'production' && env.jwtSecret.startsWith('dev-secret')) {
  throw new Error('Defina JWT_SECRET no .env antes de rodar em produção')
}

const db = await openDb(env.databaseUrl)
const telegram = env.telegramBotToken ? criarTelegram(env.telegramBotToken) : undefined
const whatsapp = whatsappConfigurado(env.whatsapp) ? criarWhatsApp(env.whatsapp) : undefined
const deps = { db, weather: new MetNorwayClient(db), mailer: criarMailer(), telegram, whatsapp }
const app = createApp(deps)

if (env.schedulerOn) iniciarScheduler(deps)
else console.log('Agendador desligado (SCHEDULER=off)')
if (env.telegramBotToken) void iniciarPollingTelegram(db, env.telegramBotToken)

app.listen(env.port, () =>
  console.log(
    `TempoAlerta API em http://localhost:${env.port}/api (e-mail: ${deps.mailer ? 'smtp' : 'off'}; Telegram: ${telegram ? 'on' : 'off'}; WhatsApp: ${whatsapp ? 'on' : 'off'})`,
  ),
)
