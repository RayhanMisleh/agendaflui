/** O que dizer da foto do pet, pelo código que a rota de envio devolve (`?foto=` na ficha, `code` no quiz). */
export const FOTO: Record<string, { texto: string; ok: boolean }> = {
  ok: { texto: 'Foto atualizada.', ok: true },
  no_file: { texto: 'Escolha uma imagem antes de enviar.', ok: false },
  too_large: { texto: 'A foto passa de 8 MB. Escolha um arquivo menor.', ok: false },
  not_an_image: { texto: 'Este arquivo não é uma imagem. Envie JPEG, PNG ou WebP.', ok: false },
  unsupported_format: { texto: 'Este formato não é aceito. Envie JPEG, PNG ou WebP.', ok: false },
  too_many_pixels: { texto: 'A imagem é grande demais. Reduza e envie de novo.', ok: false },
  too_small: { texto: 'A imagem é pequena demais. Escolha outra.', ok: false },
  refused: { texto: 'Não deu para trocar a foto. Tente de novo.', ok: false },
  not_found: { texto: 'Este pet não existe mais.', ok: false },
}
