import nodemailer from 'nodemailer'
import { env } from '../env.js'

export interface Mailer {
  enviar(para: string, assunto: string, texto: string, html: string): Promise<void>
}

export function criarMailer(): Mailer | undefined {
  if (env.mailMode === 'off') return undefined

  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
    throw new Error('MAIL_MODE=smtp exige SMTP_HOST, SMTP_USER e SMTP_PASS')
  }

  if (env.mailMode === 'smtp') {
    const t = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
    return {
      async enviar(para, assunto, texto, html) {
        await t.sendMail({ from: env.smtp.from, to: para, subject: assunto, text: texto, html })
      },
    }
  }
  return undefined
}
