import type { Metadata } from 'next'
import { Card } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { carregarConta } from '../_data'
import { salvarMarca } from '../actions'
import { ImagensForm, MarcaForm } from '../BrandForm'

export const metadata: Metadata = { title: 'Marca da conta | Agenda Flui' }

/** O que cada `?imagem=` quer dizer. Só códigos fixos: nenhum texto da URL vai para a tela. */
const IMAGEM: Record<string, { ok: boolean; texto: string }> = {
  ok: { ok: true, texto: 'Imagem salva.' },
  too_large: { ok: false, texto: 'A imagem passa de 8 MB. Envie um arquivo menor.' },
  not_an_image: { ok: false, texto: 'O arquivo não é uma imagem. Envie uma imagem JPEG, PNG ou WebP.' },
  unsupported_format: { ok: false, texto: 'Esse formato de imagem não é aceito. Envie uma imagem JPEG, PNG ou WebP.' },
  too_many_pixels: { ok: false, texto: 'A imagem tem pixels demais (mais de 40 megapixels). Reduza a imagem e envie de novo.' },
  too_small: { ok: false, texto: 'A imagem é pequena demais para este espaço. Envie uma imagem maior.' },
  no_file: { ok: false, texto: 'Escolha uma imagem para enviar.' },
  invalid_slot: { ok: false, texto: 'Escolha onde a imagem vai: logo, símbolo, favicon ou imagem de entrada.' },
  not_found: { ok: false, texto: 'Conta não encontrada. Volte à lista de contas.' },
  refused: { ok: false, texto: 'Não foi possível salvar a imagem. Tente outro arquivo.' },
}

export default async function MarcaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const q = await searchParams
  const bruto = Array.isArray(q.imagem) ? q.imagem[0] : q.imagem
  const aviso = bruto !== undefined && Object.hasOwn(IMAGEM, bruto) ? IMAGEM[bruto] : undefined
  const { admin, conta } = await carregarConta(id)
  const { brand, terms } = await getCustomization(admin, conta.id)
  return (
    <>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Cores e barra lateral</h2>
        <MarcaForm
          action={salvarMarca.bind(null, conta.id)}
          valores={{
            version: String(brand.version),
            displayName: brand.displayName,
            primary: brand.primary,
            accent: brand.accent,
            material: brand.material,
          }}
          termos={terms}
          logoUrl={brand.logoUrl}
        />
      </Card>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Imagens</h2>
        {aviso ? (
          <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-wizard__note'}>
            {aviso.texto}
          </p>
        ) : null}
        <ImagensForm
          businessId={conta.id}
          imagens={{ logo: brand.logoUrl, symbol: brand.symbolUrl, favicon: brand.faviconUrl, loginImage: brand.loginImageUrl }}
        />
      </Card>
    </>
  )
}
