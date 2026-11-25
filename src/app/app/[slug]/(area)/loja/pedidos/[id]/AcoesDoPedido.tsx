'use client'
import { useState } from 'react'
import { CreditCard } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import { ClienteForm } from '../../../../_lib/ClienteForm'
import { ESTADO_VAZIO } from '../../../../_lib/estado'
import { cancelarPedido, pagarPedido } from '../actions'

/** "Pagar agora" (de volta ao Mercado Pago) e "Cancelar pedido" (com confirmação), conforme o que o pedido permite. */
export function AcoesDoPedido({ slug, id, canPay, canCancel }: { slug: string; id: string; canPay: boolean; canCancel: boolean }) {
  const [confirmando, setConfirmando] = useState(false)
  if (!canPay && !canCancel) return null
  return (
    <div className="af-cl-order-actions">
      {canPay ? <ClienteForm action={pagarPedido} slug={slug} hidden={{ id }} submit="Pagar agora" submitIcon={<CreditCard size={18} />} /> : null}
      {canCancel ? (
        <>
          <Button variant="ghost" size="lg" onClick={() => setConfirmando(true)}>
            Cancelar pedido
          </Button>
          <ConfirmDialog
            open={confirmando}
            onClose={() => setConfirmando(false)}
            title="Cancelar pedido"
            description="Cancelar este pedido? Os produtos voltam para a loja e você não paga nada."
            action={cancelarPedido.bind(null, slug)}
            initialState={ESTADO_VAZIO}
            confirmLabel="Cancelar pedido"
            hidden={{ id }}
          />
        </>
      ) : null}
    </div>
  )
}
