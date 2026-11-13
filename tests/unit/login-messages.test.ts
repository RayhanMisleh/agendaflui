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
  expect(roleLabel('OWNER', 'Barbeiro')).toBe('Dono')
  expect(roleLabel('MANAGER', 'Barbeiro')).toBe('Gerente')
  expect(roleLabel('PROFESSIONAL', 'Tosador')).toBe('Tosador')
})
