export interface CidadeBusca {
  nome: string
  estado: string | null
  uf: string | null
  pais: string
  latitude: number
  longitude: number
}

export interface Atual {
  hora: string
  temperatura: number
  sensacao: number
  umidade: number
  vento_kmh: number
  chuva_mm: number
  codigo: number
}

export interface Dia {
  data: string
  max: number
  min: number
  chuva_mm: number
  prob_chuva: number | null
  codigo: number
}

export interface Hora {
  hora: string
  temperatura: number
  chuva_mm: number
  prob_chuva: number | null
}

export interface Previsao {
  atual: Atual
  dias: Dia[]
  horas: Hora[]
  atualizado_em: string
  fonte: string
}

export interface WeatherClient {
  buscarCidades(q: string): Promise<CidadeBusca[]>
  previsao(lat: number, lon: number): Promise<Previsao>
}

export class WeatherError extends Error {}

const DESCRICOES: Record<number, string> = {
  0: 'Céu limpo',
  1: 'Predominantemente limpo',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Neblina',
  51: 'Garoa',
  61: 'Chuva',
  71: 'Neve',
  80: 'Pancadas de chuva',
  95: 'Trovoadas',
}

export function descricaoClima(codigo: number): string {
  if (codigo >= 51 && codigo <= 57) return 'Garoa'
  if (codigo >= 61 && codigo <= 67) return 'Chuva'
  if (codigo >= 71 && codigo <= 77) return 'Neve'
  if (codigo >= 80 && codigo <= 82) return 'Pancadas de chuva'
  if (codigo === 85 || codigo === 86) return 'Pancadas de neve'
  if (codigo >= 96 && codigo <= 99) return 'Trovoadas com granizo'
  return DESCRICOES[codigo] ?? 'Tempo variável'
}
