'use client'
import { useEffect, useReducer, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { Button, Card, Celebration, ProgressBar, StepStage, useToast } from '@/ui/components'
import { Cuidados } from './_passos/Cuidados'
import { Especie } from './_passos/Especie'
import { Foto } from './_passos/Foto'
import { Idade } from './_passos/Idade'
import { Nome } from './_passos/Nome'
import { Pelagem } from './_passos/Pelagem'
import { Porte } from './_passos/Porte'
import { Raca } from './_passos/Raca'
import { Resumo } from './_passos/Resumo'
import { initialQuiz, quizReducer, quizStepDef, toPetInput, type QuizAnswers, type SalvarPetResultado } from './quiz'

/** Tempo da celebração antes de seguir para a próxima tela. */
const CELEBRACAO_MS = 1600

/**
 * O quiz do pet: uma pergunta por tela, barra de progresso, "Pular" nas opcionais e o resumo no fim. O estado todo mora no
 * redutor puro (`quiz.ts`); aqui só se desenha e se grava. A foto sobe depois do pet salvo (rota de arquivo): se falhar, o
 * pet fica e um aviso diz onde tentar de novo.
 */
export function QuizPet({
  slug,
  servesCats,
  today,
  firstName,
  welcome,
  back,
  salvar,
}: {
  slug: string
  servesCats: boolean
  today: string
  firstName: string | null
  welcome: boolean
  back: string | null
  salvar: (fd: FormData) => Promise<SalvarPetResultado>
}) {
  const router = useRouter()
  const avisar = useToast()
  const [state, dispatch] = useReducer(quizReducer, servesCats, initialQuiz)
  const [comecou, setComecou] = useState(!welcome)
  const [salvando, setSalvando] = useState<'agendar' | 'outro' | null>(null)
  const [recusa, setRecusa] = useState<string | null>(null)
  const [feito, setFeito] = useState<{ next: string; name: string; then: 'agendar' | 'outro' } | null>(null)
  const emVoo = useRef(false)

  const step = state.steps[state.index] ?? 'name'
  const def = quizStepDef(step)
  const a = state.answers
  const set = (patch: Partial<QuizAnswers>) => dispatch({ type: 'set', patch })

  useEffect(() => {
    if (!feito) return
    const t = setTimeout(() => {
      if (feito.then === 'outro') {
        dispatch({ type: 'restart' })
        setFeito(null)
        setComecou(true)
      }
      router.push(feito.next)
    }, CELEBRACAO_MS)
    return () => clearTimeout(t)
  }, [feito, router])

  async function gravar(then: 'agendar' | 'outro') {
    if (emVoo.current) return
    emVoo.current = true
    setSalvando(then)
    setRecusa(null)
    try {
      const input = toPetInput(a, today)
      const fd = new FormData()
      fd.set('name', input.name)
      fd.set('species', input.species)
      fd.set('size', input.size ?? '')
      fd.set('breed', input.breed ?? '')
      fd.set('birthMonth', input.birthMonth ?? '')
      fd.set('coat', input.coat ?? '')
      fd.set('careNotes', input.careNotes ?? '')
      fd.set('then', then)
      fd.set('volta', back ?? '')
      const r = await salvar(fd)
      if (!r.ok) {
        setRecusa(r.message)
        return
      }
      if (a.photo) {
        const ok = await enviarFoto(slug, r.petId, a.photo)
        if (!ok) avisar({ tone: 'warning', message: 'Pet salvo. Não deu para enviar a foto; tente de novo em Meus pets.' })
      }
      setFeito({ next: r.next, name: input.name, then })
    } catch {
      setRecusa('Não foi possível salvar agora. Confira sua conexão e tente de novo.')
    } finally {
      emVoo.current = false
      setSalvando(null)
    }
  }

  function aoEnviar(e: FormEvent) {
    e.preventDefault()
    if (step !== 'summary') dispatch({ type: 'next' })
  }

  if (feito) {
    return (
      <section className="af-cl-quiz af-cl-quiz--done" aria-live="polite">
        <Celebration play />
        <h2 className="af-cl-quiz__title">{feito.name} está pronto</h2>
        <p className="af-cl-quiz__hint">{feito.then === 'outro' ? 'Vamos para o próximo pet.' : 'Vamos escolher o horário.'}</p>
        <Link href={feito.next} className="af-cl-quiz__skiplink">
          Continuar
        </Link>
      </section>
    )
  }

  if (!comecou) {
    return (
      <section className="af-cl-quiz af-cl-quiz--welcome">
        <Card variant="block" bubbles className="af-cl-quiz__welcome">
          <h2 className="af-cl-quiz__welcome-title">{firstName ? `Boas-vindas, ${firstName}` : 'Boas-vindas'}</h2>
          <p className="af-cl-quiz__welcome-text">Conte sobre o seu pet. Leva um minuto.</p>
          <Button variant="accent" size="lg" onClick={() => setComecou(true)}>
            Começar
          </Button>
        </Card>
      </section>
    )
  }

  const primeiro = state.index === 0
  const semPorte = step === 'size' && a.size === null

  return (
    <form className="af-cl-quiz" onSubmit={aoEnviar} noValidate>
      <div className="af-cl-quiz__top">
        {primeiro ? (
          <Link href={back ?? `/${slug}`} className="af-cl-quiz__back" aria-label="Sair do cadastro">
            <ChevronLeft size={22} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" className="af-cl-quiz__back" aria-label="Voltar" onClick={() => dispatch({ type: 'back' })}>
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        )}
        <ProgressBar value={state.index + 1} max={state.steps.length} label="Progresso do cadastro do pet" />
      </div>
      <StepStage stepKey={step} direction={state.direction}>
        {step === 'name' ? <Nome a={a} set={set} error={state.error} /> : null}
        {step === 'species' ? <Especie a={a} set={set} error={state.error} /> : null}
        {step === 'size' ? <Porte a={a} set={set} error={state.error} /> : null}
        {step === 'breed' ? <Raca a={a} set={set} error={state.error} /> : null}
        {step === 'age' ? <Idade a={a} set={set} error={state.error} onNaoSei={() => dispatch({ type: 'skip' })} /> : null}
        {step === 'coat' ? <Pelagem a={a} set={set} error={state.error} /> : null}
        {step === 'care' ? <Cuidados a={a} set={set} error={state.error} /> : null}
        {step === 'photo' ? <Foto a={a} set={set} error={state.error} /> : null}
        {step === 'summary' ? (
          <Resumo a={a} steps={state.steps} error={recusa ?? state.error} onMudar={(s) => dispatch({ type: 'goto', step: s })} onSalvar={gravar} salvando={salvando} />
        ) : null}
      </StepStage>
      {step === 'summary' ? null : (
        <div className="af-cl-quiz__foot">
          {def.optional ? (
            <Button variant="ghost" size="lg" onClick={() => dispatch({ type: 'skip' })}>
              Pular
            </Button>
          ) : null}
          <Button type="submit" variant="primary" size="lg" disabled={semPorte}>
            Continuar
          </Button>
        </div>
      )}
    </form>
  )
}

/** Sobe a foto para a rota do pet; `false` se a rota recusar ou a rede falhar (o pet já está salvo). */
async function enviarFoto(slug: string, petId: string, foto: File): Promise<boolean> {
  try {
    const fd = new FormData()
    fd.set('foto', foto)
    const r = await fetch(`/${slug}/pets/${petId}/foto`, { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
    if (!r.ok) return false
    const corpo: unknown = await r.json()
    return typeof corpo === 'object' && corpo !== null && 'ok' in corpo && corpo.ok === true
  } catch {
    return false
  }
}
