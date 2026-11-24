'use client'
import { useState } from 'react'
import { BrandPreview, Button, ColorField, Field, FoldablePreview, Input, SidebarStylePicker } from '@/ui/components'
import { previewTheme } from '@/shared/theme/preview'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import { ACCENT_FIELD_LABEL, PRIMARY_FIELD_LABEL } from '@/shared/theme/labels'
import type { CoverMaterial } from '@/shared/theme/derive'
import { ContaForm } from './ContaForm'
import { estadoInicial } from './forms'
import type { AcaoConta, Campos } from './forms'

export type Imagens = { logo: string | null; symbol: string | null; favicon: string | null; loginImage: string | null }

/** Marca da conta: o formulário e a prévia ao vivo lado a lado. As cores e o material trocam a prévia na hora, sem enviar. */
export function MarcaForm({ action, valores, logoUrl }: { action: AcaoConta; valores: Campos; logoUrl: string | null }) {
  const [v, setV] = useState({
    displayName: valores.displayName ?? '',
    primary: valores.primary ?? '',
    accent: valores.accent ?? '',
    material: (valores.material ?? 'LEATHER') as CoverMaterial,
  })
  const set = <K extends keyof typeof v>(k: K, valor: (typeof v)[K]) => setV((p) => ({ ...p, [k]: valor }))
  const { warnings } = previewTheme(v)
  const avisoPrincipal = warnings.includes('text_adjusted') ? THEME_WARNING_TEXT.text_adjusted : undefined
  const avisoDestaque = warnings.includes('accent_adjusted') ? THEME_WARNING_TEXT.accent_adjusted : undefined

  return (
    <div className="af-wizard__layout af-wizard__layout--aside">
      <div className="af-wizard__main">
        <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar marca">
          {({ fields }) => (
            <>
              <div className="af-wizard__grid">
                <Field label="Nome de exibição" hint="Aparece na barra lateral do painel e nos e-mails." error={fields.displayName}>
                  <Input name="displayName" value={v.displayName} onChange={(e) => set('displayName', e.target.value)} autoComplete="off" />
                </Field>
                <span />
                <ColorField label={PRIMARY_FIELD_LABEL} name="primary" value={v.primary} onChange={(c) => set('primary', c)} {...(fields.primary ? { error: fields.primary } : {})} {...(avisoPrincipal ? { warning: avisoPrincipal } : {})} />
                <ColorField label={ACCENT_FIELD_LABEL} name="accent" value={v.accent} onChange={(c) => set('accent', c)} {...(fields.accent ? { error: fields.accent } : {})} {...(avisoDestaque ? { warning: avisoDestaque } : {})} />
              </div>
              <SidebarStylePicker name="material" value={v.material} onChange={(m) => set('material', m)} primary={v.primary} accent={v.accent} />
            </>
          )}
        </ContaForm>
      </div>
      <FoldablePreview className="af-wizard__aside">
        <BrandPreview businessName={v.displayName} brand={{ ...v, logoUrl }} />
      </FoldablePreview>
    </div>
  )
}

const SLOTS: ReadonlyArray<{ slot: keyof Imagens; label: string; hint: string }> = [
  { slot: 'logo', label: 'Logo', hint: 'Aparece na barra lateral do painel.' },
  { slot: 'symbol', label: 'Símbolo', hint: 'A marca em tamanho pequeno, para o menu recolhido.' },
  { slot: 'favicon', label: 'Favicon', hint: 'O ícone da aba do navegador. Use uma imagem quadrada.' },
  { slot: 'loginImage', label: 'Imagem de entrada', hint: 'A imagem da tela de entrada da conta.' },
]

/** Uma ficha por imagem: formulário POST multipart para a rota própria de imagens (funciona sem JavaScript). */
function Slot({ businessId, slot, label, hint, url }: { businessId: string; slot: keyof Imagens; label: string; hint: string; url: string | null }) {
  return (
    <form method="post" action={`/contas/${businessId}/imagens/${slot}`} encType="multipart/form-data" className="af-imgslot">
      <div className="af-imgslot__view">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem da conta servida pela rota /arquivos
          <img src={url} alt={`${label} atual`} className="af-imgslot__img" />
        ) : (
          <span className="af-imgslot__empty">Sem imagem</span>
        )}
      </div>
      <div className="af-imgslot__body">
        <Field label={label} hint={`${hint} JPEG, PNG ou WebP, até 8 MB.`}>
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="af-input" />
        </Field>
        <div className="af-imgslot__actions">
          <Button type="submit" variant="primary" size="sm">
            Enviar {label.toLowerCase()}
          </Button>
          {url ? (
            <Button type="submit" name="intent" value="remove" size="sm" formNoValidate>
              Remover {label.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}

/** Uma ficha por imagem da marca: prévia da atual, enviar e remover. O resultado volta na URL (`?imagem=`). */
export function ImagensForm({ businessId, imagens }: { businessId: string; imagens: Imagens }) {
  return (
    <div className="af-imgslots">
      {SLOTS.map((s) => (
        <Slot key={s.slot} businessId={businessId} slot={s.slot} label={s.label} hint={s.hint} url={imagens[s.slot]} />
      ))}
    </div>
  )
}
