'use client'
import { useActionState, useState } from 'react'
import { BrandPreview, Button, ColorField, Field, Input, MaterialPicker, Select, Textarea } from '@/ui/components'
import { previewTheme } from '@/shared/theme/preview'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import type { CoverMaterial, FontPair, PaperTone } from '@/shared/theme/derive'
import { salvarMarca, trocarImagem } from './actions'
import { ContaForm } from './ContaForm'
import { estadoInicial } from './forms'
import type { Campos } from './forms'
import type { FormState } from '../../_lib/form-state'

const PAPEIS: Array<[PaperTone, string]> = [
  ['WHITE', 'Branco'],
  ['CREAM', 'Creme'],
  ['GRAY', 'Cinza'],
]
const FONTES: Array<[FontPair, string, string]> = [
  ['CLASSIC', 'Clássico', 'Títulos com serifa de livro-caixa.'],
  ['MODERN', 'Moderno', 'Títulos sem serifa, de traço limpo.'],
  ['FRIENDLY', 'Amigável', 'Títulos de cantos redondos.'],
]

export type Imagens = { logo: string | null; symbol: string | null; favicon: string | null; loginImage: string | null }

type Termos = { professionalSingular: string; professionalPlural: string; customerSingular: string; customerPlural: string }

/** Marca da conta: o formulário e a prévia ao vivo lado a lado. As cores e o material trocam a prévia na hora, sem enviar. */
export function MarcaForm({ valores, termos, logoUrl }: { valores: Campos; termos: Termos; logoUrl: string | null }) {
  const [v, setV] = useState({
    displayName: valores.displayName ?? '',
    primary: valores.primary ?? '',
    accent: valores.accent ?? '',
    material: (valores.material ?? 'ENAMEL') as CoverMaterial,
    paper: (valores.paper ?? 'WHITE') as PaperTone,
    fontPair: (valores.fontPair ?? 'CLASSIC') as FontPair,
    loginMessage: valores.loginMessage ?? '',
  })
  const set = <K extends keyof typeof v>(k: K, valor: (typeof v)[K]) => setV((p) => ({ ...p, [k]: valor }))
  const { warnings } = previewTheme(v)
  const avisoPrincipal = warnings.includes('text_adjusted') ? THEME_WARNING_TEXT.text_adjusted : undefined
  const avisoDestaque = warnings.includes('accent_adjusted') ? THEME_WARNING_TEXT.accent_adjusted : undefined

  return (
    <div className="af-wizard__layout af-wizard__layout--aside">
      <div className="af-wizard__main">
        <ContaForm action={salvarMarca} initial={estadoInicial(valores)} submit="Salvar marca">
          {({ fields }) => (
            <>
              <div className="af-wizard__grid">
                <Field label="Nome de exibição" hint="Aparece na capa do painel e nos e-mails." error={fields.displayName}>
                  <Input name="displayName" value={v.displayName} onChange={(e) => set('displayName', e.target.value)} autoComplete="off" />
                </Field>
                <span />
                <ColorField label="Cor principal" name="primary" value={v.primary} onChange={(c) => set('primary', c)} {...(fields.primary ? { error: fields.primary } : {})} {...(avisoPrincipal ? { warning: avisoPrincipal } : {})} />
                <ColorField label="Cor de destaque" name="accent" value={v.accent} onChange={(c) => set('accent', c)} {...(fields.accent ? { error: fields.accent } : {})} {...(avisoDestaque ? { warning: avisoDestaque } : {})} />
              </div>
              <MaterialPicker name="material" value={v.material} onChange={(m) => set('material', m)} primary={v.primary} accent={v.accent} paper={v.paper} fontPair={v.fontPair} />
              <div className="af-wizard__grid">
                <Field label="Tom do papel" error={fields.paper}>
                  <Select name="paper" value={v.paper} onChange={(e) => set('paper', e.target.value as PaperTone)}>
                    {PAPEIS.map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Par de fontes" hint={FONTES.find(([f]) => f === v.fontPair)?.[2]} error={fields.fontPair}>
                  <Select name="fontPair" value={v.fontPair} onChange={(e) => set('fontPair', e.target.value as FontPair)}>
                    {FONTES.map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Mensagem da tela de entrada" hint="Uma frase de boas-vindas acima do formulário de entrada. Pode ficar em branco." error={fields.loginMessage}>
                <Textarea name="loginMessage" value={v.loginMessage} onChange={(e) => set('loginMessage', e.target.value)} rows={2} />
              </Field>
            </>
          )}
        </ContaForm>
      </div>
      <aside aria-label="Prévia ao vivo da marca" className="af-wizard__aside">
        <BrandPreview businessName={v.displayName} brand={{ ...v, logoUrl }} terms={{ ...termos }} />
      </aside>
    </div>
  )
}

const SLOTS: ReadonlyArray<{ slot: keyof Imagens; label: string; hint: string }> = [
  { slot: 'logo', label: 'Logo', hint: 'Aparece em baixo-relevo na capa do painel.' },
  { slot: 'symbol', label: 'Símbolo', hint: 'A marca em tamanho pequeno, para o menu recolhido.' },
  { slot: 'favicon', label: 'Favicon', hint: 'O ícone da aba do navegador. Use uma imagem quadrada.' },
  { slot: 'loginImage', label: 'Imagem de entrada', hint: 'A imagem da tela de entrada da conta.' },
]

type EstadoImagem = FormState<{ businessId: string; slot: string; intent: string; file: File | null }>

function Slot({ businessId, slot, label, hint, url }: { businessId: string; slot: keyof Imagens; label: string; hint: string; url: string | null }) {
  const inicial: EstadoImagem = { ok: false, message: null, fields: {}, values: { businessId, slot, intent: '', file: null } }
  const [state, action, pending] = useActionState(trocarImagem, inicial)
  const erro = state.fields[slot] ?? state.fields.slot ?? state.message ?? undefined
  return (
    <form action={action} className="af-imgslot">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="slot" value={slot} />
      <div className="af-imgslot__view">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem da conta servida pela rota /arquivos
          <img src={url} alt={`${label} atual`} className="af-imgslot__img" />
        ) : (
          <span className="af-imgslot__empty">Sem imagem</span>
        )}
      </div>
      <div className="af-imgslot__body">
        <Field label={label} hint={`${hint} JPEG, PNG ou WebP, até 8 MB.`} error={erro}>
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="af-input" />
        </Field>
        <div className="af-imgslot__actions">
          <Button type="submit" name="intent" value="send" variant="primary" size="sm" loading={pending}>
            Enviar {label.toLowerCase()}
          </Button>
          {url ? (
            <Button type="submit" name="intent" value="remove" size="sm" disabled={pending}>
              Remover {label.toLowerCase()}
            </Button>
          ) : null}
        </div>
        {state.ok && state.message ? (
          <p role="status" className="af-acctform__ok">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}

/** Uma ficha por imagem da marca: prévia da atual, enviar e remover. O erro do domínio aparece ao lado do slot. */
export function ImagensForm({ businessId, imagens }: { businessId: string; imagens: Imagens }) {
  return (
    <div className="af-imgslots">
      {SLOTS.map((s) => (
        <Slot key={s.slot} businessId={businessId} slot={s.slot} label={s.label} hint={s.hint} url={imagens[s.slot]} />
      ))}
    </div>
  )
}
