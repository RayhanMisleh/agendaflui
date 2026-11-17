import 'server-only'
import { revalidatePath } from 'next/cache'

/** Depois de gravar, todas as telas do painel do negócio leem de novo (listas, fichas e a barra lateral). */
export function atualizarPainel(): void {
  revalidatePath('/painel', 'layout')
}
