'use client'
import { useActionState, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react'
import {
  BrandPreview,
  Button,
  Checkbox,
  ColorField,
  CopyButton,
  Field,
  FoldablePreview,
  FormErrors,
  Input,
  LinkButton,
  MaskedInput,
  SidebarStylePicker,
  Card,
  Select,
  StatusBadge,
  StepRail,
  useHydrated,
} from '@/ui/components'
import { previewTheme } from '@/shared/theme/preview'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import { ACCENT_FIELD_LABEL, PRIMARY_FIELD_LABEL, SIDEBAR_FIELD_LABEL } from '@/shared/theme/labels'
import type { FormState } from '@/app/_lib/form-state'
import type { LimitesDeRegras } from '../[id]/FormsConta'
import { criarConta } from './actions'
import { STEPS, firstStepWithError, pickValues, slugify, stepsWithError } from './fields'
import type { WizardData, WizardResult, WizardValues } from './fields'

const ROTULOS: Record<string, string> = {
  name: 'Nome da conta',
  slug: 'Identificador',
  document: 'CPF ou CNPJ',
  contactEmail: 'E-mail de contato',
  contactPhone: 'Telefone',
  displayName: 'Nome de exibição',
  primary: PRIMARY_FIELD_LABEL,
  accent: ACCENT_FIELD_LABEL,
  material: SIDEBAR_FIELD_LABEL,
  professionalSingular: 'Profissional (singular)',
  professionalPlural: 'Profissional (plural)',
  customerSingular: 'Cliente (singular)',
  customerPlural: 'Cliente (plural)',
  pointsSingular: 'Pontos (singular)',
  pointsPlural: 'Pontos (plural)',
  club: 'Clube',
  store: 'Loja',
  slotStepMin: 'Grade de horários',
  minLeadMin: 'Antecedência mínima',
  maxAdvanceDays: 'Alcance da agenda',
  customerChangeWindowMin: 'Prazo para o cliente mudar',
  bufferMin: 'Intervalo entre atendimentos',
  ownerName: 'Nome do dono',
  ownerEmail: 'E-mail do dono',
}

type Estado = FormState<WizardData>

/**
 * Assistente de nova conta. Todas as etapas são seções do MESMO formulário: sem JavaScript viram um formulário longo que
 * envia tudo de uma vez; com JavaScript mostra uma etapa por vez, com o trilho no alto e a prévia da marca ao lado.
 * Os campos são controlados (o estado sobrevive a erro de validação) e a conta só é criada no envio final.
 */
export function Wizard({ initial, grades, limites }: { initial: Estado } & LimitesDeRegras) {
  // "Criar outra conta" troca a chave e o assistente recomeça do zero (estado, ação e campos).
  const [rodada, setRodada] = useState(0)
  return <AssistenteDeConta key={rodada} initial={initial} grades={grades} limites={limites} onAgain={() => setRodada((r) => r + 1)} />
}

function AssistenteDeConta({ initial, grades, limites, onAgain }: { initial: Estado; onAgain: () => void } & LimitesDeRegras) {
  const [state, formAction, pending] = useActionState(criarConta, initial)
  const hidratado = useHydrated()
  const [v, setV] = useState<WizardValues>(() => pickValues(initial.values))
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [visto, setVisto] = useState<Estado>(state)
  const [slugManual, setSlugManual] = useState(() => initial.values.slug !== '' && initial.values.slug !== slugify(initial.values.name))
  const [nomeManual, setNomeManual] = useState(() => initial.values.displayName !== '' && initial.values.displayName !== initial.values.name)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const primeiraVez = useRef(true)

  // Um retorno novo do servidor com erro leva a pessoa à etapa do primeiro campo com erro (padrão "ajustar estado na renderização").
  if (state !== visto) {
    setVisto(state)
    const alvo = firstStepWithError(state.fields)
    if (alvo !== null) setStep(alvo)
  }

  // Troca de etapa: o foco vai para o título da etapa (teclado e leitor de tela).
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    tituloRef.current?.focus()
  }, [step])

  const ir = (i: number) => {
    setStep(i)
    setMaxStep((m) => Math.max(m, i))
  }
  const set = <K extends keyof WizardValues>(k: K, valor: WizardValues[K]) => setV((p) => ({ ...p, [k]: valor }))
  const texto = (k: keyof WizardValues) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    set(k, e.target.value as never)
  const erro = (k: string) => state.fields[k]

  function onNome(valor: string) {
    setV((p) => ({
      ...p,
      name: valor,
      ...(slugManual ? {} : { slug: slugify(valor) }),
      ...(nomeManual ? {} : { displayName: valor }),
    }))
  }

  // Enter num campo de uma etapa do meio avança em vez de criar a conta.
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter' || !hidratado || step >= STEPS.length - 1) return
    const alvo = e.target
    if (alvo instanceof HTMLTextAreaElement || alvo instanceof HTMLButtonElement) return
    e.preventDefault()
    ir(step + 1)
  }

  if (state.ok && state.values.result) return <Concluida result={state.values.result} onAgain={onAgain} />

  const { warnings } = previewTheme(v)
  const comPrevia = !hidratado || step === 1 || step === 2
  const ultima = step === STEPS.length - 1
  const rotulosErro = ROTULOS

  return (
    <Card className="af-wizard">
      <StepRail
        steps={STEPS}
        current={hidratado ? step : 0}
        onSelect={ir}
        errorSteps={stepsWithError(state.fields)}
        visitedUntil={maxStep}
      />
      <FormErrors message={state.message} fields={state.fields} labels={rotulosErro} />
      <form action={formAction} onKeyDown={onKeyDown} className={`af-wizard__layout${comPrevia ? ' af-wizard__layout--aside' : ''}`} noValidate>
        <div className="af-wizard__main">
          <Etapa i={0} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Dados da conta" ajuda="Quem é o negócio e como ele entra no sistema. Só o nome e o identificador são obrigatórios aqui.">
            <div className="af-wizard__grid">
              <Field label="Nome da conta" error={erro('name')}>
                <Input name="name" value={v.name} onChange={(e) => onNome(e.target.value)} autoComplete="off" />
              </Field>
              <Field
                label="Identificador"
                hint="Letras minúsculas, números e hífens. Identifica a conta no painel dev."
                error={erro('slug')}
              >
                <Input
                  name="slug"
                  value={v.slug}
                  onChange={(e) => {
                    setSlugManual(true)
                    set('slug', e.target.value)
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Field>
              <Field label="E-mail de contato (opcional)" error={erro('contactEmail')}>
                <Input name="contactEmail" type="email" inputMode="email" value={v.contactEmail} onChange={texto('contactEmail')} autoComplete="off" />
              </Field>
              <Field label="Telefone (opcional)" error={erro('contactPhone')}>
                <MaskedInput mask="phone" name="contactPhone" value={v.contactPhone} onChange={texto('contactPhone')} />
              </Field>
              <Field label="CPF ou CNPJ (opcional)" error={erro('document')}>
                <MaskedInput mask="document" name="document" value={v.document} onChange={texto('document')} />
              </Field>
            </div>
          </Etapa>

          <Etapa i={1} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Marca" ajuda="Cores e barra lateral. A prévia ao lado muda na hora, sem enviar nada.">
            <div className="af-wizard__grid">
              <Field label="Nome de exibição" hint="Aparece na barra lateral do painel e nos e-mails." error={erro('displayName')}>
                <Input
                  name="displayName"
                  value={v.displayName}
                  onChange={(e) => {
                    setNomeManual(true)
                    set('displayName', e.target.value)
                  }}
                  autoComplete="off"
                />
              </Field>
              <Card variant="warm" className="af-wizard__tip">
                <p>Envie a logo, o símbolo, o favicon e a imagem de entrada na aba Marca da conta, logo depois de criá-la.</p>
              </Card>
              <ColorField label={PRIMARY_FIELD_LABEL} name="primary" value={v.primary} onChange={(c) => set('primary', c)} {...opcional('error', erro('primary'))} {...opcional('warning', avisoDe(warnings, 'primary'))} />
              <ColorField label={ACCENT_FIELD_LABEL} name="accent" value={v.accent} onChange={(c) => set('accent', c)} {...opcional('error', erro('accent'))} {...opcional('warning', avisoDe(warnings, 'accent'))} />
            </div>
            <SidebarStylePicker
              name="material"
              value={v.material}
              onChange={(m) => set('material', m)}
              primary={v.primary}
              accent={v.accent}
            />
          </Etapa>

          <Etapa i={2} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Módulos" ajuda="O que esta conta usa além da agenda. Módulo desligado some do menu e das telas.">
            <div className="af-wizard__checks">
              <Checkbox name="loyalty" label="Fidelidade: pontos e prêmios" checked={v.loyalty} onChange={(e) => set('loyalty', e.target.checked)} />
              <Checkbox name="banners" label="Banners: avisos e promoções para clientes" checked={v.banners} onChange={(e) => set('banners', e.target.checked)} />
              <Checkbox name="store" label="Loja: produtos e pedidos" checked={v.store} onChange={(e) => set('store', e.target.checked)} />
            </div>
          </Etapa>

          <Etapa i={3} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Regras de agenda" ajuda="Os valores começam no padrão do sistema. O dono pode ajustá-los depois.">
            <div className="af-wizard__grid">
              <Field label="Grade de horários" hint="De quanto em quanto tempo um horário pode começar." error={erro('slotStepMin')}>
                <Select name="slotStepMin" value={v.slotStepMin} onChange={texto('slotStepMin')}>
                  {grades.map((g) => (
                    <option key={g} value={String(g)}>
                      {g} minutos
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Intervalo entre atendimentos (minutos)" hint={`Múltiplo de ${limites.bufferMin.step}, até ${limites.bufferMin.max}.`} error={erro('bufferMin')}>
                <Input name="bufferMin" type="number" inputMode="numeric" min={limites.bufferMin.min} max={limites.bufferMin.max} step={limites.bufferMin.step} value={v.bufferMin} onChange={texto('bufferMin')} />
              </Field>
              <Field label="Antecedência mínima (minutos)" hint="Quanto antes do horário o cliente ainda pode marcar." error={erro('minLeadMin')}>
                <Input name="minLeadMin" type="number" inputMode="numeric" min={limites.minLeadMin.min} max={limites.minLeadMin.max} value={v.minLeadMin} onChange={texto('minLeadMin')} />
              </Field>
              <Field label="Alcance da agenda (dias)" hint="Até quantos dias à frente se pode marcar." error={erro('maxAdvanceDays')}>
                <Input name="maxAdvanceDays" type="number" inputMode="numeric" min={limites.maxAdvanceDays.min} max={limites.maxAdvanceDays.max} value={v.maxAdvanceDays} onChange={texto('maxAdvanceDays')} />
              </Field>
              <Field label="Prazo para o cliente mudar (minutos)" hint="Até quanto tempo antes o cliente pode remarcar ou cancelar." error={erro('customerChangeWindowMin')}>
                <Input name="customerChangeWindowMin" type="number" inputMode="numeric" min={limites.customerChangeWindowMin.min} max={limites.customerChangeWindowMin.max} value={v.customerChangeWindowMin} onChange={texto('customerChangeWindowMin')} />
              </Field>
            </div>
            <Checkbox name="autoConfirm" label="Confirmar os agendamentos sozinho" checked={v.autoConfirm} onChange={(e) => set('autoConfirm', e.target.checked)} />
          </Etapa>

          <Etapa i={4} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Dono da conta" ajuda="Quem manda na conta. Se o e-mail já tem cadastro, a pessoa é vinculada sem trocar a senha e recebe um aviso de acesso novo. Senão, recebe o convite para definir a senha.">
            <div className="af-wizard__grid">
              <Field label="Nome do dono" error={erro('ownerName')}>
                <Input name="ownerName" value={v.ownerName} onChange={texto('ownerName')} autoComplete="off" />
              </Field>
              <Field label="E-mail do dono" error={erro('ownerEmail')}>
                <Input name="ownerEmail" type="email" inputMode="email" value={v.ownerEmail} onChange={texto('ownerEmail')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </Field>
            </div>
            <dl className="af-wizard__summary" aria-label="Resumo do que será criado">
              <dt>Conta</dt>
              <dd>{v.name || 'Sem nome ainda'}{v.slug ? ` (${v.slug})` : ''}</dd>
              <dt>Marca</dt>
              <dd>{v.displayName || 'Sem nome de exibição'}</dd>
              <dt>Dono</dt>
              <dd>{v.ownerEmail || 'Sem e-mail ainda'}</dd>
              <dt>Módulos</dt>
              <dd>{[v.loyalty && 'Fidelidade', v.banners && 'Banners', v.store && 'Loja'].filter(Boolean).join(', ') || 'Só a agenda'}</dd>
            </dl>
          </Etapa>

          <div className="af-wizard__nav">
            {hidratado ? (
              <Button onClick={() => ir(Math.max(0, step - 1))} disabled={step === 0} icon={<ArrowLeft size={18} />}>
                Voltar
              </Button>
            ) : (
              <span />
            )}
            {hidratado && !ultima ? (
              <Button variant="primary" onClick={() => ir(step + 1)} icon={<ArrowRight size={18} />}>
                Continuar
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="lg" loading={pending}>
                Criar conta
              </Button>
            )}
          </div>
        </div>
        {comPrevia ? (
          <FoldablePreview className="af-wizard__aside">
            <BrandPreview
              businessName={v.displayName || v.name}
              brand={{ primary: v.primary, accent: v.accent, material: v.material }}
            />
          </FoldablePreview>
        ) : null}
      </form>
    </Card>
  )
}

/** Passa a propriedade só quando ela tem valor (o campo de cor não aceita `undefined` explícito em todas as versões). */
function opcional<K extends string>(chave: K, valor: string | undefined): Partial<Record<K, string>> {
  return valor === undefined ? {} : ({ [chave]: valor } as Record<K, string>)
}

/** O aviso de ajuste de cor que cabe a um campo (o motor diz "principal" ou "destaque"). */
function avisoDe(avisos: ReturnType<typeof previewTheme>['warnings'], campo: 'primary' | 'accent'): string | undefined {
  const w = avisos.find((a) => a === (campo === 'primary' ? 'text_adjusted' : 'accent_adjusted'))
  return w ? THEME_WARNING_TEXT[w] : undefined
}

function Etapa(p: {
  i: number
  step: number
  hidratado: boolean
  tituloRef: React.RefObject<HTMLHeadingElement | null>
  titulo: string
  ajuda: string
  children: React.ReactNode
}) {
  const atual = p.hidratado && p.i === p.step
  return (
    <section id={`etapa-${STEPS[p.i]?.id}`} aria-labelledby={`etapa-${STEPS[p.i]?.id}-titulo`} className="af-wizard__step" hidden={p.hidratado && p.i !== p.step}>
      <h2 id={`etapa-${STEPS[p.i]?.id}-titulo`} className="af-wizard__heading" tabIndex={-1} ref={atual ? p.tituloRef : undefined}>
        {p.titulo}
      </h2>
      <p className="af-wizard__help">{p.ajuda}</p>
      {p.children}
    </section>
  )
}

/** Tela final: o estado do convite e o que faltou (se faltou). */
function Concluida({ result, onAgain }: { result: WizardResult; onAgain: () => void }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titulo.current?.focus()
  }, [])
  return (
    <Card className="af-done">
      <div className="af-done__head">
        <h2 ref={titulo} tabIndex={-1} className="af-done__title">
          {result.businessName} está criada
        </h2>
        <StatusBadge tone={result.pendencias.length > 0 ? 'pending' : 'confirmed'}>{result.pendencias.length > 0 ? 'Quase pronta' : 'Pronta'}</StatusBadge>
      </div>

      {result.pendencias.length > 0 ? (
        <div role="alert" className="af-wizard__note">
          A conta foi criada, mas faltou salvar:
          <ul>
            {result.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          Abra a conta e complete esses itens.
        </div>
      ) : null}

      <p className="af-wizard__note">
        {result.ownerExisting
          ? `${result.ownerEmail} já tinha cadastro: foi vinculado à conta sem trocar a senha${result.emailSent ? ' e recebeu um aviso de acesso novo.' : '. O aviso por e-mail não saiu; avise a pessoa por outro meio.'}`
          : result.emailSent
            ? `Enviamos para ${result.ownerEmail} o convite para definir a senha.`
            : `O convite para ${result.ownerEmail} não saiu por e-mail. Reenvie o convite na página da conta.`}
      </p>

      <div className="af-done__row">
        <label htmlFor="link-clientes" className="af-done__label">
          Link para clientes
        </label>
        <div className="af-entrylink">
          <Input id="link-clientes" readOnly value={result.customerLinkUrl} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={result.customerLinkUrl} label="Copiar o link para clientes" variant="secondary" />
        </div>
      </div>

      <div className="af-done__actions">
        <LinkButton href={`/contas/${result.createdId}`} variant="primary">
          Abrir a conta
        </LinkButton>
        <LinkButton href={`/contas/${result.createdId}/marca`} variant="secondary">
          Enviar a logo e as imagens
        </LinkButton>
        <Button variant="secondary" icon={<Plus size={18} />} onClick={onAgain}>
          Criar outra conta
        </Button>
      </div>
    </Card>
  )
}
