'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, ShieldX } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import type { EstadoPainel } from '../_lib/PainelForm'
import { anonimizarCliente, arquivarCliente, restaurarCliente } from './actions'

const VAZIO = { ok: false, message: null, fields: {} }

/** Ações delicadas da ficha: arquivar e anonimizar, cada uma com o que acontece dito antes. */
export function Cuidados({
  id,
  name,
  archived,
}: {
  id: string
  name: string
  archived: boolean
}) {
  const router = useRouter()
  const [dialogo, setDialogo] = useState<'arquivar' | 'anonimizar' | null>(null)
  const fechar = () => setDialogo(null)
  return (
    <div className="af-careful">
      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">{archived ? 'Cadastro arquivado' : 'Arquivar cadastro'}</span>
          <span className="af-careful__help">
            {archived
              ? 'O cadastro está fora da lista e não faz novos agendamentos. Restaure para voltar a usá-lo.'
              : `Tira ${name} da lista e impede novos agendamentos. O histórico fica guardado. Antes, cancele os agendamentos futuros.`}
          </span>
        </div>
        {archived ? (
          <AcaoDeLinha action={restaurarCliente} campos={{ id }} icon={<ArchiveRestore size={16} />} size="md">
            Restaurar cadastro
          </AcaoDeLinha>
        ) : (
          <Button variant="secondary" icon={<Archive size={16} />} onClick={() => setDialogo('arquivar')}>
            Arquivar cadastro
          </Button>
        )}
      </div>

      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">Apagar dados pessoais</span>
          <span className="af-careful__help">
            Apaga nome, telefone, e-mail, foto e observações deste cadastro. Cancela os agendamentos futuros. Os atendimentos passados continuam, sem identificar a pessoa. Não tem volta.
          </span>
        </div>
        <Button variant="danger" icon={<ShieldX size={16} />} onClick={() => setDialogo('anonimizar')}>
          Anonimizar cadastro
        </Button>
      </div>

      <ConfirmDialog
        open={dialogo === 'arquivar'}
        onClose={fechar}
        title={`Arquivar ${name}?`}
        description="O cadastro sai da lista e o acesso ao app é encerrado. O histórico de atendimentos fica guardado, e você pode restaurar o cadastro depois."
        confirmLabel="Arquivar cadastro"
        initialState={VAZIO}
        hidden={{ id }}
        action={async (prev, fd) => {
          const r = await arquivarCliente(prev as EstadoPainel, fd)
          if (r.ok) fechar()
          return r
        }}
      />
      <ConfirmDialog
        open={dialogo === 'anonimizar'}
        onClose={fechar}
        title={`Anonimizar ${name}?`}
        description="Isto apaga para sempre o nome, o telefone, o e-mail, a foto, as observações e o acesso ao app, e cancela os agendamentos futuros sem avisar a pessoa. Os atendimentos já feitos continuam, sem identificar ninguém."
        confirmLabel="Anonimizar cadastro"
        targetName={name}
        initialState={VAZIO}
        hidden={{ id }}
        action={async (prev, fd) => {
          const r = await anonimizarCliente(prev as EstadoPainel, fd)
          if (r.ok) router.push('/painel/clientes')
          return r
        }}
      />
    </div>
  )
}
