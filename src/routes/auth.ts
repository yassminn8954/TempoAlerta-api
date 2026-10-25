import bcrypt from 'bcryptjs'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import type { UsuarioRow } from '../db.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { auth } from '../middleware/auth.js'
import type { Deps } from '../services/envio.js'

const publico = (u: UsuarioRow) => ({
  id: u.id,
  nome: u.nome,
  email: u.email,
  perfil: u.perfil,
  criado_em: u.criado_em,
})
const token = (u: UsuarioRow) => jwt.sign({}, env.jwtSecret, { subject: String(u.id), expiresIn: '7d' })

const cadastroSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  senha: z.string().min(8, 'Mínimo de 8 caracteres').max(100),
  perfil: z.enum(['produtor_rural', 'organizador_eventos']).default('produtor_rural'),
})
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  senha: z.string().min(1),
})

const HASH_FALSO = bcrypt.hashSync('nao-existe', 10)

export function authRoutes({ db }: Deps) {
  const r = Router()

  r.post('/cadastro', async (req, res) => {
    const b = cadastroSchema.parse(req.body)
    const existe = db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(b.email)
    if (existe) throw new HttpError(409, 'Já existe uma conta com este e-mail')
    const hash = await bcrypt.hash(b.senha, 10)
    const info = db
      .prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?,?,?,?)')
      .run(b.nome, b.email, hash, b.perfil)
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid) as UsuarioRow
    res.status(201).json({ token: token(u), usuario: publico(u) })
  })

  r.post('/login', async (req, res) => {
    const b = loginSchema.parse(req.body)
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(b.email) as UsuarioRow | undefined
    const ok = await bcrypt.compare(b.senha, u?.senha_hash ?? HASH_FALSO)
    if (!u || !ok) throw new HttpError(401, 'E-mail ou senha inválidos')
    res.json({ token: token(u), usuario: publico(u) })
  })

  r.get('/me', auth, (req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.userId) as UsuarioRow | undefined
    if (!u) throw new HttpError(401, 'Usuário não existe mais')
    res.json(publico(u))
  })

  r.patch('/me', auth, (req, res) => {
    const b = z.object({ perfil: z.enum(['produtor_rural', 'organizador_eventos']) }).parse(req.body)
    db.prepare('UPDATE usuarios SET perfil = ? WHERE id = ?').run(b.perfil, req.userId)
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.userId) as UsuarioRow
    res.json(publico(u))
  })

  return r
}
