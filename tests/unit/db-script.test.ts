import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DbStartError, describeStartFailure, removeStalePidFile } from '../../scripts/db'

test('porta ocupada vira frase clara', () => {
  const msg = describeStartFailure(Object.assign(new Error('x'), { code: 'EADDRINUSE' }), 54329)
  expect(msg).toContain('54329')
  expect(msg).toMatch(/já está em uso/)
})

test('erro desconhecido orienta a limpar o banco local', () => {
  expect(describeStartFailure(new Error('boom'), 54329)).toMatch(/npm run db:reset/)
})

describe('removeStalePidFile', () => {
  function dirComPid(conteudo: string) {
    const dir = mkdtempSync(join(tmpdir(), 'agendaflui-pid-'))
    writeFileSync(join(dir, 'postmaster.pid'), conteudo)
    return dir
  }

  test('apaga o arquivo quando o processo não existe mais', () => {
    const dir = dirComPid('2147483646\n/data\n')
    expect(removeStalePidFile(dir)).toBe(true)
    expect(existsSync(join(dir, 'postmaster.pid'))).toBe(false)
    rmSync(dir, { recursive: true })
  })

  test('mantém o arquivo quando o processo está vivo', () => {
    const dir = dirComPid(`${process.pid}\n/data\n`)
    expect(removeStalePidFile(dir)).toBe(false)
    expect(existsSync(join(dir, 'postmaster.pid'))).toBe(true)
    rmSync(dir, { recursive: true })
  })

  test('não faz nada sem arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agendaflui-pid-'))
    expect(removeStalePidFile(dir)).toBe(false)
    rmSync(dir, { recursive: true })
  })
})

describe('describeStartFailure com o formato real da biblioteca', () => {
  test('rejeição com undefined não vira a palavra "undefined"', () => {
    const msg = describeStartFailure(undefined, 54329)
    expect(msg).not.toMatch(/undefined/i)
    expect(msg).toMatch(/db:reset/)
  })

  test('log de porta ocupada vira "já está em uso" sem sugerir db:reset', () => {
    const err = new DbStartError(
      '',
      'FATAL:  could not create any TCP/IP sockets\nLOG:  could not bind IPv4 address "127.0.0.1": Address already in use',
    )
    const msg = describeStartFailure(err, 54329)
    expect(msg).toContain('54329')
    expect(msg).toMatch(/já está em uso/)
    expect(msg).not.toMatch(/db:reset/)
  })
})
