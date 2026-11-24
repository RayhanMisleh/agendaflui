import 'server-only'
import { revalidatePath } from 'next/cache'

/** Depois de gravar, as telas da loja leem de novo (Início, Prêmios, Loja, Horários): o cache do roteador cai. */
export function atualizarLoja(): void {
  revalidatePath('/app/[slug]', 'layout')
}
