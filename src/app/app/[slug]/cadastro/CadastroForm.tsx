'use client'
import { useActionState, useRef, useState } from 'react'
import { CircleAlert, MailCheck } from 'lucide-react'
import { Button, CodeField, Field, Input } from '@/ui/components'
import { confirmarCadastro, pedirCodigo } from './actions'
import type { EstadoCadastro, EstadoCodigo } from './actions'

const INICIAL: EstadoCadastro = { step: 'dados', error: null, fields: {}, values: { name: '', email: '', phone: '' }, sent: 0 }
const SEM_ERRO: EstadoCodigo = { error: null, fields: {} }

type Dados = { name: string; email: string; phone: string; password: string }

function Alerta({ children }: { children: string }) {
  return (
    <p role="alert" className="af-entry__error">
      <CircleAlert size={18} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Cadastro em dois passos no mesmo formulário: dados, depois o código de 6 dígitos enviado por e-mail. A senha só existe
 * neste componente (na memória, para "Reenviar código"): nunca volta do servidor.
 */
export function CadastroForm({ slug }: { slug: string }) {
  const [pedido, pedir, pedindo] = useActionState(pedirCodigo, INICIAL)
  const [confirmacao, confirmar, confirmando] = useActionState(confirmarCadastro, SEM_ERRO)
  const [voltou, setVoltou] = useState(false)
  const guardados = useRef<Dados | null>(null)
  const noCodigo = pedido.step === 'codigo' && !voltou

  const enviarDados = (form: FormData): void => {
    const campo = (nome: string) => (typeof form.get(nome) === 'string' ? String(form.get(nome)) : '')
    guardados.current = { name: campo('name'), email: campo('email'), phone: campo('phone'), password: campo('password') }
    setVoltou(false)
    pedir(form)
  }

  const reenviar = (): void => {
    const d = guardados.current
    if (!d) return
    const form = new FormData()
    form.set('slug', slug)
    for (const [nome, valor] of Object.entries(d)) form.set(nome, valor)
    pedir(form)
  }

  if (noCodigo) {
    return (
      <form action={confirmar} className="af-entry__form">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="email" value={pedido.values.email} />
        <p role="status" className="af-entry__notice">
          <MailCheck size={18} aria-hidden="true" />
          <span>
            Enviamos um código para {pedido.values.email}.
            {pedido.sent > 1 ? ' Enviamos outro código: vale só o mais novo.' : ''} Se não chegar em alguns minutos, olhe o spam.
          </span>
        </p>
        <CodeField name="code" error={confirmacao.fields['code'] ?? null} autoFocus />
        {confirmacao.error ? <Alerta>{confirmacao.error}</Alerta> : null}
        <Button type="submit" variant="primary" size="lg" loading={confirmando}>
          Confirmar e entrar
        </Button>
        <div className="af-entry__row">
          <button type="button" className="af-entry__link" onClick={reenviar} disabled={pedindo}>
            Reenviar código
          </button>
          <button type="button" className="af-entry__link" onClick={() => setVoltou(true)}>
            Trocar e-mail
          </button>
        </div>
      </form>
    )
  }

  const f = pedido.fields
  return (
    <form action={enviarDados} className="af-entry__form">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Nome" error={f['name']}>
        <Input name="name" autoComplete="name" required maxLength={120} defaultValue={pedido.values.name} invalid={Boolean(f['name'])} />
      </Field>
      <Field label="E-mail" error={f['email']}>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={pedido.values.email}
          invalid={Boolean(f['email'])}
        />
      </Field>
      <Field label="Telefone" hint="Com DDD. Opcional." error={f['phone']}>
        <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={pedido.values.phone} invalid={Boolean(f['phone'])} />
      </Field>
      <Field label="Senha" hint="Use 10 caracteres ou mais." error={f['password']}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} invalid={Boolean(f['password'])} />
      </Field>
      {pedido.error ? <Alerta>{pedido.error}</Alerta> : null}
      <Button type="submit" variant="primary" size="lg" loading={pedindo}>
        Continuar
      </Button>
    </form>
  )
}
