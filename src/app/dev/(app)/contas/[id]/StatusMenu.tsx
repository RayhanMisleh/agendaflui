'use client'
import { useState } from 'react'
import { Archive, Pause, Play } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import type { BusinessStatusKey } from '@/ui/components'
import { estadoInicial } from './forms'
import type { AcaoConta } from './forms'

/** As ações de situação, já com o id da conta ligado no servidor pela página. */
export type AcoesSituacao = { suspender: AcaoConta; reativar: AcaoConta; arquivar: AcaoConta }

type Acao = { id: keyof AcoesSituacao; label: string; icon: React.ReactNode; title: string; description: string; danger: boolean }

const ACOES: Record<keyof AcoesSituacao, Acao> = {
  suspender: {
    id: 'suspender',
    label: 'Suspender',
    icon: <Pause size={16} />,
    title: 'Suspender a conta',
    description: 'Ninguém entra na conta enquanto ela estiver suspensa: as sessões abertas caem e a loja para de responder. Os dados ficam guardados.',
    danger: true,
  },
  reativar: {
    id: 'reativar',
    label: 'Reativar',
    icon: <Play size={16} />,
    title: 'Reativar a conta',
    description: 'A conta volta a funcionar e a equipe consegue entrar de novo.',
    danger: false,
  },
  arquivar: {
    id: 'arquivar',
    label: 'Arquivar',
    icon: <Archive size={16} />,
    title: 'Arquivar a conta',
    description: 'A conta sai das listas e dos números da plataforma, e ninguém entra nela. Dá para reativar depois.',
    danger: true,
  },
}

const POR_SITUACAO: Record<BusinessStatusKey, Array<keyof AcoesSituacao>> = {
  ACTIVE: ['suspender', 'arquivar'],
  SUSPENDED: ['reativar', 'arquivar'],
  ARCHIVED: ['reativar'],
}

/** Suspender, reativar e arquivar: cada um abre uma confirmação que exige digitar o nome da conta. */
export function StatusMenu({ acoes, name, status }: { acoes: AcoesSituacao; name: string; status: BusinessStatusKey }) {
  const [aberta, setAberta] = useState<keyof AcoesSituacao | null>(null)
  return (
    <div className="af-statusmenu" role="group" aria-label="Situação da conta">
      {POR_SITUACAO[status].map((id) => {
        const a = ACOES[id]
        if (!a) return null
        return (
          <span key={id}>
            <Button size="sm" variant={a.danger ? 'danger' : 'secondary'} icon={a.icon} onClick={() => setAberta(id)}>
              {a.label}
            </Button>
            <ConfirmDialog
              open={aberta === id}
              onClose={() => setAberta(null)}
              title={a.title}
              description={a.description}
              action={acoes[id]}
              initialState={estadoInicial({ confirmName: '' })}
              confirmLabel={a.label}
              targetName={name}
            />
          </span>
        )
      })}
    </div>
  )
}
