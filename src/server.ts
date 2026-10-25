import { createApp } from './app.js'
import { openDb } from './db.js'
import { env } from './env.js'
import { criarMailer } from './services/mailer.js'
import { OpenMeteoClient } from './services/openMeteo.js'
import { iniciarScheduler } from './services/scheduler.js'

if (process.env.NODE_ENV === 'production' && env.jwtSecret.startsWith('dev-secret')) {
  throw new Error('Defina JWT_SECRET no .env antes de rodar em produção')
}

const deps = { db: openDb(env.dbPath), weather: new OpenMeteoClient(), mailer: criarMailer() }
const app = createApp(deps)

if (env.schedulerOn) iniciarScheduler(deps)

app.listen(env.port, () => console.log(`TempoAlerta API em http://localhost:${env.port}/api (e-mail: ${env.mailMode})`))
