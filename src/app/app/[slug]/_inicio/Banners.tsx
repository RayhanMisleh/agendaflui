import { safeReturnPath } from '@/shared/return-path'

type Banner = { id: string; title: string; imageUrl: string; linkUrl: string | null }

/** O link do banner só vale se for `https` ou um caminho desta loja; qualquer outra coisa vira banner sem link. */
export function linkSeguro(slug: string, url: string | null): { href: string; externo: boolean } | null {
  if (url === null) return null
  if (/^https:\/\//i.test(url)) return { href: url, externo: true }
  const caminho = safeReturnPath(slug, url)
  return caminho ? { href: caminho, externo: false } : null
}

/** Os banners da loja: faixa que rola de lado e encaixa, imagem 16:9. Sem banner, nada é desenhado. */
export function Banners({ slug, banners }: { slug: string; banners: Banner[] }) {
  if (banners.length === 0) return null
  return (
    <section aria-label="Novidades da loja" className="af-cl-banners">
      <ul className="af-cl-banners__strip">
        {banners.map((b) => {
          const link = linkSeguro(slug, b.linkUrl)
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui
          const img = <img src={b.imageUrl} alt={b.title} className="af-cl-banners__img" loading="lazy" />
          return (
            <li key={b.id} className="af-cl-banners__item">
              {link ? (
                <a href={link.href} className="af-cl-banners__link" {...(link.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  {img}
                </a>
              ) : (
                img
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
