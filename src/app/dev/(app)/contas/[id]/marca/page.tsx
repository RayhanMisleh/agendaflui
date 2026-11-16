import type { Metadata } from 'next'
import { Paper } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { carregarConta } from '../_data'
import { ImagensForm, MarcaForm } from '../BrandForm'

export const metadata: Metadata = { title: 'Marca da conta | AgendaFlui' }

export default async function MarcaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const { brand, terms } = await getCustomization(admin, conta.id)
  return (
    <>
      <Paper raised={1} className="af-listpanel">
        <h2 className="af-section__title">Cores, material e fonte</h2>
        <MarcaForm
          valores={{
            businessId: conta.id,
            version: String(brand.version),
            displayName: brand.displayName,
            primary: brand.primary,
            accent: brand.accent,
            material: brand.material,
            paper: brand.paper,
            fontPair: brand.fontPair,
            loginMessage: brand.loginMessage ?? '',
          }}
          termos={terms}
          logoUrl={brand.logoUrl}
        />
      </Paper>
      <Paper raised={1} className="af-listpanel">
        <h2 className="af-section__title">Imagens</h2>
        <ImagensForm
          businessId={conta.id}
          imagens={{ logo: brand.logoUrl, symbol: brand.symbolUrl, favicon: brand.faviconUrl, loginImage: brand.loginImageUrl }}
        />
      </Paper>
    </>
  )
}
