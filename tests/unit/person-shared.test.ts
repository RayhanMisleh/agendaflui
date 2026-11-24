import { describe, expect, test } from 'vitest'
import { emailChangeUnlinksGoogle } from '@/shared/person'

describe('emailChangeUnlinksGoogle (regra 9)', () => {
  test('sem Google nunca desvincula', () => {
    expect(emailChangeUnlinksGoogle(null, 'a@x')).toBe(false)
  })

  test('o mesmo e-mail do Google, com maiúsculas e espaços, mantém o vínculo', () => {
    expect(emailChangeUnlinksGoogle({ email: 'a@x' }, 'A@X ')).toBe(false)
  })

  test('e-mail diferente do Google desvincula', () => {
    expect(emailChangeUnlinksGoogle({ email: 'a@x' }, 'b@x')).toBe(true)
  })
})
