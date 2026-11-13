import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeStartFailure, removeStalePidFile } from '../../scripts/db'

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
