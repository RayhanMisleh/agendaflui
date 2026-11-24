'use client'
import { useState } from 'react'
import { Ban, FlaskConical, RotateCcw } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input } from '@/ui/components'
import { AcaoDeLinha } from '../../_lib/AcaoDeLinha'
import { PainelForm } from '../../_lib/PainelForm'
import type { EstadoPainel } from '../../_lib/PainelForm'
import { avancarEntrega, cancelarPedido, simularPagamento } from './actions'

const SEM_ESTADO = { ok: false, message: null, fields: {} }

/** Ações do pedido: próximo passo da entrega, voltar um passo, cancelar e (só no ambiente de teste) simular o pagamento. */
export function PedidoAcoes({
  id,
  numero,
  next,
  back,
  canCancel,
  cancelHelp,
  simulate,
}: {
  id: string
  numero: string
  next: { to: string; label: string; askTracking: boolean } | null
  back: { to: string; label: string } | null
  canCancel: boolean
  cancelHelp: string
  /** Só no ambiente de teste (modo falso): os textos do bloco "Simular pagamento aprovado". */
  simulate: { aviso: string; texto: string; label: string } | null
}) {
  const [cancelando, setCancelando] = useState(false)
  return (
    <div className="af-orderactions">
      {next !== null ? (
        next.askTracking ? (
          <PainelForm action={avancarEntrega} submit={next.label} labels={{ trackingCode: 'Código de rastreio' }} anchors={{ trackingCode: `rastreio-${id}` }}>
            {(state) => (
              <>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="to" value={next.to} />
                <Field label="Código de rastreio" hint="Opcional. O cliente vê o código quando o pedido sai." error={state.fields.trackingCode}>
                  <Input id={`rastreio-${id}`} name="trackingCode" maxLength={40} autoComplete="off" defaultValue={state.values.trackingCode ?? ''} />
                </Field>
              </>
            )}
          </PainelForm>
        ) : (
          <AcaoDeLinha action={avancarEntrega} campos={{ id, to: next.to }} variant="primary" size="md" showOk>
            {next.label}
          </AcaoDeLinha>
        )
      ) : null}
      {back !== null ? (
        <AcaoDeLinha action={avancarEntrega} campos={{ id, to: back.to }} variant="secondary" icon={<RotateCcw size={16} />}>
          {back.label}
        </AcaoDeLinha>
      ) : null}
      {canCancel ? (
        <>
          <Button variant="ghost" icon={<Ban size={16} />} onClick={() => setCancelando(true)} aria-label={`Cancelar o pedido ${numero}`}>
            Cancelar pedido
          </Button>
          <ConfirmDialog
            open={cancelando}
            onClose={() => setCancelando(false)}
            title={`Cancelar o pedido ${numero}?`}
            description={cancelHelp}
            confirmLabel="Cancelar pedido"
            initialState={SEM_ESTADO}
            hidden={{ id }}
            action={async (prev, fd) => {
              const r = await cancelarPedido(prev as EstadoPainel, fd)
              if (r.ok) setCancelando(false)
              return r
            }}
          />
        </>
      ) : null}
      {simulate !== null ? (
        <div className="af-orderactions__test" role="note">
          <p>
            <strong>{simulate.aviso}.</strong> {simulate.texto}
          </p>
          <AcaoDeLinha action={simularPagamento} campos={{ id }} variant="secondary" icon={<FlaskConical size={16} />} showOk>
            {simulate.label}
          </AcaoDeLinha>
        </div>
      ) : null}
    </div>
  )
}
