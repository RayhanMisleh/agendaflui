import { mensagemDeLogin } from '@/app/_lib/login-form'
import { AuthError } from '@/server/auth/actor'
import { roleLabel } from '@/server/auth/role-labels'

test('cada erro de entrada tem a mensagem combinada, sem dizer se foi o e-mail ou a senha', () => {
  expect(mensagemDeLogin(new AuthError('invalid_credentials'))).toBe('E-mail ou senha incorretos.')
  expect(mensagemDeLogin(new AuthError('rate_limited'))).toBe('Muitas tentativas. Tente de novo em alguns minutos.')
  expect(mensagemDeLogin(new AuthError('account_inactive'))).toBe(
    'Este acesso está desativado. Fale com quem administra a plataforma.',
  )
})

test('o papel aparece em português, com o termo da conta para o profissional', () => {
  expect(roleLabel('OWNER')).toBe('Dono')
  expect(roleLabel('MANAGER')).toBe('Gerente')
  expect(roleLabel('PROFESSIONAL')).toBe('Profissional')
})

test('com a espera conhecida a mensagem traz os minutos, arredondando para cima', () => {
  const com = (s: number) => mensagemDeLogin(new AuthError('rate_limited', s))
  expect(com(1)).toBe('Muitas tentativas. Tente de novo em 1 minuto.')
  expect(com(60)).toBe('Muitas tentativas. Tente de novo em 1 minuto.')
  expect(com(61)).toBe('Muitas tentativas. Tente de novo em 2 minutos.')
  expect(com(900)).toBe('Muitas tentativas. Tente de novo em 15 minutos.')
})
