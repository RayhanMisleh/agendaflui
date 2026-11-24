import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { um } from '@/app/_lib/params'
import { requireCustomer } from '@/server/auth/guards'
import { listMyPets, MAX_ACTIVE_PETS } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { todayIn } from '@/server/time'
import { safeReturnPath } from '@/shared/return-path'
import { EmptyIllustration } from '@/ui/components'
import { ClienteFrame } from '../_lib/ClienteFrame'
import { metadataDaLoja } from '../_lib/loja'
import { QuizPet } from './QuizPet'
import { salvarPetDoQuiz } from './actions'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Novo pet')
}

/**
 * O quiz do pet. Serve às boas-vindas (cliente novo de loja de pet shop, sem pet) e a "Adicionar pet" (`?novo=1`, sem a tela
 * de boas-vindas). Loja de outro ramo não tem pets: volta à página da loja.
 */
export default async function BoasVindasPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const volta = safeReturnPath(slug, um(sp.volta))
  const visit = await requireCustomer(slug, volta ? `/${slug}/boas-vindas?volta=${encodeURIComponent(volta)}` : `/${slug}/boas-vindas`)
  const nicho = await getNicheSettings(visit.ctx)
  if (nicho.niche === null) return redirect(`/${slug}`)
  const pets = await listMyPets(visit.ctx)
  const cheio = pets.length >= MAX_ACTIVE_PETS
  const welcome = um(sp.novo) === '' && pets.length === 0
  const primeiroNome = visit.person.name.trim().split(/\s+/)[0] ?? ''
  return (
    <ClienteFrame visit={visit} title={welcome ? 'Boas-vindas' : 'Novo pet'} hideTitle immersive>
      {cheio ? (
        <section className="af-cl-state af-cl-state--inline" aria-labelledby="pets-cheio">
          <span className="af-cl-state__art">
            <EmptyIllustration name="pets" size={96} />
          </span>
          <h2 id="pets-cheio" className="af-cl-state__title">
            Você já tem {MAX_ACTIVE_PETS} pets ativos. Arquive algum em Meus pets.
          </h2>
          <Link href={`/${slug}/pets`} className="af-button af-button--primary af-button--lg">
            <span className="af-button__label">Ver meus pets</span>
          </Link>
        </section>
      ) : (
        <QuizPet
          slug={slug}
          servesCats={nicho.options.servesCats}
          today={todayIn(visit.ctx.timeZone, visit.ctx.clock())}
          firstName={primeiroNome === '' ? null : primeiroNome}
          welcome={welcome}
          back={volta}
          salvar={salvarPetDoQuiz.bind(null, slug)}
        />
      )}
    </ClienteFrame>
  )
}
