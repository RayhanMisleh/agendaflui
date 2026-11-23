import type { Metadata } from 'next'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'

/** Telas de recuperação de senha: ainda não há conta escolhida, então vale a marca Agenda Flui. */
export const MARCA_ENTRADA = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }
export const TEMA_ENTRADA = deriveTheme(AGENDAFLUI_BRAND)

/**
 * Ícones da aba com o favicon enviado pela conta (painel dev, aba Marca). Sem favicon, devolve `undefined` e valem os da
 * marca Agenda Flui do layout raiz. O ícone de tela inicial do celular continua o da marca: o favicon da conta é pequeno.
 */
export function iconesDaConta(faviconUrl: string | null): Metadata['icons'] {
  if (!faviconUrl) return undefined
  return { icon: { url: faviconUrl, type: 'image/png' }, apple: { url: '/brand/agendaflui-icone-180.png', sizes: '180x180' } }
}
