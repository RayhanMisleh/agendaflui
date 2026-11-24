'use client'
import { useState } from 'react'
import { Gift, SlidersHorizontal } from 'lucide-react'
import { Button, Checkbox, Field, Input, Select, Sheet } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { PainelForm } from '../../_lib/PainelForm'
import { ajustarPontos, resgatarNoBalcao } from '../../fidelidade/actions'

export type PremioOpcao = { id: string; name: string; costPoints: number }

/** Os dois botões da ficha para quem tem `manage_loyalty`: ajustar os pontos e resgatar um prêmio no balcão. */
export function PontosAcoes({ customerId, nome, premios, pontos, ponto }: { customerId: string; nome: string; premios: PremioOpcao[]; pontos: string; ponto: string }) {
  const [folha, setFolha] = useState<'ajuste' | 'balcao' | null>(null)
  // Um identificador por abertura da folha: reenviar o mesmo formulário (duplo clique, reenvio do POST) não ajusta duas vezes.
  const [pedido, setPedido] = useState('')
  const [premioId, setPremioId] = useState('')
  const custoMostrado = premios.find((p) => p.id === premioId)?.costPoints
  const fechar = () => setFolha(null)
  return (
    <>
      <div className="af-rowactions">
        <Button variant="secondary" icon={<SlidersHorizontal size={18} />} onClick={() => {
            setPedido(crypto.randomUUID())
            setFolha('ajuste')
          }}>
          Ajustar {pontos.toLowerCase()}
        </Button>
        <Button variant="secondary" icon={<Gift size={18} />} onClick={() => {
            setPedido(crypto.randomUUID())
            setPremioId('')
            setFolha('balcao')
          }}>
          Resgatar no balcão
        </Button>
      </div>
      <Sheet open={folha === 'ajuste'} onClose={fechar} title={`Ajustar ${pontos.toLowerCase()} de ${nome}`}>
        {folha === 'ajuste' ? (
          <PainelForm action={ajustarPontos} submit="Registrar ajuste" onDone={fechar} labels={{ points: 'Valor', reason: 'Motivo' }} anchors={{ points: 'ajuste-valor', reason: 'ajuste-motivo' }}>
            {(state) => (
              <>
                <input type="hidden" name="customerId" value={customerId} />
                <input type="hidden" name="requestId" value={pedido} />
                <Field label="Valor" hint={`Use sinal: 50 soma 50 ${pontos.toLowerCase()} e -20 tira 20.`} error={state.fields.points}>
                  <Input id="ajuste-valor" name="points" inputMode="numeric" defaultValue={state.values.points ?? ''} autoComplete="off" required />
                </Field>
                <Field label="Motivo" hint="Fica no extrato para a equipe." error={state.fields.reason}>
                  <Input id="ajuste-motivo" name="reason" defaultValue={state.values.reason ?? ''} maxLength={200} autoComplete="off" required />
                </Field>
              </>
            )}
          </PainelForm>
        ) : null}
      </Sheet>
      <Sheet open={folha === 'balcao'} onClose={fechar} title={`Resgatar para ${nome}`}>
        {folha === 'balcao' ? (
          <PainelForm action={resgatarNoBalcao} submit="Registrar resgate" onDone={fechar} labels={{ prizeId: 'Prêmio' }} anchors={{ prizeId: 'balcao-premio' }}>
            {(state) => (
              <>
                <input type="hidden" name="customerId" value={customerId} />
                <input type="hidden" name="requestId" value={pedido} />
                <input type="hidden" name="expectedCostPoints" value={custoMostrado === undefined ? '' : String(custoMostrado)} />
                <Field label="Prêmio" error={state.fields.prizeId}>
                  <Select id="balcao-premio" name="prizeId" value={premioId} onChange={(e) => setPremioId(e.target.value)}>
                    <option value="">Escolha um prêmio</option>
                    {premios.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatInt(p.costPoints)} {(p.costPoints === 1 ? ponto : pontos).toLowerCase()})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Checkbox name="deliverNow" label="Entregar agora" defaultChecked={state.values.deliverNow === 'on'} />
              </>
            )}
          </PainelForm>
        ) : null}
      </Sheet>
    </>
  )
}
