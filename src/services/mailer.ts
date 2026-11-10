import nodemailer from 'nodemailer'
import { env } from '../env.js'

export interface Mailer {
  enviar(para: string, assunto: string, texto: string, html: string): Promise<void>
}

export function criarMailer(): Mailer | undefined {
  if (env.mailMode === 'off') return undefined

  if (env.mailMode === 'resend') {
    if (!env.resendApiKey) {
      throw new Error('MAIL_MODE=resend exige RESEND_API_KEY')
    }
    return {
      async enviar(para, assunto, texto, html) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: env.smtp.from, to: para, subject: assunto, text: texto, html }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) {
          const detalhes = await response.text()
          throw new Error(`Resend respondeu HTTP ${response.status}${detalhes ? `: ${detalhes}` : ''}`)
        }
      },
    }
  }

  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
    throw new Error('MAIL_MODE=smtp exige SMTP_HOST, SMTP_USER e SMTP_PASS')
  }

  const t = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
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
