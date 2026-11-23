import { porCodigo } from '@/app/_lib/params'

/** O que cada código de `?faltou=` quer dizer. O código vem da criação em etapas; nunca traz segredo. */
const FALTOU: Record<string, string> = {
  marca: 'a marca (cores e barra lateral)',
  logo: 'a logo',
  termos: 'os termos',
  modulos: 'os módulos',
  regras: 'as regras de agenda',
  chave: 'a chave de app',
}

const SUPORTE: Record<string, string> = {
  arquivada: 'Esta conta está arquivada. Reative a conta para entrar como suporte.',
  falhou: 'Não foi possível entrar como suporte agora. Tente de novo; se continuar, confira se a conta está ativa.',
}

/** Itens que faltaram na criação da conta, por extenso, sem repetir. Código desconhecido (inclusive `__proto__`) some. */
export function traduzirFaltou(valor: string): string[] {
  const textos = valor.split(',').flatMap((c) => porCodigo(FALTOU, c.trim()) ?? [])
  return [...new Set(textos)]
}

/** Frase do aviso de "entrar como"; `undefined` para código desconhecido. */
export function traduzirSuporte(valor: string): string | undefined {
  return porCodigo(SUPORTE, valor)
}
