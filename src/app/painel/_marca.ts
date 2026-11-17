import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'

/** Telas de recuperação de senha: ainda não há conta escolhida, então vale a marca AgendaFlui. */
export const MARCA_ENTRADA = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }
export const TEMA_ENTRADA = deriveTheme(AGENDAFLUI_BRAND)
