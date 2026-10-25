import nodemailer from 'nodemailer'
import { env } from '../env.js'

export interface Mailer {
  enviar(para: string, assunto: string, texto: string, html: string): Promise<void>
}

export function criarMailer(): Mailer {
  if (env.mailMode === 'smtp') {
    const t = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
    return {
      async enviar(para, assunto, texto, html) {
        await t.sendMail({ from: env.smtp.from, to: para, subject: assunto, text: texto, html })
      },
    }
  }
  // modo log: não envia nada, só imprime (bom para desenvolver/demonstrar)
  return {
    async enviar(para, assunto, texto) {
      console.log(`\n[email simulado] para=${para}\nassunto: ${assunto}\n${texto}\n`)
    },
  }
}
