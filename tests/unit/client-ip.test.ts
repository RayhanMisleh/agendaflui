import { clientIp } from '@/server/auth/client-ip'

const com = (xff?: string): Headers => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff })

test('com 1 salto vale o último endereço; com 2, o penúltimo', () => {
  expect(clientIp(com('evil, 1.2.3.4, 10.0.0.1'), 1)).toBe('10.0.0.1')
  expect(clientIp(com('evil, 1.2.3.4, 10.0.0.1'), 2)).toBe('1.2.3.4')
})

test('sem salto confiável o cabeçalho é ignorado', () => {
  expect(clientIp(com('1.2.3.4'), 0)).toBeNull()
})

test('sem cabeçalho, lista curta demais ou lixo devolvem null', () => {
  expect(clientIp(com(), 1)).toBeNull()
  expect(clientIp(com('1.2.3.4'), 2)).toBeNull()
  expect(clientIp(com('1.2.3.4, lixo'), 1)).toBeNull()
  expect(clientIp(com('999.1.1.1'), 1)).toBeNull()
  expect(clientIp(com(''), 1)).toBeNull()
  expect(clientIp(com('1.2.3.4,'), 1)).toBeNull()
})

test('aceita IPv6 e apara espaços', () => {
  expect(clientIp(com('1.2.3.4,  2001:db8::1 '), 1)).toBe('2001:db8::1')
  expect(clientIp(com('::1'), 1)).toBe('::1')
})
