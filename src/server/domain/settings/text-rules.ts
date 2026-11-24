import { z } from '@/server/domain/errors'

export const MSG_MARCACAO = 'Não use os sinais < e >.'
export const MSG_CONTROLE = 'Não use caracteres de controle (como quebra de linha ou tabulação).'
// \p{C}: controle, formato (como o espaço de largura zero), surrogates soltos e não atribuídos.
// O U+200D (junção de emoji) vale: sem ele os emojis compostos (família, profissões) se quebram.
export const SEM_CONTROLE = (v: string) => !/[^\P{C}\u200D]/u.test(v)
export const SEM_MARCACAO = (v: string) => !/[<>]/.test(v)
// Na mensagem de entrada a quebra de linha vale; qualquer outro caractere de controle não.
export const SEM_CONTROLE_EXCETO_LINHA = (v: string) => !/[^\P{C}\r\n\u200D]/u.test(v)
// A junção só vale ENTRE dois caracteres de verdade (emoji composto): sozinha, no começo, no fim, repetida ou ao lado de
// espaço ela deixaria um texto "vazio" passar, ou um nome terminado em caractere invisível.
export const MSG_JUNCAO = 'Não deixe o caractere invisível de junção de emoji sozinho, no começo, no fim ou repetido.'
const JUNCAO_SOLTA = /(^|[\s\u200D])\u200D|\u200D($|[\s\u200D])/u
export const SEM_JUNCAO_SOLTA = (v: string) => !JUNCAO_SOLTA.test(v)

/** Nome de exibição da conta: o mesmo esquema para o painel dev (marca) e para o dono (dados do negócio). */
export const displayNameSchema = z
  .string('Informe o nome de exibição.')
  .trim()
  .min(1, 'Informe o nome de exibição.')
  .max(80, 'Use no máximo 80 caracteres.')
  .refine(SEM_MARCACAO, MSG_MARCACAO)
  .refine(SEM_CONTROLE, MSG_CONTROLE)
  .refine(SEM_JUNCAO_SOLTA, MSG_JUNCAO)
