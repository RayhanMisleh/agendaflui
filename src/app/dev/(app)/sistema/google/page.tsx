import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { getGoogleSettings } from '@/server/domain/platform/google-settings'
import { formatDateTime } from '@/server/time'
import { DevFrame } from '../../DevFrame'
import { HorariosNota } from '../../_lib/HorariosNota'
import { SistemaTabs } from '../SistemaTabs'
import { GoogleForm } from './GoogleForm'
import { removerGoogle, salvarGoogle } from './actions'

export const metadata: Metadata = { title: 'Google | Agenda Flui' }

export default async function GooglePage() {
  const admin = await requirePlatformAdmin()
  const v = await getGoogleSettings(admin)
  return (
    <DevFrame admin={admin} title="Google">
      <SistemaTabs />
      <HorariosNota />
      <GoogleForm
        dados={{
          configured: v.configured,
          clientId: v.clientId,
          secretLast4: v.secretLast4,
          savedLabel: v.updatedAt === null ? null : formatDateTime(v.updatedAt, 'America/Sao_Paulo'),
          redirectUrl: v.redirectUrl,
          version: v.version,
        }}
        acoes={{ salvar: salvarGoogle, remover: removerGoogle }}
      />
    </DevFrame>
  )
}
