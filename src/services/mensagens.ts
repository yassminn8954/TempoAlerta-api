import type { CidadeRow, UsuarioRow } from '../db.js'
import { descricaoClima, type Previsao } from './openMeteo.js'
import type { EventoChuva, EventoGeada } from './regras.js'

export interface Mensagem {
  assunto: string
  texto: string
  html: string
  dados: Record<string, unknown>
}

const r0 = (n: number) => Math.round(n)
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0]
const local = (c: CidadeRow) => (c.estado ? `${c.nome}, ${c.estado}` : c.nome)
const hh = (iso: string) => iso.slice(11, 16).replace(':00', 'h').replace(/^0/, '')

function html(titulo: string, linhas: string[], conselhos: string[] = []) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<h2 style="color:#0ea5e9">TempoAlerta</h2><h3>${esc(titulo)}</h3>
${linhas.map((l) => `<p>${esc(l)}</p>`).join('\n')}
${conselhos.length ? `<ul>${conselhos.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
<p style="color:#64748b;font-size:12px">Dados meteorológicos: Open-Meteo.</p></div>`
}

export function mensagemDiaria(u: UsuarioRow, c: CidadeRow, p: Previsao): Mensagem {
  const hoje = p.dias[0]
  const desc = descricaoClima(hoje.codigo)
  const linhas = [
    `Bom dia, ${primeiroNome(u.nome)}! Previsão de hoje para ${local(c)}:`,
    `${desc}. Máxima de ${r0(hoje.max)}°C e mínima de ${r0(hoje.min)}°C (agora: ${r0(p.atual.temperatura)}°C).`,
    `Chance de chuva: ${r0(hoje.prob_chuva)}% (${hoje.chuva_mm} mm previstos). Vento de ${r0(p.atual.vento_kmh)} km/h e umidade de ${r0(p.atual.umidade)}%.`,
  ]
  return {
    assunto: `Previsão de hoje em ${local(c)}`,
    texto: linhas.join('\n'),
    html: html(`Previsão de hoje — ${local(c)}`, linhas),
    dados: { dia: hoje, atual: p.atual },
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
    html: html(`Chuva forte — ${local(c)}`, linhas, dicas),
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
    html: html(`Risco de geada — ${local(c)}`, linhas, dicas),
    dados: { ...e, limiar_geada_c: limiar },
  }
}
