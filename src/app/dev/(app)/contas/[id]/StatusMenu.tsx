'use client'
import { useState } from 'react'
import { Archive, Pause, Play } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import type { BusinessStatusKey } from '@/ui/components'
import { arquivarConta, reativarConta, suspenderConta } from './actions'
import { estadoInicial } from './forms'

type Acao = { id: string; label: string; icon: React.ReactNode; action: typeof suspenderConta; title: string; description: string; danger: boolean }

const ACOES: Record<string, Acao> = {
  suspender: {
    id: 'suspender',
    label: 'Suspender',
    icon: <Pause size={16} />,
    action: suspenderConta,
    title: 'Suspender a conta',
    description: 'Ninguém entra na conta enquanto ela estiver suspensa: as sessões abertas caem e o aplicativo para de responder. Os dados ficam guardados.',
    danger: true,
  },
  reativar: {
    id: 'reativar',
    label: 'Reativar',
    icon: <Play size={16} />,
    action: reativarConta,
    title: 'Reativar a conta',
    description: 'A conta volta a funcionar e a equipe consegue entrar de novo.',
    danger: false,
  },
  arquivar: {
    id: 'arquivar',
    label: 'Arquivar',
    icon: <Archive size={16} />,
    action: arquivarConta,
    title: 'Arquivar a conta',
    description: 'A conta sai das listas e dos números da plataforma, e ninguém entra nela. Dá para reativar depois.',
    danger: true,
  },
}

const POR_SITUACAO: Record<BusinessStatusKey, string[]> = {
  ACTIVE: ['suspender', 'arquivar'],
  SUSPENDED: ['reativar', 'arquivar'],
  ARCHIVED: ['reativar'],
}

/** Suspender, reativar e arquivar: cada um abre uma confirmação que exige digitar o nome da conta. */
export function StatusMenu({ businessId, name, status }: { businessId: string; name: string; status: BusinessStatusKey }) {
  const [aberta, setAberta] = useState<string | null>(null)
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
              action={a.action}
              initialState={estadoInicial({ businessId, confirmName: '' })}
              confirmLabel={a.label}
              targetName={name}
              hidden={{ businessId }}
            />
          </span>
        )
      })}
    </div>
  )
}
