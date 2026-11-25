import { ChoiceCard } from '@/ui/components'
import { ServiceIcon } from '@/ui/service-icon'
import { formatMoney } from '@/ui/format'
import type { Pedido } from '../../../_lib/consulta'
import type { ServicoDoPet } from '../consultas'
import { ConsultaFalhou, ListaCarregando, Passo } from './Passo'

/** Quais serviços? Preço e tempo do porte do pet; vários podem ser marcados e o total corre no pé. */
export function PassoServicos({
  pedido,
  tentar,
  escolhidos,
  petRotulo,
  onAlternar,
}: {
  pedido: Pedido<{ servicos: ServicoDoPet[] }> | null
  tentar: () => void
  escolhidos: string[]
  /** "Cão médio": para a mensagem de vazio. */
  petRotulo: string | null
  onAlternar: (id: string) => void
}) {
  return (
    <Passo id="servicos" title="Quais serviços?" hint="Pode escolher mais de um.">
      {pedido === null ? (
        <ListaCarregando />
      ) : !pedido.ok ? (
        <ConsultaFalhou message={pedido.message} onTentar={tentar} />
      ) : pedido.servicos.length === 0 ? (
        <p className="af-cl-flow__empty" role="status">
          {petRotulo ? `Nenhum serviço para ${petRotulo} agora. Fale com a loja.` : 'Nenhum serviço agora. Fale com a loja.'}
        </p>
      ) : (
        <div className="af-cl-choices" role="group" aria-label="Serviços">
          {pedido.servicos.map((s) => (
            <ChoiceCard
              key={s.id}
              type="checkbox"
              name="servico"
              value={s.id}
              checked={escolhidos.includes(s.id)}
              onChange={() => onAlternar(s.id)}
              title={s.name}
              detail={
                <>
                  <span>
                    {s.durationLabel} · {formatMoney(s.priceCents)}
                  </span>
                  {s.description ? <span className="af-cl-flow__desc">{s.description}</span> : null}
                </>
              }
              disabled={s.locked}
              disabledReason="Só para quem é do Clube"
              media={<ServiceIcon name={s.icon} size={24} />}
            />
          ))}
        </div>
      )}
    </Passo>
  )
}
