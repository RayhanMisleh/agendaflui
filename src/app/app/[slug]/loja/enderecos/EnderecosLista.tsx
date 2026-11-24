'use client'
import { useState } from 'react'
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Sheet, useToast } from '@/ui/components'
import { ESTADO_VAZIO } from '../../_lib/estado'
import { apagarEndereco } from '../actions'
import { EnderecoForm, type EnderecoDoForm } from './EnderecoForm'

/** Os endereços do cliente: o padrão marcado, editar e apagar (com confirmação) e "Novo endereço" numa folha. */
export function EnderecosLista({ slug, enderecos, nomeInicial }: { slug: string; enderecos: EnderecoDoForm[]; nomeInicial: string }) {
  const toast = useToast()
  const [editando, setEditando] = useState<EnderecoDoForm | 'novo' | null>(null)
  const [apagando, setApagando] = useState<EnderecoDoForm | null>(null)
  return (
    <div className="af-cl-addresses">
      {enderecos.length === 0 ? (
        <div className="af-cl-state af-cl-state--inline">
          <span className="af-cl-state__art">
            <MapPin size={48} aria-hidden="true" />
          </span>
          <p className="af-cl-state__title">Nenhum endereço salvo</p>
          <p className="af-cl-state__text">Salve um endereço para receber seus pedidos em casa.</p>
        </div>
      ) : (
        <ul className="af-cl-address-list">
          {enderecos.map((e) => (
            <li key={e.id} className="af-cl-address">
              <div className="af-cl-address__main">
                <p className="af-cl-address__title">
                  {e.label ?? e.recipientName}
                  {e.isDefault ? <span className="af-cl-pill">Padrão</span> : null}
                </p>
                <p className="af-cl-address__text">
                  {e.street}, {e.number}
                  {e.complement ? ` · ${e.complement}` : ''}
                  <br />
                  {e.district} · {e.city} - {e.state} · CEP {e.postalCode}
                </p>
              </div>
              <div className="af-cl-address__actions">
                <Button variant="ghost" size="sm" icon={<Pencil size={16} />} onClick={() => setEditando(e)} aria-label={`Editar ${e.label ?? e.recipientName}`}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" icon={<Trash2 size={16} />} onClick={() => setApagando(e)} aria-label={`Apagar ${e.label ?? e.recipientName}`}>
                  Apagar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button variant="primary" size="lg" icon={<Plus size={18} />} onClick={() => setEditando('novo')}>
        Novo endereço
      </Button>
      <Sheet open={editando !== null} onClose={() => setEditando(null)} title={editando === 'novo' || editando === null ? 'Novo endereço' : 'Editar endereço'}>
        {editando !== null ? (
          <EnderecoForm
            key={editando === 'novo' ? 'novo' : editando.id}
            slug={slug}
            endereco={editando === 'novo' ? null : editando}
            nomeInicial={nomeInicial}
            primeiro={enderecos.length === 0 && editando === 'novo'}
            onDone={() => {
              setEditando(null)
              toast({ tone: 'success', message: 'Endereço salvo.' })
            }}
          />
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={apagando !== null}
        onClose={() => setApagando(null)}
        title="Apagar endereço"
        description={apagando ? `Apagar o endereço ${apagando.label ?? apagando.street}? Os pedidos já feitos continuam com o endereço da época.` : undefined}
        action={apagarEndereco.bind(null, slug)}
        initialState={ESTADO_VAZIO}
        confirmLabel="Apagar endereço"
        hidden={{ id: apagando?.id ?? '' }}
      />
    </div>
  )
}
