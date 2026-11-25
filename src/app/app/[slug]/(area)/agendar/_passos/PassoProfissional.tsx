import { Users } from 'lucide-react'
import { Avatar, ChoiceCard } from '@/ui/components'
import type { Pedido } from '../../../_lib/consulta'
import type { ProfissionalDaLista } from '../consultas'
import { ConsultaFalhou, ListaCarregando, Passo } from './Passo'

/** Com quem? "Qualquer um" vem primeiro (mais horários livres); depois cada profissional que faz os serviços. */
export function PassoProfissional({
  pedido,
  tentar,
  escolhido,
  decidido,
  onEscolher,
}: {
  pedido: Pedido<{ profissionais: ProfissionalDaLista[] }> | null
  tentar: () => void
  escolhido: string | null
  decidido: boolean
  onEscolher: (id: string | null) => void
}) {
  return (
    <Passo id="profissional" title="Com quem?">
      {pedido === null ? (
        <ListaCarregando />
      ) : !pedido.ok ? (
        <ConsultaFalhou message={pedido.message} onTentar={tentar} />
      ) : pedido.profissionais.length === 0 ? (
        <p className="af-cl-flow__empty" role="status">
          Nenhum profissional faz esses serviços agora. Fale com a loja.
        </p>
      ) : (
        <div className="af-cl-choices" role="radiogroup" aria-label="Profissional">
          <ChoiceCard
            type="radio"
            name="profissional"
            value=""
            checked={decidido && escolhido === null}
            onChange={() => onEscolher(null)}
            title="Qualquer um"
            detail="Mais horários livres"
            media={
              <span className="af-cl-flow__any">
                <Users size={22} aria-hidden="true" />
              </span>
            }
          />
          {pedido.profissionais.map((p) => (
            <ChoiceCard
              key={p.id}
              type="radio"
              name="profissional"
              value={p.id}
              checked={escolhido === p.id}
              onChange={() => onEscolher(p.id)}
              title={p.name}
              media={<Avatar name={p.name} src={p.avatarUrl} size="md" />}
            />
          ))}
        </div>
      )}
    </Passo>
  )
}
