import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { Showcase } from './Showcase'
import { ControlRoom } from './control-room'

export const metadata: Metadata = { title: 'Vitrine de componentes | AgendaFlui' }

// A vitrine é ferramenta da plataforma: só admin entra.
export default async function VitrinePage() {
  await requirePlatformAdmin()
  return (
    <div className="vt-page">
      <a className="af-skip" href="#vitrine">
        Pular para o conteúdo
      </a>
      <main id="vitrine" tabIndex={-1} className="vt-wrap">
        <header className="vt-intro">
          <h1 className="vt-h1">Vitrine de componentes</h1>
          <p className="vt-lead">
            Mude a marca à esquerda e veja a agenda de balcão se transformar ao lado. Aprove o visual aqui antes de as telas
            serem produzidas.
          </p>
        </header>
        <Showcase />
        <section aria-labelledby="vt-mesa" className="vt-mesa">
          <h2 id="vt-mesa" className="vt-h2 vt-h2--page">
            Mesa de controle
          </h2>
          <p className="vt-lead">O mesmo conjunto de componentes em metal, para quem administra o AgendaFlui.</p>
          <ControlRoom />
        </section>
      </main>
    </div>
  )
}
