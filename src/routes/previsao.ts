import { Router } from 'express'
import { z } from 'zod'
import { auth } from '../middleware/auth.js'
import { cidadeDoUsuario, paraCidade } from '../services/consultas.js'
import type { Deps } from '../services/envio.js'
import { descricaoClima } from '../services/openMeteo.js'
import { chuvaForte, geada } from '../services/regras.js'

const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const diaSemana = (data: string) => {
  const [y, m, d] = data.split('-').map(Number)
  return SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export function previsaoRoutes({ db, weather }: Deps) {
  const r = Router()
  r.use(auth)

  r.get('/:cidadeId', async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.cidadeId)
    const { cidade, pref } = cidadeDoUsuario(db, req.userId!, id)
    const p = await weather.previsao(cidade.latitude, cidade.longitude)

    const dias = p.dias.map((d, i) => ({
      ...d,
      dia_semana: i === 0 ? 'Hoje' : diaSemana(d.data),
      descricao: descricaoClima(d.codigo),
    }))
    const menor = p.dias.reduce((a, b) => (b.min < a.min ? b : a))

    const alertasAtivos: Record<string, unknown>[] = []
    const chuva = chuvaForte(p, pref.limiar_chuva_mm)
    if (chuva) alertasAtivos.push({ tipo: 'chuva_forte', ...chuva, limiar_chuva_mm: pref.limiar_chuva_mm })
    const gel = geada(p, pref.limiar_geada_c)
    if (gel) alertasAtivos.push({ tipo: 'geada', ...gel, limiar_geada_c: pref.limiar_geada_c })

    res.json({
      cidade: paraCidade(cidade),
      atual: { ...p.atual, descricao: descricaoClima(p.atual.codigo) },
      hoje: dias[0],
      dias,
      status_geral: {
        risco_geada_48h: p.dias.slice(0, 2).some((d) => d.min <= pref.limiar_geada_c),
        menor_minima: { valor: menor.min, data: menor.data, dia_semana: diaSemana(menor.data) },
      },
      alertas_ativos: alertasAtivos, // alimenta o banner do dashboard
      atualizado_em: p.atualizado_em,
      fonte: 'Open-Meteo',
    })
  })

  return r
}
