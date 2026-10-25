// Copie para tempoalerta/src/api.ts e crie tempoalerta/.env com: VITE_API_URL=http://localhost:3333/api
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api'

export type Tipo = 'previsao_diaria' | 'chuva_forte' | 'geada'
export type Perfil = 'produtor_rural' | 'organizador_eventos'

export interface Usuario { id: number; nome: string; email: string; perfil: Perfil }
export interface Preferencia {
  horario_envio: string
  receber_previsao_diaria: boolean
  alerta_chuva_forte: boolean
  alerta_geada: boolean
  limiar_chuva_mm: number
  limiar_geada_c: number
}
export interface Cidade {
  id: number; nome: string; estado: string | null; latitude: number; longitude: number
  principal: boolean; preferencia: Preferencia
}
export interface CidadeBusca { nome: string; estado: string | null; uf: string | null; pais: string; latitude: number; longitude: number }
export interface Alerta {
  id: number; tipo: Tipo; status: 'enviado' | 'falhou'; mensagem: string; enviado_em: string; erro?: string | null
  cidade: { id: number; nome: string; estado: string | null }
}

export interface Dia {
  data: string; dia_semana: string; max: number; min: number
  chuva_mm: number; prob_chuva: number; codigo: number; descricao: string
}
export type AlertaAtivo =
  | { tipo: 'chuva_forte'; pico_mm: number; hora_pico: string; total_24h_mm: number; limiar_chuva_mm: number }
  | { tipo: 'geada'; minima: number; hora_minima: string; limiar_geada_c: number }
export interface PrevisaoResp {
  cidade: { id: number; nome: string; estado: string | null }
  atual: { temperatura: number; sensacao: number; umidade: number; vento_kmh: number; chuva_mm: number; codigo: number; descricao: string }
  hoje: Dia
  dias: Dia[]
  status_geral: { risco_geada_48h: boolean; menor_minima: { valor: number; data: string; dia_semana: string } }
  alertas_ativos: AlertaAtivo[]
  atualizado_em: string
  fonte: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detalhes?: { campo: string; mensagem: string }[]) {
    super(message)
  }
}

let token: string | null = localStorage.getItem('ta_token')
export const setToken = (t: string | null) => {
  token = t
  t ? localStorage.setItem('ta_token', t) : localStorage.removeItem('ta_token')
}
export const logado = () => !!token

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) setToken(null)
    throw new ApiError(res.status, data.erro ?? 'Erro inesperado', data.detalhes)
  }
  return data as T
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  async cadastro(nome: string, email: string, senha: string, perfil: Perfil) {
    const r = await req<{ token: string; usuario: Usuario }>('POST', '/auth/cadastro', { nome, email, senha, perfil })
    setToken(r.token)
    return r.usuario
  },
  async login(email: string, senha: string) {
    const r = await req<{ token: string; usuario: Usuario }>('POST', '/auth/login', { email, senha })
    setToken(r.token)
    return r.usuario
  },
  sair: () => setToken(null),
  me: () => req<Usuario>('GET', '/auth/me'),
  atualizarPerfil: (perfil: Perfil) => req<Usuario>('PATCH', '/auth/me', { perfil }),

  buscarCidades: (q: string) => req<CidadeBusca[]>('GET', `/cidades/busca${qs({ q })}`),
  cidades: () => req<Cidade[]>('GET', '/cidades'),
  addCidade: (c: { nome: string; estado?: string | null; latitude: number; longitude: number; horario_envio?: string }) =>
    req<Cidade>('POST', '/cidades', c),
  definirPrincipal: (id: number) => req<{ ok: true }>('PATCH', `/cidades/${id}/principal`),
  removerCidade: (id: number) => req<void>('DELETE', `/cidades/${id}`),

  salvarPreferencias: (cidadeId: number, p: Partial<Preferencia>) => req<Preferencia>('PUT', `/preferencias/${cidadeId}`, p),

  previsao: (cidadeId: number) => req<PrevisaoResp>('GET', `/previsao/${cidadeId}`),

  alertas: (f: { cidadeId?: number; tipo?: Tipo; periodo?: number; busca?: string; pagina?: number; limite?: number } = {}) =>
    req<{ itens: Alerta[]; total: number; pagina: number; limite: number }>('GET', `/alertas${qs(f)}`),
  alerta: (id: number) => req<Alerta & { dados: Record<string, unknown> | null; destinatario: string }>('GET', `/alertas/${id}`),
  enviarTeste: (cidadeId: number, tipo: Tipo) => req<{ id: number; status: string }>('POST', '/alertas/teste', { cidadeId, tipo }),
}
