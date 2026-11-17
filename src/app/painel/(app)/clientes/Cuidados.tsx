'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, KeyRound, ShieldX } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import type { EstadoPainel } from '../_lib/PainelForm'
import { anonimizarCliente, arquivarCliente, enviarRedefinicaoCliente, restaurarCliente } from './actions'

const VAZIO = { ok: false, message: null, fields: {} }

/** Ações delicadas da ficha: redefinir a senha do app, arquivar e anonimizar, cada uma com o que acontece dito antes. */
export function Cuidados({
  id,
  name,
  singular,
  archived,
  hasAppAccess,
  suporte,
}: {
  id: string
  name: string
  singular: string
  archived: boolean
  hasAppAccess: boolean
  suporte: boolean
}) {
  const router = useRouter()
  const [dialogo, setDialogo] = useState<'arquivar' | 'anonimizar' | null>(null)
  const fechar = () => setDialogo(null)
  const sing = singular.toLowerCase()
  return (
    <div className="af-careful">
      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">Senha do app</span>
          <span className="af-careful__help">
            {suporte
              ? 'O suporte não envia redefinição de senha. Peça a um dono ou gerente da conta.'
              : hasAppAccess
                ? `Envia ao e-mail d${sing === 'tutor' ? 'o' : 'o'} ${sing} um código para escolher uma senha nova.`
                : `Este ${sing} ainda não tem conta no app. Quando criar uma, você poderá mandar a redefinição daqui.`}
          </span>
        </div>
        {hasAppAccess && !suporte && !archived ? (
          <AcaoDeLinha action={enviarRedefinicaoCliente} campos={{ id }} icon={<KeyRound size={16} />} size="md" showOk>
            Enviar redefinição de senha
          </AcaoDeLinha>
        ) : null}
      </div>

      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">{archived ? 'Cadastro arquivado' : 'Arquivar cadastro'}</span>
          <span className="af-careful__help">
            {archived
              ? 'O cadastro está fora da lista e não faz novos agendamentos. Restaure para voltar a usá-lo.'
              : `Tira ${name} da lista e encerra o acesso ao app. O histórico fica guardado. Antes, cancele os agendamentos futuros.`}
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
            Apaga nome, telefone, e-mail, foto, observações e acesso ao app. Cancela os agendamentos futuros. Os atendimentos passados continuam, sem identificar a pessoa. Não tem volta.
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
          if (r.ok) router.push('/clientes')
          return r
        }}
      />
    </div>
  )
}
