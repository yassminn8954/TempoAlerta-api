import type { CidadeRow, DB, PreferenciaRow } from '../db.js'
import { HttpError } from '../errors.js'

export async function cidadeDoUsuario(db: DB, usuarioId: number, cidadeId: number) {
  const { rows: cidades } = await db.query<CidadeRow>('SELECT * FROM cidades WHERE id = ?', [cidadeId])
  const { rows: preferencias } = await db.query<PreferenciaRow>(
    'SELECT * FROM preferencias WHERE usuario_id = ? AND cidade_id = ?',
    [usuarioId, cidadeId],
  )
  const c = cidades[0]
  const p = preferencias[0]
  if (!c || !p) throw new HttpError(404, 'Cidade não encontrada para este usuário')
  return { cidade: c, pref: p }
}

export async function horariosDaPreferencia(db: DB, preferenciaId: number) {
  const { rows } = await db.query<{ horario: string }>(
    'SELECT horario FROM preferencia_horarios WHERE preferencia_id = ? ORDER BY horario',
    [preferenciaId],
  )
  return rows.map((row) => row.horario)
}

export const paraPreferencia = (p: PreferenciaRow, horarios_previsao: string[] = []) => ({
  horario_envio: p.horario_envio_manha ?? p.horario_envio,
  horario_envio_manha: p.horario_envio_manha ?? p.horario_envio,
  horario_envio_tarde: p.horario_envio_tarde ?? '16:00',
  horarios_previsao,
  receber_previsao_diaria: !!p.receber_previsao_diaria,
  receber_previsao_manha: !!(p.receber_previsao_manha ?? p.receber_previsao_diaria),
  receber_previsao_tarde: !!p.receber_previsao_tarde,
  alerta_chuva_forte: !!p.alerta_chuva_forte,
  alerta_geada: !!p.alerta_geada,
  limiar_chuva_mm: p.limiar_chuva_mm,
  limiar_geada_c: p.limiar_geada_c,
  principal: !!p.principal,
})

export const paraCidade = (c: CidadeRow) => ({
  id: c.id,
  nome: c.nome,
  estado: c.estado,
  pais: c.pais,
  latitude: c.latitude,
  longitude: c.longitude,
})
