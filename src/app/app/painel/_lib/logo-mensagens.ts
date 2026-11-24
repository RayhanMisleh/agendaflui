/** O que a tela diz depois de enviar (ou remover) a logo: `?logo=<código>`; o código vem da rota de envio. */
export const LOGO: Record<string, { texto: string; ok: boolean }> = {
  ok: { texto: 'Logo atualizada.', ok: true },
  no_file: { texto: 'Escolha uma imagem antes de enviar.', ok: false },
  too_large: { texto: 'A imagem passa de 8 MB. Escolha um arquivo menor.', ok: false },
  not_an_image: { texto: 'Este arquivo não é uma imagem. Envie JPEG, PNG ou WebP.', ok: false },
  unsupported_format: { texto: 'Este formato não é aceito. Envie JPEG, PNG ou WebP.', ok: false },
  too_many_pixels: { texto: 'A imagem é grande demais. Reduza e envie de novo.', ok: false },
  too_small: { texto: 'A imagem é pequena demais. Escolha outra.', ok: false },
  forbidden: { texto: 'Só o dono da conta troca a logo.', ok: false },
  refused: { texto: 'Não foi possível trocar a logo. Tente outra imagem.', ok: false },
}
