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
  FormErrors,
  Input,
  LinkButton,
  MaterialPicker,
  Paper,
  Select,
  Stamp,
  StepRail,
  Textarea,
  useHydrated,
} from '@/ui/components'
import { previewTheme } from '@/shared/theme/preview'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import type { FontPair, PaperTone } from '@/shared/theme/derive'
import type { FormState } from '../../_lib/form-state'
import { criarConta } from './actions'
import { FUSOS, STEPS, TERM_PRESETS, firstStepWithError, pickValues, slugify, stepsWithError } from './fields'
import type { WizardData, WizardResult, WizardValues } from './fields'

const ROTULOS: Record<string, string> = {
  name: 'Nome da conta',
  slug: 'Identificador',
  timeZone: 'Fuso horário',
  legalName: 'Razão social',
  document: 'CPF ou CNPJ',
  contactEmail: 'E-mail de contato',
  contactPhone: 'Telefone',
  internalNotes: 'Observações internas',
  displayName: 'Nome de exibição',
  primary: 'Cor principal',
  accent: 'Cor de destaque',
  material: 'Material da capa',
  paper: 'Tom do papel',
  fontPair: 'Par de fontes',
  loginMessage: 'Mensagem da tela de entrada',
  professionalSingular: 'Profissional (singular)',
  professionalPlural: 'Profissional (plural)',
  customerSingular: 'Cliente (singular)',
  customerPlural: 'Cliente (plural)',
  pointsSingular: 'Pontos (singular)',
  pointsPlural: 'Pontos (plural)',
  club: 'Clube',
  vouchers: 'Vouchers',
  store: 'Loja',
  slotStepMin: 'Grade de horários',
  minLeadMin: 'Antecedência mínima',
  maxAdvanceDays: 'Alcance da agenda',
  customerChangeWindowMin: 'Prazo para o cliente mudar',
  bufferMin: 'Intervalo entre atendimentos',
  ownerName: 'Nome do dono',
  ownerEmail: 'E-mail do dono',
  keyName: 'Nome da chave',
}

const PAPEIS: Array<[PaperTone, string]> = [
  ['WHITE', 'Branco'],
  ['CREAM', 'Creme'],
  ['GRAY', 'Cinza'],
]
const FONTES: Array<[FontPair, string, string]> = [
  ['CLASSIC', 'Clássico', 'Títulos com serifa de livro-caixa.'],
  ['MODERN', 'Moderno', 'Títulos sem serifa, de traço limpo.'],
  ['FRIENDLY', 'Amigável', 'Títulos de cantos redondos.'],
]
const GRADES = [5, 10, 15, 20, 30, 60]

type Estado = FormState<WizardData>

/**
 * Assistente de nova conta. Todas as etapas são seções do MESMO formulário: sem JavaScript viram um formulário longo que
 * envia tudo de uma vez; com JavaScript mostra uma etapa por vez, com o trilho no alto e a prévia da marca ao lado.
 * Os campos são controlados (o estado sobrevive a erro de validação) e a conta só é criada no envio final.
 */
export function Wizard({ initial }: { initial: Estado }) {
  // "Criar outra conta" troca a chave e o assistente recomeça do zero (estado, ação e campos).
  const [rodada, setRodada] = useState(0)
  return <AssistenteDeConta key={rodada} initial={initial} onAgain={() => setRodada((r) => r + 1)} />
}

function AssistenteDeConta({ initial, onAgain }: { initial: Estado; onAgain: () => void }) {
  const [state, formAction, pending] = useActionState(criarConta, initial)
  const hidratado = useHydrated()
  const [v, setV] = useState<WizardValues>(() => pickValues(initial.values))
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [visto, setVisto] = useState<Estado>(state)
  const [slugManual, setSlugManual] = useState(() => initial.values.slug !== '' && initial.values.slug !== slugify(initial.values.name))
  const [nomeManual, setNomeManual] = useState(() => initial.values.displayName !== '' && initial.values.displayName !== initial.values.name)
  const [chaveManual, setChaveManual] = useState(() => initial.values.keyName !== '')
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
      ...(chaveManual ? {} : { keyName: valor.trim() ? `App ${valor.trim()}` : '' }),
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
    <Paper raised={1} className="af-wizard">
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
                hint={v.slug ? `O link de entrada termina em /entrar/${v.slug}.` : 'Letras minúsculas, números e hífens. Vira o final do link de entrada.'}
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
              <Field label="Fuso horário" hint="Os horários da agenda seguem este fuso." error={erro('timeZone')}>
                <Select name="timeZone" value={v.timeZone} onChange={texto('timeZone')}>
                  {FUSOS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="E-mail de contato (opcional)" error={erro('contactEmail')}>
                <Input name="contactEmail" type="email" inputMode="email" value={v.contactEmail} onChange={texto('contactEmail')} autoComplete="off" />
              </Field>
              <Field label="Telefone (opcional)" error={erro('contactPhone')}>
                <Input name="contactPhone" type="tel" inputMode="tel" value={v.contactPhone} onChange={texto('contactPhone')} autoComplete="off" />
              </Field>
              <Field label="Razão social (opcional)" error={erro('legalName')}>
                <Input name="legalName" value={v.legalName} onChange={texto('legalName')} autoComplete="off" />
              </Field>
              <Field label="CPF ou CNPJ (opcional)" error={erro('document')}>
                <Input name="document" value={v.document} onChange={texto('document')} autoComplete="off" inputMode="text" />
              </Field>
            </div>
            <Field label="Observações internas (opcional)" hint="Só a equipe da plataforma vê." error={erro('internalNotes')}>
              <Textarea name="internalNotes" value={v.internalNotes} onChange={texto('internalNotes')} rows={3} />
            </Field>
          </Etapa>

          <Etapa i={1} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Marca" ajuda="Cores, material da capa, papel e fonte. A prévia ao lado muda na hora, sem enviar nada.">
            <div className="af-wizard__grid">
              <Field label="Nome de exibição" hint="Aparece na capa do painel e nos e-mails." error={erro('displayName')}>
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
              <p className="af-wizard__note">A logo, o símbolo, o favicon e a imagem de entrada você envia na aba Marca da conta, logo depois de criá-la.</p>
              <ColorField label="Cor principal" name="primary" value={v.primary} onChange={(c) => set('primary', c)} {...opcional('error', erro('primary'))} {...opcional('warning', avisoDe(warnings, 'primary'))} />
              <ColorField label="Cor de destaque" name="accent" value={v.accent} onChange={(c) => set('accent', c)} {...opcional('error', erro('accent'))} {...opcional('warning', avisoDe(warnings, 'accent'))} />
            </div>
            <MaterialPicker
              name="material"
              value={v.material}
              onChange={(m) => set('material', m)}
              primary={v.primary}
              accent={v.accent}
              paper={v.paper}
              fontPair={v.fontPair}
            />
            <div className="af-wizard__grid">
              <Field label="Tom do papel" error={erro('paper')}>
                <Select name="paper" value={v.paper} onChange={texto('paper')}>
                  {PAPEIS.map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Par de fontes" hint={FONTES.find(([f]) => f === v.fontPair)?.[2]} error={erro('fontPair')}>
                <Select name="fontPair" value={v.fontPair} onChange={texto('fontPair')}>
                  {FONTES.map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Mensagem da tela de entrada (opcional)" hint="Uma frase de boas-vindas acima do formulário de entrada." error={erro('loginMessage')}>
              <Textarea name="loginMessage" value={v.loginMessage} onChange={texto('loginMessage')} rows={2} />
            </Field>
          </Etapa>

          <Etapa i={2} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Termos" ajuda="Como esta conta chama as pessoas e os pontos. Aparecem nas telas, nos e-mails e na API.">
            <div className="af-wizard__presets" role="group" aria-label="Sugestões por ramo">
              <span className="af-wizard__presets-label">Preencher com sugestão:</span>
              {TERM_PRESETS.map((p) => (
                <Button key={p.label} size="sm" onClick={() => setV((x) => ({ ...x, ...p.terms }))}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="af-wizard__grid">
              <Field label="Profissional (singular)" error={erro('professionalSingular')}>
                <Input name="professionalSingular" value={v.professionalSingular} onChange={texto('professionalSingular')} autoComplete="off" />
              </Field>
              <Field label="Profissional (plural)" error={erro('professionalPlural')}>
                <Input name="professionalPlural" value={v.professionalPlural} onChange={texto('professionalPlural')} autoComplete="off" />
              </Field>
              <Field label="Cliente (singular)" error={erro('customerSingular')}>
                <Input name="customerSingular" value={v.customerSingular} onChange={texto('customerSingular')} autoComplete="off" />
              </Field>
              <Field label="Cliente (plural)" error={erro('customerPlural')}>
                <Input name="customerPlural" value={v.customerPlural} onChange={texto('customerPlural')} autoComplete="off" />
              </Field>
              <Field label="Pontos (singular)" error={erro('pointsSingular')}>
                <Input name="pointsSingular" value={v.pointsSingular} onChange={texto('pointsSingular')} autoComplete="off" />
              </Field>
              <Field label="Pontos (plural)" error={erro('pointsPlural')}>
                <Input name="pointsPlural" value={v.pointsPlural} onChange={texto('pointsPlural')} autoComplete="off" />
              </Field>
              <Field label="Clube" hint="O nome do programa de fidelidade." error={erro('club')}>
                <Input name="club" value={v.club} onChange={texto('club')} autoComplete="off" />
              </Field>
            </div>
          </Etapa>

          <Etapa i={3} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Módulos" ajuda="O que esta conta usa além da agenda. Módulo desligado some do menu, das telas e da API.">
            <div className="af-wizard__checks">
              <Checkbox name="loyalty" label="Fidelidade: pontos e prêmios" checked={v.loyalty} onChange={(e) => set('loyalty', e.target.checked)} />
              <Checkbox name="banners" label="Banners: avisos e promoções no app" checked={v.banners} onChange={(e) => set('banners', e.target.checked)} />
              <Checkbox name="store" label="Loja: produtos e pedidos" checked={v.store} onChange={(e) => set('store', e.target.checked)} />
              <Checkbox name="vouchers" label="Vouchers: vendidos dentro de um pedido da Loja" checked={v.vouchers} onChange={(e) => set('vouchers', e.target.checked)} />
            </div>
            {v.vouchers && !v.store ? (
              <p className="af-wizard__note" role="status">
                Vouchers só funcionam com a Loja ligada. Ligue a Loja ou desligue Vouchers antes de criar a conta.
              </p>
            ) : null}
            {erro('vouchers') ? <p className="af-field__error">{erro('vouchers')}</p> : null}
          </Etapa>

          <Etapa i={4} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Regras de agenda" ajuda="Os valores começam no padrão do sistema. O dono pode ajustá-los depois.">
            <div className="af-wizard__grid">
              <Field label="Grade de horários" hint="De quanto em quanto tempo um horário pode começar." error={erro('slotStepMin')}>
                <Select name="slotStepMin" value={v.slotStepMin} onChange={texto('slotStepMin')}>
                  {GRADES.map((g) => (
                    <option key={g} value={String(g)}>
                      {g} minutos
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Intervalo entre atendimentos (minutos)" hint="Múltiplo de 5, até 120." error={erro('bufferMin')}>
                <Input name="bufferMin" type="number" inputMode="numeric" min={0} max={120} step={5} value={v.bufferMin} onChange={texto('bufferMin')} />
              </Field>
              <Field label="Antecedência mínima (minutos)" hint="Quanto antes do horário o cliente ainda pode marcar." error={erro('minLeadMin')}>
                <Input name="minLeadMin" type="number" inputMode="numeric" min={0} max={10080} value={v.minLeadMin} onChange={texto('minLeadMin')} />
              </Field>
              <Field label="Alcance da agenda (dias)" hint="Até quantos dias à frente se pode marcar." error={erro('maxAdvanceDays')}>
                <Input name="maxAdvanceDays" type="number" inputMode="numeric" min={1} max={365} value={v.maxAdvanceDays} onChange={texto('maxAdvanceDays')} />
              </Field>
              <Field label="Prazo para o cliente mudar (minutos)" hint="Até quanto tempo antes o cliente pode remarcar ou cancelar." error={erro('customerChangeWindowMin')}>
                <Input name="customerChangeWindowMin" type="number" inputMode="numeric" min={0} max={10080} value={v.customerChangeWindowMin} onChange={texto('customerChangeWindowMin')} />
              </Field>
            </div>
            <Checkbox name="autoConfirm" label="Confirmar os agendamentos sozinho" checked={v.autoConfirm} onChange={(e) => set('autoConfirm', e.target.checked)} />
          </Etapa>

          <Etapa i={5} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Dono da conta" ajuda="Quem manda na conta. Se o e-mail já tem cadastro, a pessoa é vinculada sem trocar a senha e recebe um aviso de acesso novo. Senão, recebe o convite para definir a senha.">
            <div className="af-wizard__grid">
              <Field label="Nome do dono" error={erro('ownerName')}>
                <Input name="ownerName" value={v.ownerName} onChange={texto('ownerName')} autoComplete="off" />
              </Field>
              <Field label="E-mail do dono" error={erro('ownerEmail')}>
                <Input name="ownerEmail" type="email" inputMode="email" value={v.ownerEmail} onChange={texto('ownerEmail')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </Field>
            </div>
          </Etapa>

          <Etapa i={6} step={step} hidratado={hidratado} tituloRef={tituloRef} titulo="Chave de app" ajuda="A chave que o aplicativo desta conta usa para falar com a API. O segredo aparece uma única vez, na tela seguinte.">
            <Checkbox name="createKey" label="Criar a chave de app agora" checked={v.createKey} onChange={(e) => set('createKey', e.target.checked)} />
            {v.createKey ? (
              <Field label="Nome da chave" hint="Só para você reconhecer a chave na lista." error={erro('keyName')}>
                <Input
                  name="keyName"
                  value={v.keyName}
                  onChange={(e) => {
                    setChaveManual(true)
                    set('keyName', e.target.value)
                  }}
                  autoComplete="off"
                />
              </Field>
            ) : (
              <p className="af-wizard__note">Sem a chave, o aplicativo ainda não consegue entrar. Você cria uma depois, na página da conta.</p>
            )}
            <dl className="af-wizard__summary" aria-label="Resumo do que será criado">
              <dt>Conta</dt>
              <dd>{v.name || 'Sem nome ainda'}{v.slug ? ` (${v.slug})` : ''}</dd>
              <dt>Marca</dt>
              <dd>{v.displayName || 'Sem nome de exibição'}</dd>
              <dt>Dono</dt>
              <dd>{v.ownerEmail || 'Sem e-mail ainda'}</dd>
              <dt>Módulos</dt>
              <dd>{[v.loyalty && 'Fidelidade', v.banners && 'Banners', v.store && 'Loja', v.vouchers && 'Vouchers'].filter(Boolean).join(', ') || 'Só a agenda'}</dd>
              <dt>Chave de app</dt>
              <dd>{v.createKey ? 'Sim' : 'Não'}</dd>
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
          <aside aria-label="Prévia ao vivo da marca" className="af-wizard__aside">
            <BrandPreview
              businessName={v.displayName || v.name}
              brand={{ primary: v.primary, accent: v.accent, material: v.material, paper: v.paper, fontPair: v.fontPair }}
              terms={v}
            />
          </aside>
        ) : null}
      </form>
    </Paper>
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

/** Tela final: o link de entrada, o estado do convite, o que faltou (se faltou) e o segredo da chave, uma única vez. */
function Concluida({ result, onAgain }: { result: WizardResult; onAgain: () => void }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titulo.current?.focus()
  }, [])
  return (
    <Paper raised={2} className="af-done">
      <div className="af-done__head">
        <h2 ref={titulo} tabIndex={-1} className="af-done__title">
          {result.businessName} está criada
        </h2>
        <Stamp tone={result.pendencias.length > 0 ? 'warn' : 'ok'}>{result.pendencias.length > 0 ? 'Quase pronta' : 'Pronta'}</Stamp>
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

      <div className="af-done__row">
        <span className="af-done__label">Link de entrada da conta</span>
        <span className="af-entrylink">
          <span className="af-entrylink__url">{result.entryUrl}</span>
          <CopyButton text={result.entryUrl} label="Copiar link de entrada" />
        </span>
      </div>

      <p className="af-wizard__note">
        {result.ownerExisting
          ? `${result.ownerEmail} já tinha cadastro: foi vinculado à conta sem trocar a senha${result.emailSent ? ' e recebeu um aviso de acesso novo.' : '. O aviso por e-mail não saiu; avise a pessoa pelo link acima.'}`
          : result.emailSent
            ? `Enviamos para ${result.ownerEmail} o convite para definir a senha.`
            : `O convite para ${result.ownerEmail} não saiu por e-mail. Reenvie o convite na página da conta.`}
      </p>

      {result.secret ? (
        <div className="af-secret">
          <p className="af-secret__warn">Copie a chave de app agora. Ela não será mostrada de novo.</p>
          <span className="af-done__label">{result.keyName ?? 'Chave de app'}</span>
          <code className="af-secret__code">{result.secret}</code>
          <CopyButton text={result.secret} label="Copiar chave de app" variant="primary" />
        </div>
      ) : null}

      <div className="af-done__actions">
        <LinkButton href={`/contas/${result.createdId}`} variant="primary">
          Abrir a conta
        </LinkButton>
        <LinkButton href={`/contas/${result.createdId}/marca`}>Enviar a logo e as imagens</LinkButton>
        <Button icon={<Plus size={18} />} onClick={onAgain}>
          Criar outra conta
        </Button>
      </div>
    </Paper>
  )
}
