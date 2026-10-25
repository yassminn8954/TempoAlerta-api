import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../errors.js'
import { WeatherError } from '../services/openMeteo.js'

export function erros(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      erro: 'Dados inválidos',
      detalhes: err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    })
  }
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message })
  if (err instanceof WeatherError) {
    console.error('[weather]', err.message)
    return res.status(502).json({ erro: 'Previsão indisponível no momento. Tente novamente.' })
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' })
  console.error(err)
  res.status(500).json({ erro: 'Erro interno' })
}
