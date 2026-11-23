'use client'
import Link from 'next/link'
import { useId } from 'react'
import { Checkbox, Field, Input, MaskedInput, Select } from '@/ui/components'
import { ContaForm } from './ContaForm'
import { estadoInicial } from './forms'
import type { AcaoConta, Campos } from './forms'

/** Dados cadastrais: a versão vem do servidor a cada carga; versão velha vira o aviso de conflito. */
export function DadosForm({ action, valores }: { action: AcaoConta; valores: Campos }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar dados">
      {({ values: v, fields }) => (
        <>
          <div className="af-wizard__grid">
            <Field label="Nome da conta" error={fields.name}>
              <Input name="name" defaultValue={v.name} autoComplete="off" />
            </Field>
            <Field label="Identificador" hint="Letras minúsculas, números e hífens." error={fields.slug}>
              <Input name="slug" defaultValue={v.slug} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="E-mail de contato" error={fields.contactEmail}>
              <Input name="contactEmail" type="email" inputMode="email" defaultValue={v.contactEmail} autoComplete="off" />
            </Field>
            <Field label="Telefone" error={fields.contactPhone}>
              <MaskedInput mask="phone" name="contactPhone" defaultValue={v.contactPhone} />
            </Field>
            <Field label="CPF ou CNPJ" error={fields.document}>
              <MaskedInput mask="document" name="document" defaultValue={v.document} />
            </Field>
          </div>
        </>
      )}
    </ContaForm>
  )
}

export function TermosForm({ action, valores }: { action: AcaoConta; valores: Campos }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar termos">
      {({ values: v, fields }) => (
        <div className="af-wizard__grid">
          <Field label="Profissional (singular)" error={fields.professionalSingular}>
            <Input name="professionalSingular" defaultValue={v.professionalSingular} autoComplete="off" />
          </Field>
          <Field label="Profissional (plural)" error={fields.professionalPlural}>
            <Input name="professionalPlural" defaultValue={v.professionalPlural} autoComplete="off" />
          </Field>
          <Field label="Cliente (singular)" error={fields.customerSingular}>
            <Input name="customerSingular" defaultValue={v.customerSingular} autoComplete="off" />
          </Field>
          <Field label="Cliente (plural)" error={fields.customerPlural}>
            <Input name="customerPlural" defaultValue={v.customerPlural} autoComplete="off" />
          </Field>
          <Field label="Pontos (singular)" error={fields.pointsSingular}>
            <Input name="pointsSingular" defaultValue={v.pointsSingular} autoComplete="off" />
          </Field>
          <Field label="Pontos (plural)" error={fields.pointsPlural}>
            <Input name="pointsPlural" defaultValue={v.pointsPlural} autoComplete="off" />
          </Field>
          <Field label="Clube" hint="O nome do programa de fidelidade." error={fields.club}>
            <Input name="club" defaultValue={v.club} autoComplete="off" />
          </Field>
        </div>
      )}
    </ContaForm>
  )
}

/** O que está em andamento na conta, como a página lê (`getModuleUsage`). */
export type UsoDosModulos = { openOrders: number; pendingRedemptions: number; mercadoPagoConfigured: boolean }

const plural = (n: number, um: string, varios: string): string => (n === 1 ? `1 ${um}` : `${String(n)} ${varios}`)

/** A frase do que está em andamento num módulo; `null` quando não há nada a dizer (Banners não tem andamento). */
function andamento(modulo: 'loyalty' | 'store', uso: UsoDosModulos): string {
  if (modulo === 'store') return uso.openOrders === 0 ? 'Nenhum pedido pago a entregar.' : `${plural(uso.openOrders, 'pedido pago a entregar', 'pedidos pagos a entregar')}.`
  return uso.pendingRedemptions === 0 ? 'Nenhum resgate a entregar.' : `${plural(uso.pendingRedemptions, 'resgate a entregar', 'resgates a entregar')}.`
}

export function ModulosForm({ action, valores, businessId, uso }: { action: AcaoConta; valores: Campos; businessId: string; uso: UsoDosModulos }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar módulos">
      {({ values: v }) => <ModulosCampos v={v} businessId={businessId} uso={uso} />}
    </ContaForm>
  )
}

function ModulosCampos({ v, businessId, uso }: { v: Campos; businessId: string; uso: UsoDosModulos }) {
  const uid = useId()
  const semMercadoPago = v.store === 'on' && !uso.mercadoPagoConfigured
  return (
    <div className="af-wizard__checks">
      <Checkbox name="loyalty" label="Fidelidade: pontos e prêmios" defaultChecked={v.loyalty === 'on'} aria-describedby={`${uid}-loyalty`} />
      <p id={`${uid}-loyalty`} className="af-wizard__note">
        Em andamento: {andamento('loyalty', uso)}
      </p>
      <Checkbox name="banners" label="Banners: avisos e promoções no app" defaultChecked={v.banners === 'on'} />
      <Checkbox name="store" label="Loja: produtos e pedidos" defaultChecked={v.store === 'on'} aria-describedby={`${uid}-store`} />
      <p id={`${uid}-store`} className="af-wizard__note">
        Em andamento: {andamento('store', uso)}
      </p>
      {semMercadoPago ? (
        <p role="note" className="af-wizard__note">
          Atenção: a Loja está ligada, mas o Mercado Pago não está configurado, então os clientes não conseguem pagar.{' '}
          <Link href={`/contas/${businessId}/integracoes`}>Configurar na aba Integrações</Link>.
        </p>
      ) : null}
      <p className="af-wizard__note">
        Desligar um módulo esconde tudo isso da conta e do app, mas guarda os dados: ao ligar de novo, tudo volta.
      </p>
    </div>
  )
}

/** Grades e limites das regras, lidos do domínio pela página (a tela não repete número de regra). */
export type LimitesDeRegras = {
  grades: readonly number[]
  limites: { minLeadMin: { min: number; max: number }; maxAdvanceDays: { min: number; max: number }; customerChangeWindowMin: { min: number; max: number }; bufferMin: { min: number; max: number; step: number } }
}

/** Regras de agenda. O fuso é fixo (America/Sao_Paulo) e não aparece aqui. */
export function RegrasForm({ action, valores, grades, limites }: { action: AcaoConta; valores: Campos } & LimitesDeRegras) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar regras">
      {({ values: v, fields }) => (
        <>
          <div className="af-wizard__grid">
            <Field label="Grade de horários" hint="De quanto em quanto tempo um horário pode começar." error={fields.slotStepMin}>
              <Select name="slotStepMin" defaultValue={v.slotStepMin}>
                {grades.map((g) => (
                  <option key={g} value={String(g)}>
                    {g} minutos
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Intervalo entre atendimentos (minutos)" hint={`Múltiplo de ${limites.bufferMin.step}, até ${limites.bufferMin.max}.`} error={fields.bufferMin}>
              <Input name="bufferMin" type="number" inputMode="numeric" min={limites.bufferMin.min} max={limites.bufferMin.max} step={limites.bufferMin.step} defaultValue={v.bufferMin} />
            </Field>
            <Field label="Antecedência mínima (minutos)" hint="Quanto antes do horário o cliente ainda pode marcar." error={fields.minLeadMin}>
              <Input name="minLeadMin" type="number" inputMode="numeric" min={limites.minLeadMin.min} max={limites.minLeadMin.max} defaultValue={v.minLeadMin} />
            </Field>
            <Field label="Alcance da agenda (dias)" hint="Até quantos dias à frente se pode marcar." error={fields.maxAdvanceDays}>
              <Input name="maxAdvanceDays" type="number" inputMode="numeric" min={limites.maxAdvanceDays.min} max={limites.maxAdvanceDays.max} defaultValue={v.maxAdvanceDays} />
            </Field>
            <Field label="Prazo para o cliente mudar (minutos)" hint="Até quanto tempo antes o cliente pode remarcar ou cancelar." error={fields.customerChangeWindowMin}>
              <Input name="customerChangeWindowMin" type="number" inputMode="numeric" min={limites.customerChangeWindowMin.min} max={limites.customerChangeWindowMin.max} defaultValue={v.customerChangeWindowMin} />
            </Field>
          </div>
          <Checkbox name="autoConfirm" label="Confirmar os agendamentos sozinho" defaultChecked={v.autoConfirm === 'on'} />
        </>
      )}
    </ContaForm>
  )
}

/** Avisos por tipo: uma caixa de e-mail por aviso, com o nome completo para leitor de tela. */
export function AvisosForm({ action, valores, avisos }: { action: AcaoConta; valores: Campos; avisos: Array<{ kind: string; label: string }> }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar avisos">
      {({ values: v }) => (
        <div className="af-matrix__scroll">
          <table className="af-matrix">
            <caption className="af-sr">Avisos por tipo</caption>
            <thead>
              <tr>
                <th scope="col">Aviso</th>
                <th scope="col">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {avisos.map((a) => (
                <tr key={a.kind}>
                  <th scope="row">{a.label}</th>
                  <td>
                    <Checkbox name={`${a.kind}__email`} label={<span className="af-sr">{a.label}: e-mail</span>} defaultChecked={v[`${a.kind}__email`] === 'on'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ContaForm>
  )
}
