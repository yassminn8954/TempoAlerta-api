import type { CidadeRow, DB, PreferenciaRow } from '../db.js'
import { HttpError } from '../errors.js'

export function cidadeDoUsuario(db: DB, usuarioId: number, cidadeId: number) {
  const c = db.prepare('SELECT * FROM cidades WHERE id = ?').get(cidadeId) as CidadeRow | undefined
  const p = db
    .prepare('SELECT * FROM preferencias WHERE usuario_id = ? AND cidade_id = ?')
    .get(usuarioId, cidadeId) as PreferenciaRow | undefined
  if (!c || !p) throw new HttpError(404, 'Cidade não encontrada para este usuário')
  return { cidade: c, pref: p }
}

export const paraPreferencia = (p: PreferenciaRow) => ({
  horario_envio: p.horario_envio,
  receber_previsao_diaria: !!p.receber_previsao_diaria,
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
