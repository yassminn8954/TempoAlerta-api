import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import type { Deps } from '../src/services/envio.js'
import type { Mailer } from '../src/services/mailer.js'
import type { CidadeBusca, Previsao, WeatherClient } from '../src/services/openMeteo.js'

export interface Cenario {
  chuvaPico?: number // mm/h no pico
  minima?: number // menor temperatura horária
}

/** Previsão sintética: agora = 2026-10-26 06:30 (horário local), 48h de horas. */
export function previsaoFake(c: Cenario = {}): Previsao {
  const horas = Array.from({ length: 48 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 26, 6 + i))
    const iso = d.toISOString().slice(0, 13) + ':00'
    return {
      hora: iso,
      temperatura: i === 10 ? (c.minima ?? 15) : 18,
      chuva_mm: i === 5 ? (c.chuvaPico ?? 0) : 0,
      prob_chuva: 10,
    }
  })
  const dias = Array.from({ length: 7 }, (_, i) => ({
    data: `2026-10-${26 + i > 31 ? '0' + (26 + i - 31) : 26 + i}`,
    max: 27,
    min: i === 0 ? (c.minima ?? 15) : 16,
    chuva_mm: 1,
    prob_chuva: 20,
    codigo: 2,
  }))
  return {
    atual: { hora: '2026-10-26T06:30', temperatura: 19, sensacao: 19, umidade: 70, vento_kmh: 10, chuva_mm: 0, codigo: 2 },
    dias,
    horas,
    atualizado_em: new Date().toISOString(),
  }
}

export class WeatherFake implements WeatherClient {
  cenario: Cenario = {}
  falhar = false
  async buscarCidades(): Promise<CidadeBusca[]> {
    return [{ nome: 'Campinas', estado: 'São Paulo', uf: 'SP', pais: 'Brasil', latitude: -22.9, longitude: -47.06 }]
  }
  async previsao() {
    if (this.falhar) throw new Error('api fora')
    return previsaoFake(this.cenario)
  }
}

export class MailerFake implements Mailer {
  enviados: { para: string; assunto: string; texto: string }[] = []
  falhar = false
  async enviar(para: string, assunto: string, texto: string) {
    if (this.falhar) throw new Error('smtp fora')
    this.enviados.push({ para, assunto, texto })
  }
}

export async function subir() {
  const weather = new WeatherFake()
  const mailer = new MailerFake()
  const deps: Deps = { db: openDb(':memory:'), weather, mailer }
  const server = createApp(deps).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}/api`

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  let n = 0
  async function novoUsuario(nome = 'Carlos Ribeiro') {
    const email = `u${++n}@teste.com`
    const r = await api('POST', '/auth/cadastro', { nome, email, senha: 'senha-forte-1' })
    return { token: r.body.token as string, id: r.body.usuario.id as number, email }
  }

  const campinas = { nome: 'Campinas', estado: 'SP', latitude: -22.9, longitude: -47.06 }
  const holambra = { nome: 'Holambra', estado: 'SP', latitude: -22.63, longitude: -47.05 }

  return { deps, weather, mailer, api, novoUsuario, campinas, holambra, fechar: () => server.close() }
}
