import { z } from '@/server/domain/errors'
import { uuid } from '../wire'

/* Esquema de resposta (formato de fio) dos Banners: só o que o app mostra. */

export const bannerSchema = z.object({
  id: uuid,
  title: z.string(),
  imageUrl: z.string().describe('Endereço absoluto da imagem.'),
  linkUrl: z.string().nullable().describe('Endereço https:// ou rota do app (por exemplo /servicos); nulo quando o banner não leva a lugar nenhum.'),
})
