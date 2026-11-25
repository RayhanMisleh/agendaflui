import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { quizStepDef, type QuizAnswers, type QuizStepKey } from '../quiz'

/** Uma pergunta do quiz: o título (que recebe o foco ao entrar), a dica, o conteúdo e o erro em `role="alert"`. */
export function Pergunta({ step, hint, error, children }: { step: QuizStepKey; hint?: string; error: string | null; children: ReactNode }) {
  return (
    <section className="af-cl-quiz__question" aria-labelledby={`quiz-${step}`}>
      <h2 id={`quiz-${step}`} tabIndex={-1} className="af-cl-quiz__title">
        {quizStepDef(step).title}
      </h2>
      {hint ? <p className="af-cl-quiz__hint">{hint}</p> : null}
      {children}
      {error ? (
        <p role="alert" className="af-cl-quiz__error">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </section>
  )
}

export type PassoProps = {
  a: QuizAnswers
  set: (patch: Partial<QuizAnswers>) => void
  error: string | null
}
