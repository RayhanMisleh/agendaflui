'use client'
import { useState } from 'react'
import { PetIllustration, Switch } from '@/ui/components'
import { PainelForm } from '../../_lib/PainelForm'
import type { EstadoPainel } from '../../_lib/PainelForm'
import { salvarAnimais } from '../actions'

const INICIAL = (servesCats: boolean): EstadoPainel => ({ ok: false, message: null, fields: {}, values: { servesCats: servesCats ? 'on' : '' } })

/** Passo 3: cães sempre; gatos se a loja atende. Ligar mostra o gato na hora, para a escolha ficar concreta. */
export function PassoAnimais({ version, servesCats }: { version: number; servesCats: boolean }) {
  return (
    <PainelForm action={salvarAnimais} initial={INICIAL(servesCats)} submit="Salvar e continuar" labels={{ servesCats: 'Atende gatos' }}>
      {(state) => <Campos version={version} inicial={state.values.servesCats === 'on'} />}
    </PainelForm>
  )
}

function Campos({ version, inicial }: { version: number; inicial: boolean }) {
  const [gatos, setGatos] = useState(inicial)
  return (
    <>
      <input type="hidden" name="version" value={String(version)} />
      {gatos ? <input type="hidden" name="servesCats" value="on" /> : null}
      <ul className="af-onb__animals" aria-label="Animais atendidos">
        <li className="af-onb__animal">
          <PetIllustration variant="DOG_MEDIUM" size={56} />
          <span>Cães</span>
        </li>
        <li className={`af-onb__animal${gatos ? '' : ' af-onb__animal--off'}`}>
          <PetIllustration variant="CAT" size={56} />
          <span>{gatos ? 'Gatos' : 'Gatos desligados'}</span>
        </li>
      </ul>
      <p className="af-onb__lead">Cães são sempre atendidos.</p>
      <Switch checked={gatos} onCheckedChange={setGatos} label="Atende gatos" />
      <p className="af-field__hint">Desligado, os clientes não marcam horário para gatos e a tabela de preços esconde a linha de gato. Dá para mudar depois em Configurações.</p>
    </>
  )
}
