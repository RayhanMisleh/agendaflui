import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Storage } from './storage'

const SUFIXO_META = '.meta'

/** Chave de armazenamento recusada (caminho que tenta sair da pasta ou malformado). */
export class InvalidStorageKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStorageKeyError'
  }
}

function validarChave(chave: string): void {
  if (chave.length === 0) throw new InvalidStorageKeyError('Chave de arquivo vazia.')
  if (chave.includes('\0')) throw new InvalidStorageKeyError('Chave de arquivo com byte nulo.')
  if (chave.startsWith('/')) throw new InvalidStorageKeyError('Chave de arquivo não pode começar com barra.')
  if (chave.includes('\\')) throw new InvalidStorageKeyError('Chave de arquivo não pode ter barra invertida.')
  if (chave.split('/').some((parte) => parte === '..' || parte === '')) {
    throw new InvalidStorageKeyError('Chave de arquivo não pode ter ".." nem segmentos vazios.')
  }
  if (chave.endsWith(SUFIXO_META)) {
    throw new InvalidStorageKeyError(`Chave de arquivo não pode terminar em ${SUFIXO_META}.`)
  }
}

/**
 * Guarda arquivos em disco. O tipo do conteúdo fica num arquivo `.meta` ao lado,
 * para servir sem depender do banco.
 */
export function createLocalDiskStorage(rootDir: string): Storage {
  const raiz = resolve(rootDir)

  function caminho(chave: string): string {
    validarChave(chave)
    const alvo = resolve(raiz, chave)
    const rel = relative(raiz, alvo)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      throw new InvalidStorageKeyError('Chave de arquivo fora da pasta de armazenamento.')
    }
    return alvo
  }

  let raizReal: Promise<string> | undefined

  /**
   * `true` se `alvo` (e o seu `.meta`) é o que a chave diz: nenhum link simbólico no caminho, nem na pasta nem no arquivo.
   * Comparar o caminho real com o caminho esperado pega as duas coisas; o que não existe vira `null` no chamador.
   */
  async function semLinks(alvo: string): Promise<boolean> {
    raizReal ??= realpath(raiz)
    const base = await raizReal
    const esperado = resolve(base, relative(raiz, alvo))
    return (await realpath(alvo)) === esperado
  }

  return {
    async put(chave, dados, tipo) {
      const alvo = caminho(chave)
      const meta = `${alvo}${SUFIXO_META}`
      const id = randomUUID()
      const dadosTmp = `${alvo}.${id}.tmp`
      const metaTmp = `${meta}.${id}.tmp`
      await mkdir(dirname(alvo), { recursive: true })
      const existia = await stat(alvo).then((e) => e.isFile(), () => false)
      try {
        await writeFile(metaTmp, JSON.stringify({ contentType: tipo }))
        await writeFile(dadosTmp, dados)
        // Conteúdo primeiro, tipo por último: leitura só vê arquivo com tipo registrado, e nada de `.meta` fica solto.
        await rename(dadosTmp, alvo)
        await rename(metaTmp, meta)
      } catch (erro) {
        // Não sobra rastro: some o que esta chamada criou. Arquivo que já existia antes continua como estava.
        await Promise.all([dadosTmp, metaTmp].map((f) => rm(f, { force: true }).catch(() => undefined)))
        if (!existia) await rm(alvo, { force: true }).catch(() => undefined)
        throw erro
      }
    },
    async get(chave) {
      const alvo = caminho(chave)
      try {
        if (!(await semLinks(alvo)) || !(await semLinks(`${alvo}${SUFIXO_META}`))) return null
        const [dados, meta] = await Promise.all([readFile(alvo), readFile(`${alvo}${SUFIXO_META}`, 'utf8')])
        const parsed: unknown = JSON.parse(meta)
        const tipo =
          typeof parsed === 'object' && parsed !== null && 'contentType' in parsed ? parsed.contentType : undefined
        return { data: dados, contentType: typeof tipo === 'string' ? tipo : 'application/octet-stream' }
      } catch (erro) {
        if (erro instanceof Error && 'code' in erro && (erro.code === 'ENOENT' || erro.code === 'EISDIR')) {
          return null
        }
        throw erro
      }
    },
    async delete(chave) {
      const alvo = caminho(chave)
      await rm(alvo, { force: true })
      await rm(`${alvo}${SUFIXO_META}`, { force: true })
    },
  }
}
