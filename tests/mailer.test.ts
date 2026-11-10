import assert from 'node:assert/strict'
import { afterEach, it } from 'node:test'

process.env.MAIL_MODE = 'resend'
process.env.RESEND_API_KEY = 're_test_key'
process.env.MAIL_FROM = 'TempoAlerta <onboarding@resend.dev>'

const { criarMailer } = await import('../src/services/mailer.js')
const fetchOriginal = globalThis.fetch

afterEach(() => {
  globalThis.fetch = fetchOriginal
})

it('sends email through the Resend HTTPS API', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input)
    requestInit = init
    return new Response(JSON.stringify({ id: 'email_test_id' }), { status: 200 })
  }

  const mailer = criarMailer()
  assert.ok(mailer)
  await mailer.enviar('recipient@example.com', 'Test subject', 'Plain text', '<p>HTML</p>')

  assert.equal(requestUrl, 'https://api.resend.com/emails')
  assert.equal(new Headers(requestInit?.headers).get('authorization'), 'Bearer re_test_key')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    from: 'TempoAlerta <onboarding@resend.dev>',
    to: 'recipient@example.com',
    subject: 'Test subject',
    text: 'Plain text',
    html: '<p>HTML</p>',
  })
  assert.ok(requestInit?.signal)
})

it('reports Resend HTTP errors instead of counting them as sent', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'domain is not verified' }), { status: 403 })

  const mailer = criarMailer()
  assert.ok(mailer)
  await assert.rejects(
    mailer.enviar('recipient@example.com', 'Test subject', 'Plain text', '<p>HTML</p>'),
    /Resend respondeu HTTP 403/,
  )
})
