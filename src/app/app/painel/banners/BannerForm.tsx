'use client'
import { Checkbox, Field, Input } from '@/ui/components'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { criarBanner, salvarBanner } from './actions'

const ROTULOS = { title: 'Título', linkUrl: 'Link', startsOn: 'Início', endsOn: 'Fim', active: 'Situação' }
const ANCORAS = { title: 'banner-titulo', linkUrl: 'banner-link', startsOn: 'banner-inicio', endsOn: 'banner-fim', active: 'banner-ativo' }

export type BannerDados = { id: string; title: string; linkUrl: string; startsOn: string; endsOn: string; active: boolean; temImagem: boolean }

/** O formulário do banner: cria (sem `banner`) ou edita. Quem cria vai para a ficha, onde envia a imagem. */
export function BannerForm({ banner }: { banner: BannerDados | null }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: banner ? { id: banner.id, title: banner.title, linkUrl: banner.linkUrl, startsOn: banner.startsOn, endsOn: banner.endsOn, active: banner.active ? 'on' : '' } : {},
  }
  return (
    <PainelForm action={banner ? salvarBanner : criarBanner} initial={inicial} submit={banner ? 'Salvar banner' : 'Criar banner'} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => {
        const v = state.values
        return (
          <>
            {banner ? <input type="hidden" name="id" value={banner.id} /> : null}
            <Field label="Título" hint="Só a equipe vê. Ajuda a achar o banner na lista." error={state.fields.title}>
              <Input id="banner-titulo" name="title" defaultValue={v.title ?? ''} maxLength={80} autoComplete="off" required />
            </Field>
            <Field label="Link" hint="Opcional. Comece com https:// ou use um caminho da loja, como /servicos." error={state.fields.linkUrl}>
              <Input id="banner-link" name="linkUrl" defaultValue={v.linkUrl ?? ''} maxLength={500} autoComplete="off" inputMode="url" />
            </Field>
            <div className="af-formgrid">
              <Field label="Início" hint="Opcional. Vale a data da conta." error={state.fields.startsOn}>
                <Input id="banner-inicio" name="startsOn" type="date" defaultValue={v.startsOn ?? ''} />
              </Field>
              <Field label="Fim" hint="Opcional. O último dia ainda conta." error={state.fields.endsOn}>
                <Input id="banner-fim" name="endsOn" type="date" defaultValue={v.endsOn ?? ''} />
              </Field>
            </div>
            {banner ? (
              <div>
                {banner.temImagem ? null : <p className="af-field__hint">Envie a imagem para poder ativar o banner.</p>}
                <Checkbox id="banner-ativo" name="active" label="Ativo para clientes" defaultChecked={v.active === 'on'} />
                {state.fields.active ? <p className="af-field__error">{state.fields.active}</p> : null}
              </div>
            ) : null}
          </>
        )
      }}
    </PainelForm>
  )
}
