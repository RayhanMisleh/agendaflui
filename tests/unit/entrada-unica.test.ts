import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { arquivosCom } from '../setup/varredura'

const RAIZ = resolve(__dirname, '../..')

test('as telas de entrada por conta e de escolher conta não existem mais', () => {
  expect(existsSync(resolve(RAIZ, 'src/app/app/(entrada)/entrar/[slug]'))).toBe(false)
  expect(existsSync(resolve(RAIZ, 'src/app/app/(entrada)/escolher-conta'))).toBe(false)
})

test('nenhum código cita /escolher-conta, BRAND_COOKIE nem link de entrada por conta', () => {
  expect(arquivosCom(/escolher-conta|BRAND_COOKIE|setBrandCookie|entryUrl|selectBusiness|\/entrar\/\$\{/, ['src', 'scripts'])).toEqual([])
})

test('nenhuma tela oferece "Trocar de conta" nem o link de entrada da equipe', () => {
  expect(arquivosCom(/Trocar de conta|Link de entrada|link de entrada/, ['src/app', 'src/ui'])).toEqual([])
})
