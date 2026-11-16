import { clientIp, ipLimitKeyPart } from '@/server/auth/client-ip'

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

test('tira a porta do IPv4 e os colchetes e a porta do IPv6', () => {
  expect(clientIp(com('1.2.3.4:5678'), 1)).toBe('1.2.3.4')
  expect(clientIp(com('[2001:db8::1]:443'), 1)).toBe('2001:db8::1')
  expect(clientIp(com('[2001:db8::1]'), 1)).toBe('2001:db8::1')
  expect(clientIp(com('1.2.3.4:'), 1)).toBeNull()
  expect(clientIp(com('1.2.3.4:abc'), 1)).toBeNull()
})

test('IPv4 mapeado em IPv6 vira IPv4, em qualquer caixa', () => {
  expect(clientIp(com('::ffff:1.2.3.4'), 1)).toBe('1.2.3.4')
  expect(clientIp(com('::FFFF:1.2.3.4'), 1)).toBe('1.2.3.4')
  expect(clientIp(com('[::ffff:1.2.3.4]:80'), 1)).toBe('1.2.3.4')
})

test('IPv6 sai em minúsculas', () => {
  expect(clientIp(com('2001:DB8::ABCD'), 1)).toBe('2001:db8::abcd')
})

test('ipLimitKeyPart: IPv4 é o próprio endereço', () => {
  expect(ipLimitKeyPart('203.0.113.9')).toBe('203.0.113.9')
})

test('ipLimitKeyPart: IPv6 vira o /64 expandido, igual dentro do mesmo /64', () => {
  expect(ipLimitKeyPart('2001:db8::1')).toBe('2001:db8:0:0::/64')
  expect(ipLimitKeyPart('2001:db8:0:0:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:0::/64')
  expect(ipLimitKeyPart('2001:DB8::ffff')).toBe(ipLimitKeyPart('2001:db8:0:0:1:2:3:4'))
  expect(ipLimitKeyPart('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64')
  expect(ipLimitKeyPart('2001:db8:0:1::1')).not.toBe(ipLimitKeyPart('2001:db8:0:2::1'))
  expect(ipLimitKeyPart('::1')).toBe('0:0:0:0::/64')
  expect(ipLimitKeyPart('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3:0::/64')
  expect(ipLimitKeyPart('1:2:3:4:5:6:7:8')).toBe('1:2:3:4::/64')
})

test('endereço com zone id (%) é recusado e ipLimitKeyPart nunca lança', () => {
  expect(clientIp(com('fe80::1%eth0'), 1)).toBeNull()
  expect(clientIp(com('1:2:3:4:5:6:7:8%a::b'), 1)).toBeNull()
  expect(ipLimitKeyPart('fe80::1%eth0')).toBe('fe80::1%eth0')
  expect(ipLimitKeyPart('1:2:3:4:5:6:7:8%a::b')).toBe('1:2:3:4:5:6:7:8%a::b')
  expect(ipLimitKeyPart('lixo')).toBe('lixo')
  expect(ipLimitKeyPart('')).toBe('')
})
