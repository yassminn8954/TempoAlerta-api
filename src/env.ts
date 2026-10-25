import 'dotenv/config'

const num = (v: string | undefined, d: number) => (v ? Number(v) : d)

export const env = {
  port: num(process.env.PORT, 3333),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-troque-isto',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:8443,http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  dbPath: process.env.DB_PATH ?? './data/tempoalerta.db',
  tz: process.env.TZ_APP ?? 'America/Sao_Paulo',
  schedulerOn: process.env.SCHEDULER !== 'off',
  mailMode: (process.env.MAIL_MODE ?? 'log') as 'log' | 'smtp',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'TempoAlerta <no-reply@tempoalerta.app>',
  },
}
