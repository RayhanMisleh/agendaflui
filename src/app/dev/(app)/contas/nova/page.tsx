import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DevFrame } from '../../DevFrame'
import { EMPTY_VALUES } from './fields'
import { Wizard } from './Wizard'

export const metadata: Metadata = { title: 'Nova conta | AgendaFlui' }

export default async function NovaContaPage() {
  const admin = await requirePlatformAdmin()
  return (
    <DevFrame admin={admin} title="Nova conta">
      <Wizard initial={{ ok: false, message: null, fields: {}, values: EMPTY_VALUES }} />
    </DevFrame>
  )
}
