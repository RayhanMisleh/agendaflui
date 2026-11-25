'use client'
import { useState } from 'react'
import { Gift } from 'lucide-react'
import { Button, Dialog, useToast } from '@/ui/components'
import { pointsText } from '@/shared/terms'
import { ClienteForm } from '../../../_lib/ClienteForm'
import { resgatarPremio } from '../actions'

export type PremioDoCartao = { id: string; name: string; description: string | null; imageUrl: string | null; costPoints: number; stock: number | null }

/** "Últimas 3 unidades" só quando restam poucas; estoque sem limite não aparece. */
export function avisoDeEstoque(stock: number | null): string | null {
  if (stock === null || stock > 3 || stock < 1) return null
  return stock === 1 ? 'Última unidade' : `Últimas ${stock} unidades`
}

/**
 * Um prêmio da vitrine: imagem, nome, custo e o botão. Sem saldo o botão fica desabilitado e diz quantos pontos faltam; com
 * saldo, abre a confirmação ("Seu saldo fica em …"). A chave de idempotência nasce ao abrir a confirmação: o toque duplo
 * resgata uma vez só.
 */
export function PremioCartao({ slug, prize, balance }: { slug: string; prize: PremioDoCartao; balance: number }) {
  const toast = useToast()
  const [aberto, setAberto] = useState(false)
  const [chave, setChave] = useState('')
  const falta = prize.costPoints - balance
  const aviso = avisoDeEstoque(prize.stock)
  return (
    <li className="af-cl-prize">
      <div className="af-cl-prize__media" aria-hidden="true">
        {prize.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta
          <img src={prize.imageUrl} alt="" />
        ) : (
          <Gift size={32} />
        )}
      </div>
      <h3 className="af-cl-prize__name">{prize.name}</h3>
      {prize.description ? <p className="af-cl-prize__desc">{prize.description}</p> : null}
      <p className="af-cl-prize__cost">{pointsText(prize.costPoints)}</p>
      {aviso ? <p className="af-cl-prize__stock">{aviso}</p> : null}
      {falta > 0 ? (
        <Button variant="secondary" disabled>
          Faltam {pointsText(falta)}
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => {
            setChave(crypto.randomUUID())
            setAberto(true)
          }}
        >
          Resgatar
        </Button>
      )}
      <Dialog open={aberto} onClose={() => setAberto(false)} title="Resgatar prêmio">
        <ClienteForm
          action={resgatarPremio}
          slug={slug}
          hidden={{ prizeId: prize.id, expectedCostPoints: String(prize.costPoints), key: chave }}
          submit="Resgatar"
          size="md"
          secondary={
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
          }
          onDone={(estado) => {
            setAberto(false)
            toast({ tone: 'success', message: estado.message ?? 'Resgate pedido. Retire no balcão.' })
          }}
        >
          {() => (
            <p className="af-cl-form__text">
              Resgatar {prize.name} por {pointsText(prize.costPoints)}? Seu saldo fica em {pointsText(Math.max(0, balance - prize.costPoints))}.
            </p>
          )}
        </ClienteForm>
      </Dialog>
    </li>
  )
}
