# TempoAlerta — API (back-end)

Node 20+ · TypeScript · Express 5 · PostgreSQL · MET Norway (previsão principal) · Open-Meteo (contingência) · OpenStreetMap Nominatim (busca de cidades) · node-cron · Telegram

## Rodar

```bash
npm install
cp .env.example .env      # troque o JWT_SECRET
npm run dev               # http://localhost:3333/api
npm test                  # testes (banco SQLite em memória)
```

As implementações Fake ficam somente nos testes; a aplicação real não usa dados ou entregas simuladas.

Crie um banco PostgreSQL pelo pgAdmin, por exemplo `tempoalerta`, e configure `DATABASE_URL` no `.env`. A API meteorológica e a busca de cidades não exigem chave:

```env
DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/tempoalerta
```

Troque `postgres` pelo usuário PostgreSQL correto. Se a senha tiver caracteres especiais, codifique-os para URL (por exemplo, `@` como `%40`). Não compartilhe nem versiona o `.env`. Ao iniciar, a API cria as tabelas e índices necessários no banco indicado.

Os alertas são enviados exclusivamente pelo Telegram. Configure `TELEGRAM_BOT_TOKEN` e vincule a conta ao bot na seção **Telegram** abaixo. O e-mail informado no cadastro é usado apenas para login.

Se o navegador mostrar `ERR_CONNECTION_REFUSED` para `localhost:3333`, inicie
a API em um terminal na pasta `tempoalerta-api` com `npm run dev`. Para receber
notificações, configure `TELEGRAM_BOT_TOKEN` e vincule a conta ao bot. Os envios
automáticos ainda exigem `SCHEDULER=on`, preferência habilitada e horário dentro
da janela de envio. O histórico detalha falhas no envio pelo Telegram.

## Telegram

Configure o token do bot somente no `.env` do back-end. A API inicia o polling do bot quando `TELEGRAM_BOT_TOKEN` está definido; `TELEGRAM_BOT_USERNAME` deve corresponder ao username criado no BotFather (sem `@`). Os testes de envio usam a previsão atual: chuva/geada só são enviados se atingirem o limiar cadastrado.

Com o usuário autenticado no front:

1. Consulte `api.telegramStatus()`.
2. Gere um link de uso único com `api.criarVinculoTelegram()` e abra `url` no navegador. O código expira em 10 minutos.
3. O usuário toca em **Start** no Telegram. O vínculo é confirmado pelo bot; depois, previsão diária, chuva forte e geada também são enviados para essa conversa.
4. Para remover o vínculo, chame `api.desvincularTelegram()`.

O chat é associado à conta autenticada, não se deve pedir o `chat_id` manualmente. Se esse Telegram já estiver associado a outra conta, confirmar um novo link válido transfere o vínculo para a conta autenticada. Não execute mais de uma instância com polling do mesmo bot ao mesmo tempo.

## Publicar no Render (demonstração)

O `render.yaml` configura a API como Web Service gratuito. Envie as alterações
para o repositório GitHub `TempoAlerta-api`, crie um **Blueprint** no Render e
conecte esse repositório. O Render instalará as dependências, iniciará a API e
usará `/api/saude` para verificar se ela está ativa.

O Blueprint gera `JWT_SECRET` automaticamente. Configure `TELEGRAM_BOT_TOKEN`
para habilitar o envio de alertas. No plano gratuito, o disco é temporário:
reinícios e novos deploys podem apagar os dados. Use apenas contas e dados de
demonstração; não armazene dados reais nesse serviço.

Se a URL do frontend for diferente de `https://tempoalerta-web.onrender.com`,
altere `CORS_ORIGIN` nas variáveis do serviço da API para a URL pública do
frontend, sem barra no final.

## Banco

| tabela | colunas principais |
|---|---|
| `usuarios` | id, nome, email (único, usado no login), senha_hash, perfil, criado_em |
| `cidades` | id, nome, estado, pais, latitude, longitude (única por lat/lon) |
| `preferencias` | id, usuario_id → usuarios, cidade_id → cidades, configurações de alertas e principal |
| `preferencia_horarios` | preferencia_id → preferencias, horário escolhido para uma previsão diária (até 4 por cidade) |
| `alertas_enviados` | id, usuario_id, cidade_id, tipo, mensagem, dados_json, data_ref, horario_agendado, turno_agendado, enviado_em, status, erro |
| `previsoes_cache` | cache persistente das previsões dos provedores meteorológicos |
| `cidades_busca_cache` | consulta e resultados de cidades; cache compartilhado de 24 horas |

`preferencias` é a tabela de ligação usuário × cidade (N:N) e guarda as configurações de cada cidade.

Previsões ficam em cache por 10 minutos no PostgreSQL e podem ser servidas por até 24 horas durante falhas. MET Norway é a fonte principal; quando estiver inacessível, a API usa Open-Meteo como contingência, também com cache persistente. O campo `fonte` indica qual provedor respondeu. A tela mostra o acumulado previsto de chuva em milímetros.

O serviço meteorológico usa a API de localização do [MET Norway](https://api.met.no/weatherapi/locationforecast/2.0/documentation), com [Open-Meteo](https://open-meteo.com/) como contingência automática. A busca explícita de cidades usa [OpenStreetMap Nominatim](https://operations.osmfoundation.org/policies/nominatim/), com cache e limite de uma requisição por segundo; não fazemos chamadas de autocomplete a cada tecla digitada.

## Endpoints (`/api`, JSON; exceto cadastro/login precisam de `Authorization: Bearer <token>`)

| método | rota | descrição |
|---|---|---|
| POST | `/auth/cadastro` | `{nome, email, senha(min 8), perfil}` → `{token, usuario}` |
| POST | `/auth/login` | `{email, senha}` → `{token, usuario}` |
| GET | `/auth/me` | usuário logado |
| GET | `/cidades/busca?q=camp` | busca explícita de cidades (OpenStreetMap Nominatim, Brasil) |
| GET | `/cidades` | cidades do usuário + preferência de cada uma |
| POST | `/cidades` | `{nome, estado, latitude, longitude, horario_envio?}` (a 1ª vira principal) |
| PATCH | `/cidades/:id/principal` | define cidade principal |
| DELETE | `/cidades/:id` | remove da lista do usuário |
| GET/PUT | `/preferencias/:cidadeId` | até 4 horários em `horarios_previsao`, demais toggles e limiares (PUT aceita campos parciais) |
| GET | `/previsao/:cidadeId` | atual + 7 dias + `status_geral` + `alertas_ativos` (banner) |
| GET | `/alertas` | histórico: `cidadeId, tipo, periodo(dias), busca, pagina, limite` |
| GET | `/alertas/:id` | detalhe + dados que originaram o alerta |
| POST | `/alertas/teste` | `{cidadeId, tipo}` envia na hora (demonstração) |
| GET | `/telegram/status` | informa se o Telegram está vinculado |
| POST | `/telegram/vinculo` | gera link de vinculação, válido por 10 minutos |
| DELETE | `/telegram/vinculo` | remove o vínculo com o Telegram |

`tipo`: `previsao_diaria` · `chuva_forte` · `geada`

## Como os envios funcionam (`src/services/scheduler.ts`)

- **Previsões diárias** — cada cidade pode ter até 4 horários independentes, iniciando por 06:00 e 16:00. A migração preserva os horários configurados anteriormente. A mensagem se ajusta ao horário escolhido (madrugada, manhã, tarde ou noite) e é enviada no minuto exato no fuso `America/Sao_Paulo`; alterações no mesmo dia são respeitadas. Se o horário passar enquanto o agendador estiver indisponível, não envia atrasado; uma falha de entrega permite novas tentativas com intervalo de 10 min, no máximo 3 por horário/dia.
- **Chuva forte / geada** — a cada 30 min, olha as próximas 24 h por cidade:
  chuva forte se algum horário ≥ `limiar_chuva_mm` (mm/h); geada se a temperatura mínima ≤ `limiar_geada_c` (padrão 3 °C, como no front).
  Não repete o mesmo alerta (usuário+cidade+tipo) por 12 h.
- Falha de um canal ou da API do tempo vira registro `falhou` (aparece no histórico); para cada horário diário, as tentativas ocorrem a partir do horário escolhido, com intervalo de 10 min e no máximo 3.
- `SCHEDULER=off` desliga os envios automáticos; o padrão é ligado.

## Ligar o front

1. O projeto front importa o cliente de API em `src/api.ts`.
2. Em `TempoAlerta/.env`, defina `VITE_API_URL=http://localhost:3333/api` para desenvolvimento local; em produção use a URL pública da API.
3. O CORS já aceita `localhost:8443` (Figma Make) e `localhost:5173` (Vite). Outras origens: `CORS_ORIGIN` no `.env`.
4. Login/cadastro, cidades, previsão, preferências, histórico e teste de notificação chamam a API. Sem API disponível, o front exibe o erro em vez de preencher dados de exemplo.

Para o Render, `render.yaml` espera que `DATABASE_URL` (PostgreSQL acessível pelo serviço) e `TELEGRAM_BOT_TOKEN` sejam configurados no painel. O plano gratuito pode suspender o serviço quando ocioso, interrompendo o scheduler e o polling do bot.

## Observações

- Senhas com bcrypt; JWT de 7 dias; consultas SQL parametrizadas.
- Para produção: `NODE_ENV=production` exige `JWT_SECRET` definido. Sugestões: rate limit no login (`express-rate-limit`) e HTTPS.
- Exiba a atribuição da fonte meteorológica retornada pela API e OpenStreetMap para resultados de busca de cidades.
