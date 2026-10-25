import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export type DB = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  perfil      TEXT NOT NULL CHECK (perfil IN ('produtor_rural','organizador_eventos')),
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS cidades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  estado     TEXT,
  pais       TEXT NOT NULL DEFAULT 'Brasil',
  latitude   REAL NOT NULL,
  longitude  REAL NOT NULL,
  UNIQUE (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS preferencias (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id               INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cidade_id                INTEGER NOT NULL REFERENCES cidades(id),
  horario_envio            TEXT    NOT NULL DEFAULT '06:00',
  receber_previsao_diaria  INTEGER NOT NULL DEFAULT 1,
  alerta_chuva_forte       INTEGER NOT NULL DEFAULT 1,
  alerta_geada             INTEGER NOT NULL DEFAULT 1,
  limiar_chuva_mm          REAL    NOT NULL DEFAULT 25,
  limiar_geada_c           REAL    NOT NULL DEFAULT 3,
  principal                INTEGER NOT NULL DEFAULT 0,
  UNIQUE (usuario_id, cidade_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pref_principal
  ON preferencias (usuario_id) WHERE principal = 1;

CREATE TABLE IF NOT EXISTS alertas_enviados (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cidade_id   INTEGER NOT NULL REFERENCES cidades(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('previsao_diaria','chuva_forte','geada')),
  mensagem    TEXT NOT NULL,
  dados_json  TEXT,
  data_ref    TEXT NOT NULL,           -- dia local (YYYY-MM-DD) usado para evitar duplicidade
  enviado_em  TEXT NOT NULL,           -- ISO UTC da tentativa
  status      TEXT NOT NULL CHECK (status IN ('enviado','falhou')),
  erro        TEXT
);
CREATE INDEX IF NOT EXISTS ix_alertas_usuario ON alertas_enviados (usuario_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS ix_alertas_dedupe ON alertas_enviados (usuario_id, cidade_id, tipo, enviado_em);
`

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

export type Tipo = 'previsao_diaria' | 'chuva_forte' | 'geada'

export interface UsuarioRow {
  id: number
  nome: string
  email: string
  senha_hash: string
  perfil: 'produtor_rural' | 'organizador_eventos'
  criado_em: string
}
export interface CidadeRow {
  id: number
  nome: string
  estado: string | null
  pais: string
  latitude: number
  longitude: number
}
export interface PreferenciaRow {
  id: number
  usuario_id: number
  cidade_id: number
  horario_envio: string
  receber_previsao_diaria: number
  alerta_chuva_forte: number
  alerta_geada: number
  limiar_chuva_mm: number
  limiar_geada_c: number
  principal: number
}
