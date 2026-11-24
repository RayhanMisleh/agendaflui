'use client'
import { Download, Share2 } from 'lucide-react'
import { Button, Card, CopyButton, Input, useHydrated } from '@/ui/components'
import type { CustomerLink } from '@/server/domain/settings/customer-link'

/** O nome do identificador da loja no fim do link (para batizar o arquivo do QR code). */
function slugDoLink(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1)
}

/**
 * "Link para clientes": o endereço do app dentro desta loja, para copiar ou compartilhar, e o QR code para imprimir ou
 * baixar. O SVG do QR nasce no servidor a partir do link da própria loja (nada digitado entra nele).
 */
export function LinkParaClientes({ link }: { link: CustomerLink }) {
  const hidratado = useHydrated()
  const podeCompartilhar = hidratado && typeof navigator.share === 'function'
  const arquivo = `link-clientes-${slugDoLink(link.url)}.svg`
  return (
    <Card as="section" aria-labelledby="link-clientes-titulo" className="af-custlink">
      <div className="af-custlink__main">
        <h2 id="link-clientes-titulo" className="af-custlink__title">
          Link para clientes
        </h2>
        <p className="af-custlink__help">Ponha na bio ou mande ao cliente. Quem entra por aqui fica sempre na sua loja.</p>
        <Input readOnly value={link.url} aria-label="Link para clientes" onFocus={(e) => e.currentTarget.select()} className="af-custlink__url" />
        <div className="af-custlink__actions">
          <CopyButton text={link.url} label="Copiar link para clientes" variant="secondary" />
          {podeCompartilhar ? (
            <Button size="sm" icon={<Share2 size={16} />} onClick={() => void navigator.share({ url: link.url }).catch(() => undefined)}>
              Compartilhar
            </Button>
          ) : null}
        </div>
      </div>
      <div className="af-custlink__qrbox">
        <div className="af-custlink__qr" role="img" aria-label="QR code do link para clientes" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
        <a
          className="af-button af-button--ghost af-button--sm"
          href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qrSvg)}`}
          download={arquivo}
        >
          <span className="af-button__label">
            <span className="af-button__icon" aria-hidden="true">
              <Download size={16} />
            </span>
            Baixar QR code
          </span>
        </a>
      </div>
    </Card>
  )
}
