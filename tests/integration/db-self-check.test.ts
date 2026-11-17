import { describe, expect, test } from 'vitest'
import { runSelfCheck } from '@/server/db/self-check'

describe('autoverificação contra o banco de teste', () => {
  test('conexão do tipo do servidor mantém UTC (mesmo com o banco em outro fuso), trava e btree_gist', async () => {
    await expect(runSelfCheck(process.env['DATABASE_URL'] ?? '')).resolves.toBeUndefined()
  })

  test('banco inalcançável: erro curto sem a URL nem a senha', async () => {
    const erro = await runSelfCheck('postgres://u:senha-secreta@127.0.0.1:1/d').then(() => null, (e: unknown) => e)
    expect(String(erro)).toMatch(/conectar ao banco/)
    expect(String(erro)).not.toContain('senha-secreta')
  })
})
