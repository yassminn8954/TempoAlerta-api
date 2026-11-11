import 'dotenv/config'

const num = (v: string | undefined, d: number) => (v ? Number(v) : d)

export const env = {
  port: num(process.env.PORT, 3333),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-troque-isto',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:8443,http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  databaseUrl: process.env.DATABASE_URL ?? '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME ?? 'TempoAlertaBot').replace(/^@/, ''),
  tz: process.env.TZ_APP ?? 'America/Sao_Paulo',
  schedulerOn: process.env.SCHEDULER?.trim().toLowerCase() !== 'off',
}
