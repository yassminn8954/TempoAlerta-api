import { Router } from 'express'
import { z } from 'zod'
import type { CidadeRow, PreferenciaRow } from '../db.js'
import { HttpError } from '../errors.js'
import { auth } from '../middleware/auth.js'
import { cidadeDoUsuario, paraCidade, paraPreferencia } from '../services/consultas.js'
import type { Deps } from '../services/envio.js'

const horario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM')

const novaCidade = z.object({
  nome: z.string().trim().min(1).max(120),
  estado: z.string().trim().max(60).nullish(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  horario_envio: horario.optional(),
})

export function cidadesRoutes({ db, weather }: Deps) {
  const r = Router()
  r.use(auth)

  // Busca (geocodificação Open-Meteo) para o autocomplete do onboarding
  r.get('/busca', async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query)
    res.json(await weather.buscarCidades(q))
  })

  r.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, p.horario_envio, p.receber_previsao_diaria, p.alerta_chuva_forte, p.alerta_geada,
                p.limiar_chuva_mm, p.limiar_geada_c, p.principal
         FROM preferencias p JOIN cidades c ON c.id = p.cidade_id
         WHERE p.usuario_id = ? ORDER BY p.principal DESC, c.nome`,
      )
      .all(req.userId) as (CidadeRow & PreferenciaRow)[]
    res.json(
      rows.map((x) => ({
        ...paraCidade(x),
        preferencia: paraPreferencia(x),
        principal: !!x.principal,
      })),
    )
  })

  r.post('/', (req, res) => {
    const b = novaCidade.parse(req.body)
    const lat = Math.round(b.latitude * 1e4) / 1e4
    const lon = Math.round(b.longitude * 1e4) / 1e4

    const criar = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO cidades (nome, estado, latitude, longitude) VALUES (?,?,?,?)').run(
        b.nome,
        b.estado ?? null,
        lat,
        lon,
      )
      const c = db
        .prepare('SELECT * FROM cidades WHERE latitude = ? AND longitude = ?')
        .get(lat, lon) as CidadeRow
      const ja = db
        .prepare('SELECT 1 FROM preferencias WHERE usuario_id = ? AND cidade_id = ?')
        .get(req.userId, c.id)
      if (ja) throw new HttpError(409, 'Você já acompanha esta cidade')
      const temPrincipal = db
        .prepare('SELECT 1 FROM preferencias WHERE usuario_id = ? AND principal = 1')
        .get(req.userId)
      db.prepare(
        'INSERT INTO preferencias (usuario_id, cidade_id, horario_envio, principal) VALUES (?,?,?,?)',
      ).run(req.userId, c.id, b.horario_envio ?? '06:00', temPrincipal ? 0 : 1)
      return c.id
    })

    const cidadeId = criar()
    const { cidade, pref } = cidadeDoUsuario(db, req.userId!, cidadeId)
    res.status(201).json({ ...paraCidade(cidade), preferencia: paraPreferencia(pref), principal: !!pref.principal })
  })

  r.patch('/:cidadeId/principal', (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    cidadeDoUsuario(db, req.userId!, id)
    db.transaction(() => {
      db.prepare('UPDATE preferencias SET principal = 0 WHERE usuario_id = ?').run(req.userId)
      db.prepare('UPDATE preferencias SET principal = 1 WHERE usuario_id = ? AND cidade_id = ?').run(
        req.userId,
        id,
      )
    })()
    res.json({ ok: true })
  })

  r.delete('/:cidadeId', (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    const { pref } = cidadeDoUsuario(db, req.userId!, id)
    db.transaction(() => {
      db.prepare('DELETE FROM preferencias WHERE id = ?').run(pref.id)
      if (pref.principal) {
        db.prepare(
          `UPDATE preferencias SET principal = 1
           WHERE id = (SELECT id FROM preferencias WHERE usuario_id = ? ORDER BY id LIMIT 1)`,
        ).run(req.userId)
      }
    })()
    res.status(204).end()
  })

  return r
}
