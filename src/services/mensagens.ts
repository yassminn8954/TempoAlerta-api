import type { CidadeRow, UsuarioRow } from '../db.js'
import { descricaoClima, type Previsao } from './weather.js'
import type { EventoChuva, EventoGeada } from './regras.js'

export interface Mensagem {
  assunto: string
  texto: string
  dados: Record<string, unknown>
}

const r0 = (n: number) => Math.round(n)
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0]
const local = (c: CidadeRow) => (c.estado ? `${c.nome}, ${c.estado}` : c.nome)
const hh = (iso: string) => iso.slice(11, 16).replace(':00', 'h').replace(/^0/, '')

export type PeriodoDiario = 'madrugada' | 'manha' | 'tarde' | 'noite'

export function periodoDoHorario(horario: string): PeriodoDiario {
  const hora = Number(horario.slice(0, 2))
  if (hora >= 5 && hora < 12) return 'manha'
  if (hora >= 12 && hora < 18) return 'tarde'
  if (hora >= 18) return 'noite'
  return 'madrugada'
}

export function mensagemDiaria(
  u: UsuarioRow,
  c: CidadeRow,
  p: Previsao,
  periodo: PeriodoDiario = 'manha',
  horarioAgendado?: string,
): Mensagem {
  const hoje = p.dias[0]
  const desc = descricaoClima(hoje.codigo)
  const periodoTexto = {
    madrugada: 'da madrugada',
    manha: 'da manhã',
    tarde: 'da tarde',
    noite: 'da noite',
  }[periodo]
  const saudacao = {
    madrugada: `Olá, ${primeiroNome(u.nome)}! Confira a atualização do tempo para ${local(c)}.`,
    manha: `Bom dia, ${primeiroNome(u.nome)}! Aqui está o panorama de hoje para ${local(c)}.`,
    tarde: `Boa tarde, ${primeiroNome(u.nome)}! Confira como fica o restante do dia em ${local(c)}.`,
    noite: `Boa noite, ${primeiroNome(u.nome)}! Veja as condições para as próximas horas em ${local(c)}.`,
  }[periodo]
  const titulo = {
    madrugada: 'ATUALIZAÇÃO DO TEMPO',
    manha: 'PREVISÃO DO DIA',
    tarde: 'RESTANTE DO DIA',
    noite: 'TEMPO NESTA NOITE',
  }[periodo]
  const descricao = {
    madrugada: `${desc}. Hoje, a máxima será de ${r0(hoje.max)}°C e a mínima de ${r0(hoje.min)}°C.`,
    manha: `${desc}. Máxima de ${r0(hoje.max)}°C e mínima de ${r0(hoje.min)}°C.`,
    tarde: `${desc}. A máxima prevista é ${r0(hoje.max)}°C e a mínima é ${r0(hoje.min)}°C.`,
    noite: `${desc}. Hoje, a máxima foi de ${r0(hoje.max)}°C e a mínima prevista é ${r0(hoje.min)}°C.`,
  }[periodo]
  const linhas = [
    saudacao,
    ...(horarioAgendado ? [`🕒 Atualização programada para ${horarioAgendado}.`] : []),
    `☀️ ${titulo}\n${descricao}`,
    `🌧 Chuva prevista hoje: ${hoje.chuva_mm} mm.\n🌡 Agora: ${r0(p.atual.temperatura)}°C  •  💨 Vento: ${r0(p.atual.vento_kmh)} km/h  •  💧 Umidade: ${r0(p.atual.umidade)}%.`,
  ]
  return {
    assunto: `Previsão ${periodoTexto} em ${local(c)}`,
    texto: linhas.join('\n'),
    dados: { dia: hoje, atual: p.atual, periodo, horario_agendado: horarioAgendado },
  }
}

export function mensagemChuva(u: UsuarioRow, c: CidadeRow, e: EventoChuva, limiar: number): Mensagem {
  const linhas = [
    `Atenção, ${primeiroNome(u.nome)}: chuva forte prevista para ${local(c)}.`,
    `Pico de ${e.pico_mm} mm/h por volta de ${hh(e.hora_pico)}. Acumulado nas próximas 24h: ${e.total_24h_mm} mm.`,
    `Alerta gerado porque a previsão passou do seu limite de ${limiar} mm/h.`,
  ]
  const dicas = ['Proteja equipamentos e áreas expostas', 'Evite atividades ao ar livre no horário de pico']
  return {
    assunto: `Alerta de chuva forte em ${local(c)}`,
    texto: linhas.join('\n') + '\n- ' + dicas.join('\n- '),
    dados: { ...e, limiar_chuva_mm: limiar },
  }
}

export function mensagemGeada(u: UsuarioRow, c: CidadeRow, e: EventoGeada, limiar: number): Mensagem {
  const linhas = [
    `Alerta de geada, ${primeiroNome(u.nome)}: mínima prevista de ${r0(e.minima)}°C em ${local(c)}.`,
    `Temperatura mais baixa por volta de ${hh(e.hora_minima)}.`,
    `Alerta gerado porque a mínima ficou igual ou abaixo do seu limite de ${limiar}°C.`,
  ]
  const dicas = ['Proteja mudas e cultivos sensíveis', 'Evite irrigação durante a madrugada']
  return {
    assunto: `Alerta de geada em ${local(c)}`,
    texto: linhas.join('\n') + '\n- ' + dicas.join('\n- '),
    dados: { ...e, limiar_geada_c: limiar },
  }
}
