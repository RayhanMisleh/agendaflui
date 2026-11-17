'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar } from '../components/Avatar'
import { Dialog } from '../components/Dialog'
import { UserPlate } from './UserPlate'
import type { ShellUser } from './UserPlate'

/** Menu da conta na barra do topo do celular: abre uma folha com quem você é e as ações da conta (Sair, Trocar de conta). */
export function AccountMenu({ user, children }: { user: ShellUser; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="af-shell__accountbtn" aria-label="Menu da conta" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Sua conta">
        <div className="af-more__user">
          <UserPlate user={user} />
        </div>
        {children ? <div className="af-shell__account af-shell__account--sheet">{children}</div> : null}
      </Dialog>
    </>
  )
}
