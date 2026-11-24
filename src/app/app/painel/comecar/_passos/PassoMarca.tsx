'use client'
import { useEffect, useId, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { BrandPreview, Button, ColorField, FOTO_MAX_BYTES } from '@/ui/components'
import { previewTheme } from '@/shared/theme/preview'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import type { CoverMaterial } from '@/shared/theme/derive'
import { PainelForm } from '../../_lib/PainelForm'
import type { EstadoPainel } from '../../_lib/PainelForm'
import { salvarMarca } from '../actions'

/** Logo: envio por formulário multipart (funciona sem JavaScript), com prévia e aviso de tamanho antes de enviar. */
function LogoForm({ logoUrl, aviso }: { logoUrl: string | null; aviso: { texto: string; ok: boolean } | null }) {
  const id = useId()
  const [previa, setPrevia] = useState<string | null>(null)
  const [grande, setGrande] = useState(false)
  useEffect(() => {
    if (previa === null) return
    return () => URL.revokeObjectURL(previa)
  }, [previa])
  const mostrada = previa ?? logoUrl
  return (
    <form method="post" action="/painel/comecar/logo" encType="multipart/form-data" className="af-onb__logo">
      <div className="af-onb__logo-frame">
        {mostrada ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo da conta servida pela rota /arquivos (ou escolhida agora)
          <img src={mostrada} alt={previa ? 'Prévia da logo escolhida' : 'Logo atual'} className="af-onb__logo-img" />
        ) : (
          <span className="af-onb__logo-empty">Sem logo</span>
        )}
      </div>
      <div className="af-onb__logo-body">
        <label htmlFor={id} className="af-field__label">
          Logo
        </label>
        <input
          id={id}
          className="af-input"
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const arquivo = e.target.files?.[0]
            if (!arquivo) {
              setPrevia(null)
              setGrande(false)
              return
            }
            if (arquivo.size > FOTO_MAX_BYTES) {
              e.target.value = ''
              setPrevia(null)
              setGrande(true)
              return
            }
            setGrande(false)
            setPrevia(URL.createObjectURL(arquivo))
          }}
        />
        {grande ? (
          <p role="alert" className="af-field__error">
            A imagem passa de 8 MB. Escolha um arquivo menor.
          </p>
        ) : aviso ? (
          <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-field__error'}>
            {aviso.texto}
          </p>
        ) : (
          <p className="af-field__hint">JPEG, PNG ou WebP, até 8 MB. A logo é salva ao enviar.</p>
        )}
        <div className="af-onb__logo-actions">
          <Button type="submit" variant="secondary" size="sm" icon={<Camera size={16} />}>
            Enviar logo
          </Button>
          {logoUrl ? (
            <Button type="submit" name="intent" value="remove" variant="ghost" size="sm" icon={<Trash2 size={16} />} formNoValidate>
              Remover logo
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}

/** Passo 2: logo e as duas cores, com a prévia do painel mudando enquanto a pessoa escolhe. */
export function PassoMarca({
  version,
  storeName,
  primary,
  accent,
  material,
  logoUrl,
  logoAviso,
}: {
  version: number
  storeName: string
  primary: string
  accent: string
  material: CoverMaterial
  logoUrl: string | null
  logoAviso: { texto: string; ok: boolean } | null
}) {
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { primary, accent } }
  return (
    <div className="af-onb__brand">
      <LogoForm logoUrl={logoUrl} aviso={logoAviso} />
      <PainelForm action={salvarMarca} initial={inicial} submit="Salvar e continuar" labels={{ primary: 'Cor principal', accent: 'Cor de destaque' }}>
        {(state) => (
          <Cores version={version} storeName={storeName} material={material} logoUrl={logoUrl} primary={state.values.primary ?? primary} accent={state.values.accent ?? accent} erros={state.fields} />
        )}
      </PainelForm>
    </div>
  )
}

function Cores({
  version,
  storeName,
  material,
  logoUrl,
  primary: p0,
  accent: a0,
  erros,
}: {
  version: number
  storeName: string
  material: CoverMaterial
  logoUrl: string | null
  primary: string
  accent: string
  erros: Record<string, string>
}) {
  const [primary, setPrimary] = useState(p0)
  const [accent, setAccent] = useState(a0)
  const { warnings } = previewTheme({ primary, accent, material })
  return (
    <>
      <input type="hidden" name="version" value={String(version)} />
      <div className="af-formgrid">
        <ColorField
          label="Cor principal"
          name="primary"
          value={primary}
          onChange={setPrimary}
          {...(erros.primary ? { error: erros.primary } : {})}
          {...(warnings.includes('text_adjusted') ? { warning: THEME_WARNING_TEXT.text_adjusted } : {})}
        />
        <ColorField
          label="Cor de destaque"
          name="accent"
          value={accent}
          onChange={setAccent}
          {...(erros.accent ? { error: erros.accent } : {})}
          {...(warnings.includes('accent_adjusted') ? { warning: THEME_WARNING_TEXT.accent_adjusted } : {})}
        />
      </div>
      <BrandPreview businessName={storeName} brand={{ primary, accent, material, logoUrl }} />
    </>
  )
}
