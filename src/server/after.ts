import 'server-only'
import { after } from 'next/server'

type Scheduler = (task: () => Promise<void>) => void

// `undefined`: usa o `after` do Next; os testes instalam um coletor (o `after` lança fora de uma requisição real).
let injected: Scheduler | undefined

/** Ponto de injeção explícito, no estilo de `setEmailChannel`: só os testes chamam. `undefined` volta ao `after` do Next. */
export function setAfterScheduler(scheduler: Scheduler | undefined): void {
  injected = scheduler
}

/**
 * Agenda `fn` para depois da resposta (o Next executa `after` com a resposta já enviada). Serve para tudo que depende de
 * o e-mail existir: assim o tempo da resposta é o mesmo nos dois casos. Erro é capturado e registrado só com o nome do
 * erro, sem dado pessoal; nunca chega a quem chamou.
 */
export function runAfterResponse(fn: () => Promise<void>): void {
  const task = async (): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'after_response_failed', error: err instanceof Error ? err.name : 'unknown' }))
    }
  }
  if (injected) injected(task)
  else after(task)
}
