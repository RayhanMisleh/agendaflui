import { customerLinkQrSvg, customerLinkUrl } from '@/server/customer-link'
import { parseEnv } from '@/server/env'

const ok = { DATABASE_URL: 'postgres://u:p@localhost:5432/d', APP_SECRET: 'x'.repeat(32) }
const hostsDeProducao = { DEV_HOST: 'dev.exemplo.com', PAINEL_HOST: 'painel.exemplo.com', API_HOST: 'api.exemplo.com' }
const producao = { ...ok, ...hostsDeProducao, NODE_ENV: 'production', MAIL_FROM: undefined }

test('link para clientes junta APP_WEB_URL e o slug', () => {
  expect(customerLinkUrl('patas', 'https://app.agendaflui.com.br')).toBe('https://app.agendaflui.com.br/patas')
})

test('sem a base explícita usa APP_WEB_URL do ambiente (padrão do app)', () => {
  expect(customerLinkUrl('patas')).toBe(`${parseEnv({ ...ok }).APP_WEB_URL}/patas`)
})

test('QR é um SVG preto no branco que codifica o link', async () => {
  const svg = await customerLinkQrSvg('https://app.agendaflui.com.br/patas')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('<path')
  expect(svg).toContain('#000000')
  expect(svg).toContain('#ffffff')
  expect(await customerLinkQrSvg('https://app.agendaflui.com.br/outra')).not.toBe(svg)
})

describe('APP_WEB_URL', () => {
  test('padrão é o app oficial', () => {
    expect(parseEnv(ok).APP_WEB_URL).toBe('https://app.agendaflui.com.br')
  })

  test('aceita esquema e host (com porta) e ignora a caixa', () => {
    expect(parseEnv({ ...ok, APP_WEB_URL: 'https://app.exemplo.com' }).APP_WEB_URL).toBe('https://app.exemplo.com')
    expect(parseEnv({ ...ok, APP_WEB_URL: 'http://localhost:8081' }).APP_WEB_URL).toBe('http://localhost:8081')
  })

  test.each(['https://app.exemplo.com/entrar', 'https://app.exemplo.com/', 'https://app.exemplo.com?x=1', 'app.exemplo.com', 'ftp://app.exemplo.com'])(
    'recusa %s (só esquema e host, sem caminho, consulta nem barra final)',
    (valor) => {
      expect(() => parseEnv({ ...ok, APP_WEB_URL: valor })).toThrow(/APP_WEB_URL/)
    },
  )

  test('em produção recusa http e endereço local, sem imprimir o valor', () => {
    expect(() => parseEnv({ ...producao, APP_WEB_URL: 'http://app.exemplo.com' })).toThrow(/APP_WEB_URL/)
    expect(() => parseEnv({ ...producao, APP_WEB_URL: 'https://localhost:3000' })).toThrow(/APP_WEB_URL/)
    expect(() => parseEnv({ ...producao, APP_WEB_URL: 'https://127.0.0.1' })).toThrow(/APP_WEB_URL/)
    expect(parseEnv({ ...producao, APP_WEB_URL: 'https://app.exemplo.com' }).APP_WEB_URL).toBe('https://app.exemplo.com')
    try {
      parseEnv({ ...producao, APP_WEB_URL: 'http://segredo.exemplo.com' })
    } catch (e) {
      expect(String(e)).not.toContain('segredo.exemplo.com')
    }
  })
})
