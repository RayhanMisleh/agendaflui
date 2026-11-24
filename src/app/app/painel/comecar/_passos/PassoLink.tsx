'use client'
import { Download, PartyPopper } from 'lucide-react'
import { Button, CopyButton, Input, ShareButton } from '@/ui/components'
import { useActionState } from 'react'
import { ESTADO_INICIAL } from '../../_lib/PainelForm'
import { terminar } from '../actions'

/**
 * Passo 7: o link e o QR code para os clientes, com "Copiar" e "Compartilhar". O QR nasce no servidor a partir do link da
 * própria loja (nada digitado entra nele). "Terminar" encerra o passo a passo e leva ao painel.
 */
export function PassoLink({ url, qrSvg, storeName }: { url: string; qrSvg: string; storeName: string }) {
  const [state, action, pending] = useActionState(terminar, ESTADO_INICIAL)
  return (
    <div className="af-onb__link">
      <div className="af-onb__link-main">
        <p className="af-onb__lead">É por aqui que os clientes marcam horário. Ponha na bio, mande no WhatsApp ou imprima o QR code.</p>
        <Input readOnly value={url} aria-label="Link para clientes" onFocus={(e) => e.currentTarget.select()} className="af-onb__url" />
        <div className="af-onb__link-actions">
          <CopyButton text={url} label="Copiar link para clientes" variant="secondary" />
          <ShareButton url={url} title={storeName} text={`Marque seu horário na ${storeName}`} />
        </div>
      </div>
      <div className="af-onb__qr">
        <div className="af-onb__qr-img" role="img" aria-label="QR code do link para clientes" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <a
          className="af-button af-button--ghost af-button--sm"
          href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
          download="link-clientes.svg"
        >
          <span className="af-button__label">
            <span className="af-button__icon" aria-hidden="true">
              <Download size={16} />
            </span>
            Baixar QR code
          </span>
        </a>
      </div>
      <form action={action} className="af-onb__finish">
        {state.message && !state.ok ? (
          <p role="alert" className="af-field__error">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={pending} icon={<PartyPopper size={18} />}>
          Terminar e ir para o painel
        </Button>
      </form>
    </div>
  )
}
