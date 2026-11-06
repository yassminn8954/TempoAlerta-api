# TempoAlerta — API (back-end)

Node 20+ · TypeScript · Express 5 · PostgreSQL · Open-Meteo (previsão + geocodificação) · node-cron · Nodemailer

## Rodar

```bash
npm install
cp .env.example .env      # troque o JWT_SECRET
npm run dev               # http://localhost:3333/api
npm test                  # testes (banco SQLite em memória)
```

Crie um banco PostgreSQL pelo pgAdmin, por exemplo `tempoalerta`, e configure `DATABASE_URL` no `.env`:

```env
DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/tempoalerta
```

Troque `postgres` pelo usuário PostgreSQL correto. Se a senha tiver caracteres especiais, codifique-os para URL (por exemplo, `@` como `%40`). Não compartilhe nem versiona o `.env`. Ao iniciar, a API cria as tabelas e índices necessários no banco indicado.

Por padrão `MAIL_MODE=log`: o e-mail é **impresso no console** (não envia de verdade).
Para enviar de verdade: `MAIL_MODE=smtp` + `SMTP_*` no `.env` (Gmail com senha de app, Mailtrap, Brevo etc.).

## Telegram

Configure o token do bot somente no `.env` do back-end. A API inicia o polling do bot quando `TELEGRAM_BOT_TOKEN` está definido; `TELEGRAM_BOT_USERNAME` deve corresponder ao username criado no BotFather (sem `@`).

Com o usuário autenticado no front:

1. Consulte `api.telegramStatus()`.
2. Gere um link de uso único com `api.criarVinculoTelegram()` e abra `url` no navegador. O código expira em 10 minutos.
3. O usuário toca em **Start** no Telegram. O vínculo é confirmado pelo bot; depois, previsão diária, chuva forte e geada também são enviados para essa conversa.
4. Para remover o vínculo, chame `api.desvincularTelegram()`.

O chat é associado à conta autenticada, não se deve pedir o `chat_id` manualmente. Não execute mais de uma instância com polling do mesmo bot ao mesmo tempo.

## Publicar no Render (demonstração)

O `render.yaml` configura a API como Web Service gratuito. Envie as alterações
para o repositório GitHub `TempoAlerta-api`, crie um **Blueprint** no Render e
conecte esse repositório. O Render instalará as dependências, iniciará a API e
usará `/api/saude` para verificar se ela está ativa.

O Blueprint gera `JWT_SECRET` automaticamente e configura e-mail em modo `log`,
agendador desligado e SQLite em `./data/tempoalerta.db`. No plano gratuito, o
disco é temporário: reinícios e novos deploys podem apagar os dados. Use apenas
contas e dados de demonstração; não armazene dados reais nesse serviço.

Se a URL do frontend for diferente de `https://tempoalerta-web.onrender.com`,
altere `CORS_ORIGIN` nas variáveis do serviço da API para a URL pública do
frontend, sem barra no final.

## Banco

| tabela | colunas principais |
|---|---|
| `usuarios` | id, nome, email (único), senha_hash, perfil, criado_em |
| `cidades` | id, nome, estado, pais, latitude, longitude (única por lat/lon) |
| `preferencias` | id, usuario_id → usuarios, cidade_id → cidades, horario_envio, receber_previsao_diaria, alerta_chuva_forte, alerta_geada, limiar_chuva_mm, limiar_geada_c, principal |
| `alertas_enviados` | id, usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, enviado_em, status, erro |

`preferencias` é a tabela de ligação usuário × cidade (N:N) e guarda as configurações de cada cidade.

## Endpoints (`/api`, JSON; exceto cadastro/login precisam de `Authorization: Bearer <token>`)

| método | rota | descrição |
|---|---|---|
| POST | `/auth/cadastro` | `{nome, email, senha(min 8), perfil}` → `{token, usuario}` |
| POST | `/auth/login` | `{email, senha}` → `{token, usuario}` |
| GET | `/auth/me` | usuário logado |
| GET | `/cidades/busca?q=camp` | autocomplete (Open-Meteo Geocoding, só Brasil) |
| GET | `/cidades` | cidades do usuário + preferência de cada uma |
| POST | `/cidades` | `{nome, estado, latitude, longitude, horario_envio?}` (a 1ª vira principal) |
| PATCH | `/cidades/:id/principal` | define cidade principal |
| DELETE | `/cidades/:id` | remove da lista do usuário |
| GET/PUT | `/preferencias/:cidadeId` | horário, toggles e limiares (PUT aceita campos parciais) |
| GET | `/previsao/:cidadeId` | atual + 7 dias + `status_geral` + `alertas_ativos` (banner) |
| GET | `/alertas` | histórico: `cidadeId, tipo, periodo(dias), busca, pagina, limite` |
| GET | `/alertas/:id` | detalhe + dados que originaram o alerta |
| POST | `/alertas/teste` | `{cidadeId, tipo}` envia na hora (demonstração) |
| GET | `/telegram/status` | informa se o Telegram está vinculado |
| POST | `/telegram/vinculo` | gera link de vinculação, válido por 10 minutos |
| DELETE | `/telegram/vinculo` | remove o vínculo com o Telegram |

`tipo`: `previsao_diaria` · `chuva_forte` · `geada`

## Como os envios funcionam (`src/services/scheduler.ts`)

- **Previsão diária** — a cada minuto, envia para quem está no `horario_envio` (fuso `America/Sao_Paulo`). Janela de 1 h caso o servidor fique fora do ar; no máx. 1 por cidade/dia.
- **Chuva forte / geada** — a cada 30 min, olha as próximas 24 h por cidade:
  chuva forte se algum horário ≥ `limiar_chuva_mm` (mm/h); geada se a temperatura mínima ≤ `limiar_geada_c` (padrão 3 °C, como no front).
  Não repete o mesmo alerta (usuário+cidade+tipo) por 12 h.
- Falha de e-mail ou da API do tempo vira registro `falhou` (aparece no histórico), com nova tentativa após 10 min e no máx. 3 por dia.

## Ligar o front

1. Copie `front-integration/api.ts` para `TempoAlerta/src/api.ts`.
2. Em `TempoAlerta/.env.local`: `VITE_API_URL=http://localhost:3333/api`.
3. O CORS já aceita `localhost:8443` (Figma Make) e `localhost:5173` (Vite). Outras origens: `CORS_ORIGIN` no `.env`.
4. Hoje o `App.tsx` usa dados fixos; troque por `api.*` (ex.: `api.login`, `api.cidades()`, `api.previsao(id)`, `api.alertas()`). A publicação do frontend, por si só, não integra esses formulários com a API.

## Observações

- Senhas com bcrypt; JWT de 7 dias; consultas SQL parametrizadas.
- Para produção: `NODE_ENV=production` exige `JWT_SECRET` definido. Sugestões: rate limit no login (`express-rate-limit`) e HTTPS.
- Open-Meteo gratuito é para uso não comercial; para uso comercial veja a licença deles.
