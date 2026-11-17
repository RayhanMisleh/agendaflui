'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarPlus, CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgendaPage } from '@/server/domain/scheduling/agenda-page'
import { Button, Card, EmptyHint, EmptyState, NavTabs, PlannerDay, PlannerWeek } from '@/ui/components'
import { labelOfMinute } from '@/ui/components'
import { formatLocalDate, shortDate, weekdayName } from '@/ui/format'
import { AppointmentSheet } from './AppointmentSheet'
import { BlockSheet } from './BlockSheet'
import { BookingSheet } from './BookingSheet'
import { ConfirmarRemarcacao } from './ConfirmarRemarcacao'
import type { AlvoRemarcar } from './ConfirmarRemarcacao'
import { RescheduleSheet } from './RescheduleSheet'
import type { Prefill, TermosAgenda } from './BookingSheet'

type Aberta = { tipo: 'marcar'; prefill: Prefill } | { tipo: 'bloquear' } | { tipo: 'ficha'; id: string } | { tipo: 'remarcar'; id: string } | { tipo: 'confirmar'; alvo: AlvoRemarcar } | null

/** Endereço da agenda para uma visão, uma data e um profissional. A URL é quem define o que se vê. */
export function agendaHref(o: { visao: 'dia' | 'semana'; data: string; profissional: string }): string {
  const q = new URLSearchParams({ visao: o.visao, data: o.data })
  if (o.profissional !== 'todos') q.set('profissional', o.profissional)
  return `/agenda?${q.toString()}`
}

const PLURAL = (n: number) => `${n} ${n === 1 ? 'atendimento' : 'atendimentos'}`

/**
 * A tela da agenda: barra de visão, dia e profissional (tudo links, a URL manda), a grade do dia ou a semana e as folhas de
 * marcar, bloquear e abrir a ficha. As ações revalidam a página; o que muda chega de novo como propriedade.
 */
export function AgendaPainel({ page, termos, abrir, podeBloquear, podeCadastrar }: { page: AgendaPage; termos: TermosAgenda; abrir: 'marcar' | 'bloquear' | null; podeBloquear: boolean; podeCadastrar: boolean }) {
  const router = useRouter()
  const prefillBase: Prefill = { professionalId: page.scope === 'own' ? (page.ownProfessionalId ?? '') : page.filter !== 'todos' ? page.filter : '', date: page.view === 'dia' || page.date >= page.today ? page.date : page.today, time: '' }
  const [aberta, setAberta] = useState<Aberta>(abrir === 'marcar' ? { tipo: 'marcar', prefill: prefillBase } : abrir === 'bloquear' && podeBloquear ? { tipo: 'bloquear' } : null)

  const href = (o: Partial<{ visao: 'dia' | 'semana'; data: string; profissional: string }>) => agendaHref({ visao: page.view, data: page.date, profissional: page.filter, ...o })
  const fechar = () => {
    setAberta(null)
    if (abrir !== null) router.replace(href({}))
  }

  if (page.unlinked) {
    return (
      <Card as="section" aria-label="Agenda">
        <EmptyState title="Seu acesso ainda não tem ficha" description={`Peça ao dono da conta para ligar seu acesso a uma ficha de ${termos.professionalSingular.toLowerCase()}. Depois disso, a sua agenda aparece aqui.`} />
      </Card>
    )
  }

  const tituloDia = page.view === 'dia' ? `${weekdayName(page.weekday)}, ${formatLocalDate(page.date)}` : `Semana de ${shortDate(page.week?.[0]?.date ?? page.date)} a ${shortDate(page.week?.[6]?.date ?? page.date)}`
  const detalhe = aberta?.tipo === 'ficha' ? (page.details[aberta.id] ?? null) : null
  const resumo = page.day?.summary

  return (
    <div className="af-agenda">
      <Card as="section" aria-label="Escolher o que ver" className="af-agenda__bar">
        <div className="af-agenda__nav">
          <Link href={href({ data: page.prevDate })} className="af-button af-button--secondary af-button--md" aria-label={page.view === 'dia' ? 'Dia anterior' : 'Semana anterior'}>
            <span className="af-button__label">
              <ChevronLeft size={18} aria-hidden="true" />
            </span>
          </Link>
          <Link href={href({ data: page.today })} className="af-button af-button--secondary af-button--md">
            <span className="af-button__label">Hoje</span>
          </Link>
          <Link href={href({ data: page.nextDate })} className="af-button af-button--secondary af-button--md" aria-label={page.view === 'dia' ? 'Próximo dia' : 'Próxima semana'}>
            <span className="af-button__label">
              <ChevronRight size={18} aria-hidden="true" />
            </span>
          </Link>
          <h2 className="af-agenda__title">{tituloDia}</h2>
        </div>
        <NavTabs
          label="Visão da agenda"
          items={[
            { id: 'dia', label: 'Dia', href: href({ visao: 'dia' }), active: page.view === 'dia' },
            { id: 'semana', label: 'Semana', href: href({ visao: 'semana' }), active: page.view === 'semana' },
          ]}
        />
        {page.scope === 'all' && page.professionals.length > 1 ? (
          <NavTabs
            label={termos.professionalPlural}
            items={[
              { id: 'todos', label: 'Todos', href: href({ profissional: 'todos' }), active: page.filter === 'todos' },
              ...page.professionals.map((p) => ({ id: p.id, label: p.name, href: href({ profissional: p.id }), active: page.filter === p.id })),
            ]}
          />
        ) : null}
        <div className="af-agenda__actions">
          <Button variant="primary" icon={<CalendarPlus size={18} />} onClick={() => setAberta({ tipo: 'marcar', prefill: prefillBase })}>
            Marcar horário
          </Button>
          {podeBloquear ? (
            <Button variant="secondary" icon={<CalendarX2 size={18} />} onClick={() => setAberta({ tipo: 'bloquear' })}>
              Bloquear horário
            </Button>
          ) : null}
        </div>
      </Card>

      {page.view === 'dia' && page.day ? (
        <Card as="section" aria-label="Agenda do dia" className="af-agenda__card">
          {resumo ? (
            <p className="af-agenda__summary">
              {resumo.total === 0 ? 'Nenhum atendimento neste dia.' : `${PLURAL(resumo.total)}${resumo.completed > 0 ? `, ${resumo.completed} concluído${resumo.completed === 1 ? '' : 's'}` : ''}`}
              {resumo.occupancy !== null ? ` · ${Math.round(resumo.occupancy * 100)}% da agenda ocupada` : ''}
            </p>
          ) : null}
          {page.closed.closed ? <p className="af-planner__warn">Dia fechado{page.closed.reason ? `: ${page.closed.reason}` : ''}. Você ainda pode marcar, se precisar.</p> : null}
          {page.day.columns.length === 0 ? (
            <EmptyHint>Nenhum {termos.professionalSingular.toLowerCase()} na agenda deste dia.</EmptyHint>
          ) : (
            <PlannerDay
              columns={page.day.columns}
              startMin={page.day.startMin}
              endMin={page.day.endMin}
              hours={page.day.hours}
              nowMin={page.day.nowMin}
              label={`Agenda de ${tituloDia}`}
              step={page.step}
              canCross={page.scope === 'all'}
              onMove={(id, alvo) => {
                const nome = page.day?.columns.find((c) => c.id === alvo.professionalId)?.name ?? ''
                setAberta({ tipo: 'confirmar', alvo: { id, professionalId: alvo.professionalId, professionalName: nome, date: page.date, startLabel: labelOfMinute(alvo.startMin) } })
              }}
              onOpenSlip={(id) => setAberta({ tipo: 'ficha', id })}
              onBookGap={(professionalId, startMin) => {
                const coluna = page.day?.columns.find((c) => c.id === professionalId)
                const vaga = coluna?.gaps.find((g) => g.startMin === startMin)
                setAberta({ tipo: 'marcar', prefill: { professionalId, date: page.date, time: vaga?.startLabel ?? '' } })
              }}
            />
          )}
        </Card>
      ) : null}

      {page.view === 'semana' && page.week ? (
        <Card as="section" aria-label="Agenda da semana" className="af-agenda__card">
          <PlannerWeek days={page.week} hrefFor={(data) => href({ visao: 'dia', data })} label={tituloDia} />
        </Card>
      ) : null}

      <BookingSheet open={aberta?.tipo === 'marcar'} onClose={fechar} page={page} prefill={aberta?.tipo === 'marcar' ? aberta.prefill : prefillBase} termos={termos} podeCadastrar={podeCadastrar} />
      {podeBloquear ? <BlockSheet open={aberta?.tipo === 'bloquear'} onClose={fechar} page={page} professionalSingular={termos.professionalSingular} /> : null}
      <AppointmentSheet detalhe={detalhe} page={page} onClose={fechar} onReschedule={(id) => setAberta({ tipo: 'remarcar', id })} />
      <RescheduleSheet detalhe={aberta?.tipo === 'remarcar' ? (page.details[aberta.id] ?? null) : null} page={page} professionalSingular={termos.professionalSingular} onClose={fechar} />
      <ConfirmarRemarcacao alvo={aberta?.tipo === 'confirmar' ? aberta.alvo : null} detalhe={aberta?.tipo === 'confirmar' ? (page.details[aberta.alvo.id] ?? null) : null} onClose={fechar} />
    </div>
  )
}
