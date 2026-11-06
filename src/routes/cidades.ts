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

  r.get('/', async (req, res) => {
    const { rows } = await db.query<CidadeRow & PreferenciaRow>(
        `SELECT c.*, p.horario_envio, p.receber_previsao_diaria, p.alerta_chuva_forte, p.alerta_geada,
                p.limiar_chuva_mm, p.limiar_geada_c, p.principal
         FROM preferencias p JOIN cidades c ON c.id = p.cidade_id
         WHERE p.usuario_id = ? ORDER BY p.principal DESC, c.nome`,
        [req.userId],
      )
    res.json(
      rows.map((x) => ({
        ...paraCidade(x),
        preferencia: paraPreferencia(x),
        principal: !!x.principal,
      })),
    )
  })

  r.post('/', async (req, res) => {
    const b = novaCidade.parse(req.body)
    const lat = Math.round(b.latitude * 1e4) / 1e4
    const lon = Math.round(b.longitude * 1e4) / 1e4

    const cidadeId = await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO cidades (nome, estado, latitude, longitude) VALUES (?,?,?,?) ON CONFLICT (latitude, longitude) DO NOTHING',
        [b.nome, b.estado ?? null, lat, lon],
      )
      const { rows: cidades } = await tx.query<CidadeRow>(
        'SELECT * FROM cidades WHERE latitude = ? AND longitude = ?',
        [lat, lon],
      )
      const c = cidades[0]
      if (!c) throw new Error('A cidade não foi criada no banco')
      const { rowCount: ja } = await tx.query(
        'SELECT 1 FROM preferencias WHERE usuario_id = ? AND cidade_id = ?',
        [req.userId, c.id],
      )
      if (ja) throw new HttpError(409, 'Você já acompanha esta cidade')
      const { rowCount: temPrincipal } = await tx.query(
        'SELECT 1 FROM preferencias WHERE usuario_id = ? AND principal = TRUE',
        [req.userId],
      )
      await tx.query(
        'INSERT INTO preferencias (usuario_id, cidade_id, horario_envio, principal) VALUES (?,?,?,?)',
        [req.userId, c.id, b.horario_envio ?? '06:00', !temPrincipal],
      )
      return c.id
    })

    const { cidade, pref } = await cidadeDoUsuario(db, req.userId!, cidadeId)
    res.status(201).json({ ...paraCidade(cidade), preferencia: paraPreferencia(pref), principal: !!pref.principal })
  })

  r.patch('/:cidadeId/principal', async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    await cidadeDoUsuario(db, req.userId!, id)
    await db.transaction(async (tx) => {
      await tx.query('UPDATE preferencias SET principal = FALSE WHERE usuario_id = ?', [req.userId])
      await tx.query(
        'UPDATE preferencias SET principal = TRUE WHERE usuario_id = ? AND cidade_id = ?',
        [req.userId, id],
      )
    })
    res.json({ ok: true })
  })

  r.delete('/:cidadeId', async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    const { pref } = await cidadeDoUsuario(db, req.userId!, id)
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM preferencias WHERE id = ?', [pref.id])
      if (pref.principal) {
        await tx.query(
          `UPDATE preferencias SET principal = TRUE
           WHERE id = (SELECT id FROM preferencias WHERE usuario_id = ? ORDER BY id LIMIT 1)`,
          [req.userId],
        )
      }
    })
    res.status(204).end()
  })

  return r
}
