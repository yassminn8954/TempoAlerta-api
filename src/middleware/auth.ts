import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../env.js'
import { HttpError } from '../errors.js'

export function auth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'Token ausente')
  try {
    const p = jwt.verify(h.slice(7), env.jwtSecret) as jwt.JwtPayload
    req.userId = Number(p.sub)
  } catch {
    throw new HttpError(401, 'Token inválido ou expirado')
  }
  next()
}
