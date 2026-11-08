import 'dotenv/config'

const num = (v: string | undefined, d: number) => (v ? Number(v) : d)
const mailMode = process.env.MAIL_MODE ?? 'off'

if (mailMode !== 'off' && mailMode !== 'smtp') {
  throw new Error('MAIL_MODE deve ser "off" ou "smtp"; o modo de e-mail simulado foi removido')
}

export const env = {
  port: num(process.env.PORT, 3333),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-troque-isto',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:8443,http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  databaseUrl: process.env.DATABASE_URL ?? '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME ?? 'TempoAlertaBot').replace(/^@/, ''),
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    businessNumber: (process.env.WHATSAPP_BUSINESS_NUMBER ?? '').replace(/\D/g, ''),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? '',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'pt_BR',
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v23.0',
  },
  tz: process.env.TZ_APP ?? 'America/Sao_Paulo',
  schedulerOn: process.env.SCHEDULER?.trim().toLowerCase() !== 'off',
  mailMode: mailMode as 'off' | 'smtp',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'TempoAlerta <no-reply@tempoalerta.app>',
  },
}
