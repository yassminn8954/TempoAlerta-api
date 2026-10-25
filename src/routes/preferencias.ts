import { Router } from 'express'
import { z } from 'zod'
import type { CidadeRow, PreferenciaRow } from '../db.js'
import { auth } from '../middleware/auth.js'
import { cidadeDoUsuario, paraCidade, paraPreferencia } from '../services/consultas.js'
import type { Deps } from '../services/envio.js'

const schema = z
  .object({
    horario_envio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM'),
    receber_previsao_diaria: z.boolean(),
    alerta_chuva_forte: z.boolean(),
    alerta_geada: z.boolean(),
    limiar_chuva_mm: z.number().min(1).max(200),
    limiar_geada_c: z.number().min(-10).max(10),
  })
  .partial()

export function preferenciasRoutes({ db }: Deps) {
  const r = Router()
  r.use(auth)

  r.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, p.horario_envio, p.receber_previsao_diaria, p.alerta_chuva_forte, p.alerta_geada,
                p.limiar_chuva_mm, p.limiar_geada_c, p.principal
         FROM preferencias p JOIN cidades c ON c.id = p.cidade_id WHERE p.usuario_id = ?
         ORDER BY p.principal DESC, c.nome`,
      )
      .all(req.userId) as (CidadeRow & PreferenciaRow)[]
    res.json(rows.map((x) => ({ cidade: paraCidade(x), ...paraPreferencia(x) })))
  })

  r.get('/:cidadeId', (req, res) => {
    const { cidade, pref } = cidadeDoUsuario(db, req.userId!, z.coerce.number().int().parse(req.params.cidadeId))
    res.json({ cidade: paraCidade(cidade), ...paraPreferencia(pref) })
  })

  r.put('/:cidadeId', (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    const b = schema.parse(req.body)
    const { pref } = cidadeDoUsuario(db, req.userId!, id)

    const campos = Object.entries(b).filter(([, v]) => v !== undefined)
    if (campos.length) {
      // nomes de coluna vêm das chaves do schema zod (whitelist), nunca do usuário
      const set = campos.map(([k]) => `${k} = ?`).join(', ')
      const vals = campos.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v))
      db.prepare(`UPDATE preferencias SET ${set} WHERE id = ?`).run(...vals, pref.id)
    }
    const { cidade, pref: nova } = cidadeDoUsuario(db, req.userId!, id)
    res.json({ cidade: paraCidade(cidade), ...paraPreferencia(nova) })
  })

  return r
}
