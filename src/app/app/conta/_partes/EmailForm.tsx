'use client'
import { startTransition, useActionState, useState } from 'react'
import { MailCheck, TriangleAlert } from 'lucide-react'
import { emailChangeUnlinksGoogle } from '@/shared/person'
import { Button, Card, CodeField, Field, Input, LinkButton } from '@/ui/components'
import { confirmarEmail, pedirCodigoDeEmail } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'
import { Retorno } from './Retorno'

const AVISO_GOOGLE = 'O Google vinculado usa outro e-mail e será desvinculado.'

/** "E-mail": mostra o atual e troca em dois passos (e-mail novo, depois o código enviado a ele). */
export function EmailForm({ email, google, hasPassword }: { email: string; google: { email: string } | null; hasPassword: boolean }) {
  const [pedido, pedir, pedindo] = useActionState(pedirCodigoDeEmail, ESTADO_CONTA)
  const [confirmacao, confirmar, confirmando] = useActionState(confirmarEmail, ESTADO_CONTA)
  const [fase, setFase] = useState<'fechado' | 'email' | 'codigo'>('fechado')
  const [novo, setNovo] = useState('')
  // Reage às respostas das ações durante a renderização (sem efeito): pedido enviado abre o código; troca feita fecha tudo.
  const [vistoPedido, setVistoPedido] = useState(pedido)
  if (vistoPedido !== pedido) {
    setVistoPedido(pedido)
    if (pedido.step === 'codigo') setFase('codigo')
  }
  const [vistaConfirmacao, setVistaConfirmacao] = useState(confirmacao)
  if (vistaConfirmacao !== confirmacao) {
    setVistaConfirmacao(confirmacao)
    if (confirmacao.ok) {
      setFase('fechado')
      setNovo('')
    }
  }

  const destino = fase === 'codigo' ? (pedido.values['email'] ?? novo) : novo
  const desvincula = google !== null && destino.trim() !== '' && emailChangeUnlinksGoogle(google, destino)
  const aviso = desvincula ? (
    <p role="note" className="af-conta__note">
      <TriangleAlert size={18} aria-hidden="true" />
      <span>{AVISO_GOOGLE}</span>
    </p>
  ) : null

  const reenviar = (): void => {
    const fd = new FormData()
    fd.set('email', pedido.values['email'] ?? novo)
    startTransition(() => pedir(fd))
  }

  return (
    <Card as="section" aria-labelledby="conta-email" className="af-conta__card">
      <div className="af-conta__head">
        <h2 id="conta-email" className="af-section__title">
          E-mail
        </h2>
      </div>
      <p className="af-conta__value">{email}</p>
      {fase === 'fechado' ? (
        <div className="af-conta__actions">
          <Button variant="secondary" onClick={() => setFase('email')}>
            Trocar e-mail
          </Button>
        </div>
      ) : null}
      {fase === 'email' ? (
        <form action={pedir} className="af-conta__form">
          <Retorno state={pedido} />
          {pedido.needsPassword ? (
            <div className="af-conta__actions">
              <LinkButton href="#senha" variant="secondary">
                Criar senha
              </LinkButton>
            </div>
          ) : null}
          <Field label="Novo e-mail" hint="Enviamos um código para ele." error={pedido.fields['email']}>
            <Input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              invalid={Boolean(pedido.fields['email'])}
            />
          </Field>
          {aviso}
          <div className="af-conta__actions">
            <Button type="submit" variant="primary" loading={pedindo}>
              Enviar código
            </Button>
            <Button variant="ghost" onClick={() => setFase('fechado')}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
      {fase === 'codigo' ? (
        <form action={confirmar} className="af-conta__form">
          <input type="hidden" name="email" value={destino} />
          <p role="status" className="af-conta__note">
            <MailCheck size={18} aria-hidden="true" />
            <span>
              Enviamos um código para {destino}.{pedido.sent > 1 ? ' Enviamos outro código: vale só o mais novo.' : ''} Se não chegar em
              alguns minutos, olhe o spam.
            </span>
          </p>
          <Retorno state={confirmacao} />
          <CodeField name="code" error={confirmacao.fields['code'] ?? null} autoFocus />
          {confirmacao.fields['email'] ? <p className="af-conta__muted">{confirmacao.fields['email']}</p> : null}
          {aviso}
          <div className="af-conta__actions">
            <Button type="submit" variant="primary" loading={confirmando}>
              Confirmar
            </Button>
            <Button variant="ghost" onClick={reenviar} disabled={pedindo}>
              Reenviar código
            </Button>
            <Button variant="ghost" onClick={() => setFase('email')}>
              Trocar e-mail
            </Button>
          </div>
        </form>
      ) : null}
      {!hasPassword && google !== null && fase === 'fechado' ? (
        <p className="af-conta__muted">Você entra só com o Google. Para trocar o e-mail, crie uma senha antes.</p>
      ) : null}
    </Card>
  )
}
