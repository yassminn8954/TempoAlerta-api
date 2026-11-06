import { Router } from 'express'
import { z } from 'zod'
import type { Tipo, UsuarioRow } from '../db.js'
import { HttpError } from '../errors.js'
import { auth } from '../middleware/auth.js'
import { cidadeDoUsuario } from '../services/consultas.js'
import { enviarERegistrar, type Deps } from '../services/envio.js'
import { mensagemChuva, mensagemDiaria, mensagemGeada } from '../services/mensagens.js'
import { menorTemperatura, picoDeChuva } from '../services/regras.js'

const TIPOS = ['previsao_diaria', 'chuva_forte', 'geada'] as const

const listaSchema = z.object({
  cidadeId: z.coerce.number().int().optional(),
  tipo: z.enum(TIPOS).optional(),
  periodo: z.coerce.number().int().min(1).max(365).optional(), // últimos N dias
  busca: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
})

const SELECT = `SELECT a.id, a.tipo, a.status, a.mensagem, a.enviado_em, a.erro, a.dados_json,
                       c.id AS cidade_id, c.nome AS cidade_nome, c.estado AS cidade_estado
                FROM alertas_enviados a JOIN cidades c ON c.id = a.cidade_id`

function formatar(a: any) {
  return {
    id: a.id,
    tipo: a.tipo as Tipo,
    status: a.status,
    mensagem: a.mensagem,
    enviado_em: a.enviado_em,
    erro: a.erro,
    cidade: { id: a.cidade_id, nome: a.cidade_nome, estado: a.cidade_estado },
  }
}

export function alertasRoutes(deps: Deps) {
  const { db, weather } = deps
  const r = Router()
  r.use(auth)

  r.get('/', async (req, res) => {
    const q = listaSchema.parse(req.query)
    const where = ['a.usuario_id = ?']
    const args: (string | number)[] = [req.userId!]
    if (q.cidadeId) (where.push('a.cidade_id = ?'), args.push(q.cidadeId))
    if (q.tipo) (where.push('a.tipo = ?'), args.push(q.tipo))
    if (q.periodo) {
      where.push('a.enviado_em >= ?')
      args.push(new Date(Date.now() - q.periodo * 86400_000).toISOString())
    }
    if (q.busca) {
      where.push("a.mensagem LIKE ? ESCAPE '\\'")
      args.push(`%${q.busca.replace(/[\\%_]/g, '\\$&')}%`)
    }
    const w = where.join(' AND ')
    const { rows: totais } = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM alertas_enviados a WHERE ${w}`,
      args,
    )
    const { rows } = await db.query(
      `${SELECT} WHERE ${w} ORDER BY a.enviado_em DESC LIMIT ? OFFSET ?`,
      [...args, q.limite, (q.pagina - 1) * q.limite],
    )
    res.json({ itens: rows.map(formatar), total: Number(totais[0].n), pagina: q.pagina, limite: q.limite })
  })

  r.get('/:id', async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id)
    const { rows: alertas } = await db.query(
      `${SELECT} WHERE a.id = ? AND a.usuario_id = ?`,
      [id, req.userId],
    )
    const a = alertas[0] as any
    if (!a) throw new HttpError(404, 'Alerta não encontrado')
    const { rows: usuarios } = await db.query<Pick<UsuarioRow, 'email'>>(
      'SELECT email FROM usuarios WHERE id = ?',
      [req.userId],
    )
    const dados = typeof a.dados_json === 'string' ? JSON.parse(a.dados_json) : a.dados_json
    res.json({ ...formatar(a), dados: dados ?? null, destinatario: usuarios[0].email })
  })

  // Dispara um envio na hora (útil para demonstrar o sistema sem esperar o horário)
  r.post('/teste', async (req, res) => {
    const b = z.object({ cidadeId: z.number().int(), tipo: z.enum(TIPOS) }).parse(req.body)
    const { cidade, pref } = await cidadeDoUsuario(db, req.userId!, b.cidadeId)
    const { rows: usuarios } = await db.query<UsuarioRow>('SELECT * FROM usuarios WHERE id = ?', [req.userId])
    const u = usuarios[0]
    const prev = await weather.previsao(cidade.latitude, cidade.longitude)

    let msg
    if (b.tipo === 'previsao_diaria') msg = mensagemDiaria(u, cidade, prev)
    else if (b.tipo === 'chuva_forte') msg = mensagemChuva(u, cidade, picoDeChuva(prev)!, pref.limiar_chuva_mm)
    else msg = mensagemGeada(u, cidade, menorTemperatura(prev)!, pref.limiar_geada_c)
    msg = { ...msg, assunto: `[TESTE] ${msg.assunto}`, texto: `[TESTE] ${msg.texto}` }

    const r2 = await enviarERegistrar(deps, u, cidade, b.tipo, msg, new Date())
    res.status(201).json(r2)
  })

  return r
}
