'use client'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowLeft, CircleAlert, CircleCheck, MailCheck } from 'lucide-react'
import { PasswordInput } from '@/app/_lib/PasswordInput'
import { Button, Field, Input, MaskedInput } from '@/ui/components'
import { concluirCadastro, confirmarCadastro, pedirCodigo } from './actions'
import type { PassoCadastro } from './actions'

type Passo = 'nome' | 'conta' | 'codigo' | 'whatsapp'
const PASSOS: Passo[] = ['nome', 'conta', 'codigo', 'whatsapp']
const TITULOS: Record<Passo, string> = {
  nome: 'Como te chamamos?',
  conta: 'Seu e-mail e uma senha',
  codigo: 'Confirme o seu e-mail',
  whatsapp: 'Qual é o seu WhatsApp?',
}
/** Segundos até liberar "Reenviar código" (o servidor também limita). */
const ESPERA_REENVIO = 30
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function Alerta({ children }: { children: string }) {
  return (
    <p role="alert" className="af-entry__error">
      <CircleAlert size={18} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Criar conta em formato de quiz: uma pergunta por tela. 1. nome; 2. e-mail e senha; 3. código de 6 dígitos enviado por
 * e-mail (ao confirmar, a conta nasce e a sessão começa); 4. WhatsApp (pode pular). Depois segue para onde a pessoa ia.
 * Cada passo valida antes de avançar, Enter avança, o foco vai para o campo do passo e a troca é anunciada. A senha vive
 * só na memória deste componente (para "Reenviar código"); nunca volta do servidor.
 */
export function CadastroQuiz({ slug, volta = null, abertura }: { slug: string; volta?: string | null; abertura?: ReactNode }) {
  const [passo, setPasso] = useState<Passo>('nome')
  const [direcao, setDirecao] = useState<1 | -1>(1)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [enviados, setEnviados] = useState(0)
  const [espera, setEspera] = useState(0)
  const [ocupado, iniciar] = useTransition()
  const raiz = useRef<HTMLDivElement>(null)
  const jaMudou = useRef(false)
  const confirmando = useRef(false)
  const tituloId = useId()
  const indice = PASSOS.indexOf(passo)

  // Foco no campo do passo (menos na primeira tela, para não abrir o teclado do celular sem a pessoa pedir).
  useEffect(() => {
    if (!jaMudou.current) {
      jaMudou.current = true
      return
    }
    raiz.current?.querySelector<HTMLElement>('[data-quiz-foco]')?.focus()
  }, [passo])

  const esperando = espera > 0
  useEffect(() => {
    if (!esperando) return
    const id = setInterval(() => setEspera((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [esperando])

  const ir = (para: Passo): void => {
    setDirecao(PASSOS.indexOf(para) >= indice ? 1 : -1)
    setErros({})
    setErroGeral(null)
    setPasso(para)
  }

  const corpo = (extra: Record<string, string> = {}): FormData => {
    const form = new FormData()
    form.set('slug', slug)
    if (volta) form.set('volta', volta)
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
    return form
  }

  /** Aplica a resposta de um passo: erros por campo (voltando ao passo do campo, se for outro) e erro geral. */
  const falhou = (r: PassoCadastro, atual: Passo): void => {
    setErros(r.fields)
    setErroGeral(r.error)
    const alvo: Passo | null = r.fields['name'] ? 'nome' : r.fields['email'] || r.fields['password'] ? 'conta' : null
    if (alvo && alvo !== atual) {
      setDirecao(-1)
      setPasso(alvo)
    }
  }

  const avancarNome = (e: FormEvent): void => {
    e.preventDefault()
    if (nome.trim().length < 2) {
      setErros({ name: 'Informe seu nome.' })
      return
    }
    ir('conta')
  }

  const pedir = (aoEnviar: () => void): void => {
    iniciar(async () => {
      const r = await pedirCodigo(corpo({ name: nome.trim(), email: email.trim(), password: senha }))
      if (!r.ok) return falhou(r, 'conta')
      setEnviados((n) => n + 1)
      setEspera(ESPERA_REENVIO)
      setCodigo('')
      aoEnviar()
    })
  }

  const enviarConta = (e: FormEvent): void => {
    e.preventDefault()
    const novos: Record<string, string> = {}
    if (!EMAIL_VALIDO.test(email.trim())) novos['email'] = 'Informe um e-mail válido, por exemplo nome@exemplo.com.'
    if (senha.length < 10) novos['password'] = 'A senha precisa de 10 caracteres ou mais.'
    if (Object.keys(novos).length > 0) {
      setErros(novos)
      return
    }
    setErros({})
    setErroGeral(null)
    pedir(() => ir('codigo'))
  }

  const reenviar = (): void => {
    setErroGeral(null)
    pedir(() => {})
  }

  const confirmar = (valor: string): void => {
    if (!/^\d{6}$/.test(valor)) {
      setErros({ code: 'Informe o código de 6 dígitos que enviamos por e-mail.' })
      return
    }
    if (confirmando.current) return
    confirmando.current = true
    iniciar(async () => {
      const r = await confirmarCadastro(corpo({ email: email.trim(), code: valor }))
      confirmando.current = false
      if (!r.ok) return falhou(r, 'codigo')
      // A conta existe e a sessão começou: daqui não se volta.
      setSenha('')
      ir('whatsapp')
    })
  }

  const concluir = (pular: boolean): void => {
    iniciar(async () => {
      const r = await concluirCadastro(corpo({ phone: pular ? '' : telefone }))
      // Sucesso redireciona; só chega aqui com erro (telefone inválido).
      if (!r.ok) falhou(r, 'whatsapp')
    })
  }

  const aoMudarCodigo = (valor: string): void => {
    const digitos = valor.replace(/\D/g, '').slice(0, 6)
    setCodigo(digitos)
    setErros({})
    // Código completo: confirma sozinho, sem exigir outro toque.
    if (digitos.length === 6) confirmar(digitos)
  }

  const rotulo = `Passo ${indice + 1} de ${PASSOS.length}: ${TITULOS[passo]}`

  return (
    <div ref={raiz} className="af-entry__body af-quiz" data-testid="loja-cadastro" {...(passo === 'nome' ? {} : { 'data-entry-deep': '' })}>
      <div className="af-quiz__head">
        {passo === 'conta' || passo === 'codigo' ? (
          <button type="button" className="af-quiz__back" onClick={() => ir(passo === 'conta' ? 'nome' : 'conta')} aria-label="Voltar">
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        ) : null}
        <div
          className="af-quiz__bar"
          role="progressbar"
          aria-label="Progresso do cadastro"
          aria-valuemin={1}
          aria-valuemax={PASSOS.length}
          aria-valuenow={indice + 1}
          aria-valuetext={`${indice + 1} de ${PASSOS.length}`}
        >
          <span className="af-quiz__fill" style={{ transform: `scaleX(${(indice + 1) / PASSOS.length})` }} />
        </div>
        <span className="af-quiz__count" aria-hidden="true">
          {indice + 1} de {PASSOS.length}
        </span>
      </div>
      <p className="af-sr" role="status" aria-live="polite">
        {rotulo}
      </p>

      <section key={passo} className="af-quiz__step" data-direcao={direcao} aria-labelledby={tituloId}>
        <h1 id={tituloId} className="af-entry__title">
          {TITULOS[passo]}
        </h1>

        {passo === 'nome' ? (
          <>
            <p className="af-entry__message">Pode ser o seu nome ou um apelido.</p>
            {abertura}
            <form className="af-entry__form" onSubmit={avancarNome} noValidate>
              <Field label="Seu nome" error={erros['name']}>
                <Input
                  name="name"
                  autoComplete="name"
                  autoCapitalize="words"
                  maxLength={120}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  invalid={Boolean(erros['name'])}
                  data-quiz-foco=""
                />
              </Field>
              <Button type="submit" variant="primary" size="lg">
                Continuar
              </Button>
            </form>
          </>
        ) : null}

        {passo === 'conta' ? (
          <>
            <p className="af-entry__message">Vamos enviar um código para confirmar que o e-mail é seu.</p>
            <form className="af-entry__form" onSubmit={enviarConta} noValidate>
              <Field label="E-mail" error={erros['email']}>
                <Input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  invalid={Boolean(erros['email'])}
                  data-quiz-foco=""
                />
              </Field>
              <Field label="Senha" hint="Use 10 caracteres ou mais." error={erros['password']}>
                <PasswordInput name="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} invalid={Boolean(erros['password'])} />
              </Field>
              {erroGeral ? <Alerta>{erroGeral}</Alerta> : null}
              <Button type="submit" variant="primary" size="lg" loading={ocupado}>
                Enviar código
              </Button>
            </form>
          </>
        ) : null}

        {passo === 'codigo' ? (
          <form
            className="af-entry__form"
            onSubmit={(e) => {
              e.preventDefault()
              confirmar(codigo)
            }}
            noValidate
          >
            <p role="status" className="af-entry__notice">
              <MailCheck size={18} aria-hidden="true" />
              <span>
                Enviamos um código de 6 dígitos para {email.trim()}.
                {enviados > 1 ? ' Enviamos outro código: vale só o mais novo.' : ''} Se não chegar em alguns minutos, olhe o spam.
              </span>
            </p>
            <Field label="Código de 6 dígitos" error={erros['code']}>
              <Input
                name="code"
                className="af-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={codigo}
                onChange={(e) => aoMudarCodigo(e.target.value)}
                invalid={Boolean(erros['code'])}
                data-quiz-foco=""
              />
            </Field>
            {erroGeral ? <Alerta>{erroGeral}</Alerta> : null}
            <Button type="submit" variant="primary" size="lg" loading={ocupado}>
              Confirmar
            </Button>
            <div className="af-entry__row">
              <button type="button" className="af-entry__link" onClick={reenviar} disabled={ocupado || espera > 0}>
                {espera > 0 ? `Reenviar código em ${espera} s` : 'Reenviar código'}
              </button>
              <button type="button" className="af-entry__link" onClick={() => ir('conta')}>
                Trocar e-mail
              </button>
            </div>
          </form>
        ) : null}

        {passo === 'whatsapp' ? (
          <>
            <p role="status" className="af-entry__notice">
              <CircleCheck size={18} aria-hidden="true" />
              <span>Conta criada. Falta só uma coisa.</span>
            </p>
            <p className="af-entry__message">A loja usa o número para falar com você sobre os seus horários.</p>
            <form
              className="af-entry__form"
              onSubmit={(e) => {
                e.preventDefault()
                concluir(false)
              }}
              noValidate
            >
              <Field label="WhatsApp" hint="Com DDD. Você pode pular." error={erros['phone']}>
                <MaskedInput
                  mask="phone"
                  name="phone"
                  autoComplete="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  invalid={Boolean(erros['phone'])}
                  data-quiz-foco=""
                />
              </Field>
              {erroGeral ? <Alerta>{erroGeral}</Alerta> : null}
              <Button type="submit" variant="primary" size="lg" loading={ocupado}>
                Concluir
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={() => concluir(true)} disabled={ocupado}>
                Pular por agora
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </div>
  )
}
