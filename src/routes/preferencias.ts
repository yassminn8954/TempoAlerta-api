import { Router } from 'express'
import { z } from 'zod'
import type { CidadeRow, PreferenciaRow } from '../db.js'
import { auth } from '../middleware/auth.js'
import { cidadeDoUsuario, horariosDaPreferencia, paraCidade, paraPreferencia } from '../services/consultas.js'
import type { Deps } from '../services/envio.js'
import { env } from '../env.js'

const schema = z
  .object({
    horario_envio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM'),
    horario_envio_manha: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM'),
    horario_envio_tarde: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM'),
    receber_previsao_diaria: z.boolean(),
    receber_previsao_manha: z.boolean(),
    receber_previsao_tarde: z.boolean(),
    horarios_previsao: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM'))
      .max(4, 'Você pode escolher até 4 horários')
      .refine((horarios) => new Set(horarios).size === horarios.length, 'Não repita horários'),
    alerta_chuva_forte: z.boolean(),
    alerta_geada: z.boolean(),
    limiar_chuva_mm: z.number().min(1).max(200),
    limiar_geada_c: z.number().min(-10).max(10),
  })
  .partial()

export function preferenciasRoutes({ db }: Deps) {
  const r = Router()
  r.use(auth)

  r.get('/email', async (req, res) => {
    const { rows } = await db.query<{ email: string; email_destino: string | null }>(
      'SELECT email, email_destino FROM usuarios WHERE id = ?',
      [req.userId],
    )
    res.json({
      destinatario: rows[0].email_destino ?? rows[0].email,
      ativo: env.mailMode !== 'off',
    })
  })

  r.put('/email', async (req, res) => {
    const { email } = z.object({
      email: z.string().trim().toLowerCase().email().max(200),
    }).parse(req.body)
    await db.query('UPDATE usuarios SET email_destino = ? WHERE id = ?', [email, req.userId])
    res.json({ destinatario: email, ativo: env.mailMode !== 'off' })
  })

  r.get('/', async (req, res) => {
    const { rows } = await db.query<CidadeRow & PreferenciaRow & { preferencia_id: number }>(
        `SELECT c.*, p.id AS preferencia_id, p.horario_envio, p.horario_envio_manha, p.horario_envio_tarde,
                p.receber_previsao_diaria, p.receber_previsao_manha, p.receber_previsao_tarde,
                p.alerta_chuva_forte, p.alerta_geada, p.limiar_chuva_mm, p.limiar_geada_c, p.principal
         FROM preferencias p JOIN cidades c ON c.id = p.cidade_id WHERE p.usuario_id = ?
         ORDER BY p.principal DESC, c.nome`,
        [req.userId],
      )
    res.json(await Promise.all(rows.map(async (x) => ({
      cidade: paraCidade(x),
      ...paraPreferencia(x, await horariosDaPreferencia(db, x.preferencia_id)),
    }))))
  })

  r.get('/:cidadeId', async (req, res) => {
    const { cidade, pref } = await cidadeDoUsuario(db, req.userId!, z.coerce.number().int().parse(req.params.cidadeId))
    res.json({ cidade: paraCidade(cidade), ...paraPreferencia(pref, await horariosDaPreferencia(db, pref.id)) })
  })

  r.put('/:cidadeId', async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    const recebido = schema.parse(req.body)
    const { pref } = await cidadeDoUsuario(db, req.userId!, id)
    const horariosAtuais = await horariosDaPreferencia(db, pref.id)
    let horarios = recebido.horarios_previsao

    if (horarios === undefined) {
      horarios = [...horariosAtuais]
      if (recebido.receber_previsao_diaria === false) horarios = []
      else if (recebido.receber_previsao_diaria === true && !horarios.length) {
        horarios = [
          recebido.horario_envio_manha ?? recebido.horario_envio ?? pref.horario_envio_manha,
          recebido.horario_envio_tarde ?? pref.horario_envio_tarde,
        ]
      }
      if (recebido.horario_envio !== undefined || recebido.horario_envio_manha !== undefined) {
        const primeiro = recebido.horario_envio_manha ?? recebido.horario_envio!
        if (horarios.length) horarios[0] = primeiro
        else if (recebido.receber_previsao_diaria !== false) horarios.push(primeiro)
      }
      if (recebido.horario_envio_tarde !== undefined) {
        if (horarios.length > 1) horarios[1] = recebido.horario_envio_tarde
        else if (horarios.length === 1) horarios.push(recebido.horario_envio_tarde)
      }
      if (recebido.receber_previsao_manha === false) horarios.shift()
      if (recebido.receber_previsao_tarde === false && horarios.length > 1) horarios.splice(1, 1)
      if (recebido.receber_previsao_manha === true && !horarios.length) {
        horarios.push(recebido.horario_envio_manha ?? pref.horario_envio_manha)
      }
      if (recebido.receber_previsao_tarde === true && horarios.length < 2) {
        horarios.push(recebido.horario_envio_tarde ?? pref.horario_envio_tarde)
      }
    }

    horarios = [...new Set(horarios)].sort()
    const atualizaManha = recebido.receber_previsao_manha ?? (horarios.length > 0)
    const atualizaTarde = recebido.receber_previsao_tarde ?? (horarios.length > 1)
    const horarioManha = horarios[0] ?? recebido.horario_envio_manha ?? pref.horario_envio_manha
    const horarioTarde = horarios[1] ?? recebido.horario_envio_tarde ?? pref.horario_envio_tarde
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE preferencias SET horario_envio=?, horario_envio_manha=?, horario_envio_tarde=?,
           receber_previsao_diaria=?, receber_previsao_manha=?, receber_previsao_tarde=?,
           alerta_chuva_forte=?, alerta_geada=?, limiar_chuva_mm=?, limiar_geada_c=?
         WHERE id=?`,
        [
          recebido.horario_envio ?? horarioManha,
          horarioManha,
          horarioTarde,
          horarios.length > 0,
          atualizaManha,
          atualizaTarde,
          recebido.alerta_chuva_forte ?? pref.alerta_chuva_forte,
          recebido.alerta_geada ?? pref.alerta_geada,
          recebido.limiar_chuva_mm ?? pref.limiar_chuva_mm,
          recebido.limiar_geada_c ?? pref.limiar_geada_c,
          pref.id,
        ],
      )
      await tx.query('DELETE FROM preferencia_horarios WHERE preferencia_id=?', [pref.id])
      for (const horario of horarios) {
        await tx.query('INSERT INTO preferencia_horarios (preferencia_id, horario) VALUES (?,?)', [pref.id, horario])
      }
    })
    const { cidade, pref: nova } = await cidadeDoUsuario(db, req.userId!, id)
    res.json({ cidade: paraCidade(cidade), ...paraPreferencia(nova, horarios) })
  })

  return r
}
