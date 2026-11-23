'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MailCheck, MailWarning, Trash2, UserCheck, UserX } from 'lucide-react'
import { Button, Checkbox, ConfirmDialog, EmptyHint, Field, Input, Select, Textarea, WeekScheduleEditor } from '@/ui/components'
import type { WeekValue } from '@/ui/components'
import { ACCESS_STATUS_LABEL } from '@/server/domain/team/access-status'
import type { AccessStatus } from '@/server/domain/team/access-status'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import {
  alternarAcesso,
  arquivarProfissional,
  bloquearHorario,
  convidarAcesso,
  cadastrarNaEquipe,
  mudarPapelAcesso,
  redefinirSenhaAcesso,
  reenviarConviteAcesso,
  removerBloqueio,
  salvarDadosProfissional,
  salvarExpediente,
  salvarServicosProfissional,
} from './actions'

const VAZIO = { ok: false, message: null, fields: {} }
const estado = (values: Record<string, string>): EstadoPainel => ({ ok: false, message: null, fields: {}, values })

export type ServicoMarca = { id: string; name: string; does: boolean }

/** Os serviços que a pessoa faz, em caixas de marcar. */
function ListaDeServicos({ servicos }: { servicos: ServicoMarca[] }) {
  if (servicos.length === 0) return <EmptyHint>Cadastre os serviços da conta primeiro. Depois marque aqui os que esta pessoa faz.</EmptyHint>
  return (
    <div className="af-checklist">
      {servicos.map((s) => (
        <Checkbox key={s.id} name="serviceIds" value={s.id} label={s.name} defaultChecked={s.does} />
      ))}
    </div>
  )
}

const ROTULOS_DADOS = { name: 'Nome', bio: 'Apresentação', commission: 'Comissão' }

/** Nome, apresentação, comissão e situação da ficha. Quem chega aqui já gerencia a equipe. */
export function DadosForm({ id, name, bio, commission, active, termo }: { id: string; name: string; bio: string; commission: string; active: boolean; termo: string }) {
  return (
    <PainelForm action={salvarDadosProfissional} initial={estado({ id, name, bio, commission, active: active ? 'on' : '' })} submit="Salvar dados" labels={ROTULOS_DADOS}>
      {(state) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Nome" error={state.fields.name}>
            <Input name="name" defaultValue={state.values.name ?? ''} maxLength={80} autoComplete="off" required />
          </Field>
          <Field label="Apresentação" hint="Opcional. Aparece para quem marca horário." error={state.fields.bio}>
            <Textarea name="bio" defaultValue={state.values.bio ?? ''} maxLength={500} rows={3} />
          </Field>
          <Field label="Comissão (%)" hint="Quanto do valor de cada atendimento fica com esta pessoa. Só donos e gerentes veem." error={state.fields.commission}>
            <Input name="commission" inputMode="decimal" defaultValue={state.values.commission ?? ''} autoComplete="off" />
          </Field>
          <Checkbox name="active" label={`${termo} disponível para marcar horário`} defaultChecked={state.values.active === 'on'} />
        </>
      )}
    </PainelForm>
  )
}

const ROTULOS_CADASTRO = { name: 'Nome', email: 'E-mail', role: 'Papel' }

/** Cadastro num passo: nome, e-mail e papel criam a ficha, o acesso e o convite. Depois de cadastrar, abre a ficha. */
export function NovoProfissionalForm({ singular }: { singular: string }) {
  return (
    <PainelForm action={cadastrarNaEquipe} initial={estado({ role: 'PROFESSIONAL' })} submit="Cadastrar e enviar convite" labels={ROTULOS_CADASTRO}>
      {(state) => (
        <>
          <p className="af-section__help">A pessoa recebe um e-mail para escolher a própria senha e entrar no painel e no app. Serviços, expediente e comissão você ajusta na ficha.</p>
          <Field label="Nome" error={state.fields.name}>
            <Input name="name" defaultValue={state.values.name ?? ''} maxLength={80} autoComplete="off" required />
          </Field>
          <Field label="E-mail" hint="O convite chega neste endereço." error={state.fields.email}>
            <Input type="email" name="email" defaultValue={state.values.email ?? ''} autoComplete="off" required />
          </Field>
          <Field label="Papel" error={state.fields.role}>
            <Select name="role" defaultValue={state.values.role ?? 'PROFESSIONAL'}>
              <option value="PROFESSIONAL">{singular}: vê a própria agenda</option>
              <option value="MANAGER">Gerente: cuida da equipe, dos serviços e dos clientes</option>
            </Select>
          </Field>
        </>
      )}
    </PainelForm>
  )
}

export function ServicosForm({ id, servicos }: { id: string; servicos: ServicoMarca[] }) {
  return (
    <PainelForm action={salvarServicosProfissional} initial={estado({ id })} submit="Salvar serviços">
      {() => (
        <>
          <input type="hidden" name="id" value={id} />
          <ListaDeServicos servicos={servicos} />
        </>
      )}
    </PainelForm>
  )
}

/** O expediente da semana. O editor guarda o que foi digitado, então um erro nunca apaga as faixas. */
export function ExpedienteForm({ id, week }: { id: string; week: WeekValue }) {
  return (
    <PainelForm action={salvarExpediente} initial={estado({ id })} submit="Salvar expediente">
      {(state) => (
        <>
          <input type="hidden" name="id" value={id} />
          <WeekScheduleEditor defaultValue={week} errors={state.fields} />
        </>
      )}
    </PainelForm>
  )
}

export type BloqueioLinha = { id: string; quando: string; motivo: string | null }

/** Os bloqueios que vêm por aí, com o botão de tirar cada um. */
export function BloqueiosLista({ bloqueios }: { bloqueios: BloqueioLinha[] }) {
  if (bloqueios.length === 0) return <EmptyHint>Nenhum bloqueio nos próximos 90 dias.</EmptyHint>
  return (
    <ul className="af-blocks">
      {bloqueios.map((b) => (
        <li key={b.id} className="af-blocks__item">
          <div className="af-blocks__text">
            <span className="af-blocks__when af-tabular">{b.quando}</span>
            {b.motivo ? <span className="af-blocks__why">{b.motivo}</span> : null}
          </div>
          <AcaoDeLinha action={removerBloqueio} campos={{ id: b.id }} icon={<Trash2 size={16} />} ariaLabel={`Remover bloqueio de ${b.quando}`}>
            Remover
          </AcaoDeLinha>
        </li>
      ))}
    </ul>
  )
}

const ROTULOS_BLOQUEIO = { startDate: 'Data de início', startTime: 'Hora de início', endDate: 'Data do fim', endTime: 'Hora do fim', reason: 'Motivo' }

/**
 * Cria um bloqueio. Se o intervalo cobre agendamentos, o primeiro envio só avisa quantos são; o botão passa a dizer
 * "Bloquear mesmo assim" e leva a confirmação, ligada ao intervalo exato (mudar um campo pede nova confirmação).
 */
export function BloqueioForm({ id, hoje }: { id: string; hoje: string }) {
  return (
    <PainelForm
      action={bloquearHorario}
      initial={estado({ id, startDate: hoje, startTime: '09:00', endDate: hoje, endTime: '12:00' })}
      submit={(s) => (s.values.affected && !s.ok ? 'Bloquear mesmo assim' : 'Bloquear horário')}
      labels={ROTULOS_BLOQUEIO}
    >
      {(state) => {
        const v = state.values
        const atinge = !state.ok && v.affected && v.confirm
        return (
          <>
            <input type="hidden" name="id" value={id} />
            {atinge ? <input type="hidden" name="confirm" value={v.confirm} /> : null}
            <div className="af-formgrid">
              <Field label="Início" error={state.fields.startDate}>
                <Input type="date" name="startDate" defaultValue={v.startDate ?? ''} required />
              </Field>
              <Field label="Hora do início" error={state.fields.startTime}>
                <Input type="time" name="startTime" step={300} defaultValue={v.startTime ?? ''} required />
              </Field>
              <Field label="Fim" error={state.fields.endDate}>
                <Input type="date" name="endDate" defaultValue={v.endDate ?? ''} required />
              </Field>
              <Field label="Hora do fim" error={state.fields.endTime}>
                <Input type="time" name="endTime" step={300} defaultValue={v.endTime ?? ''} required />
              </Field>
            </div>
            <Field label="Motivo" hint="Opcional. Só a equipe vê." error={state.fields.reason}>
              <Input name="reason" defaultValue={v.reason ?? ''} maxLength={200} autoComplete="off" />
            </Field>
          </>
        )
      }}
    </PainelForm>
  )
}

export type AcessoDados = { membershipId: string; email: string; name: string; role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL'; status: AccessStatus }

/** Convida a pessoa para entrar no painel, ligando o acesso a esta ficha. */
export function ConviteForm({ id, nome, podeConvidarDono, termo }: { id: string; nome: string; podeConvidarDono: boolean; termo: string }) {
  return (
    <PainelForm action={convidarAcesso} initial={estado({ id, name: nome, role: 'PROFESSIONAL' })} submit="Enviar convite" labels={{ name: 'Nome', email: 'E-mail', role: 'Papel' }}>
      {(state) => (
        <>
          <input type="hidden" name="id" value={id} />
          <p className="af-section__help">Esta ficha ainda não tem acesso ao painel. O convite chega por e-mail, e a pessoa escolhe a própria senha.</p>
          <Field label="Nome de quem vai entrar" error={state.fields.name}>
            <Input name="name" defaultValue={state.values.name ?? ''} autoComplete="off" required />
          </Field>
          <Field label="E-mail" error={state.fields.email}>
            <Input type="email" name="email" defaultValue={state.values.email ?? ''} autoComplete="off" required />
          </Field>
          <Field label="Papel" error={state.fields.role}>
            <Select name="role" defaultValue={state.values.role ?? 'PROFESSIONAL'}>
              <option value="PROFESSIONAL">{termo}: vê a própria agenda</option>
              <option value="MANAGER">Gerente: cuida da equipe, dos serviços e dos clientes</option>
              {podeConvidarDono ? <option value="OWNER">Dono: cuida de tudo, inclusive da conta</option> : null}
            </Select>
          </Field>
        </>
      )}
    </PainelForm>
  )
}

/** O acesso ligado: papel, desativar, reenviar convite e redefinir a senha. */
export function AcessoGestao({ acesso, suporte, podeDono, termo, nomeFicha }: { acesso: AcessoDados; suporte: boolean; podeDono: boolean; termo: string; nomeFicha: string }) {
  const [desativando, setDesativando] = useState(false)
  const ativo = acesso.status !== 'inactive'
  const convitePendente = acesso.status === 'invited' || acesso.status === 'invite_failed'
  const falhou = acesso.status === 'invite_failed'
  const situacao = acesso.status === 'invited' ? 'Convite enviado, esperando a senha' : ACCESS_STATUS_LABEL[acesso.status]
  return (
    <div className="af-careful">
      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">{acesso.name}</span>
          <span className="af-careful__help">
            {acesso.email} · {situacao}
          </span>
        </div>
      </div>
      <PainelForm action={mudarPapelAcesso} initial={estado({ membershipId: acesso.membershipId, role: acesso.role })} submit="Salvar papel">
        {(state) => (
          <>
            <input type="hidden" name="membershipId" value={acesso.membershipId} />
            <Field label="Papel" error={state.fields.role}>
              <Select name="role" defaultValue={state.values.role ?? acesso.role}>
                <option value="PROFESSIONAL">{termo}</option>
                <option value="MANAGER">Gerente</option>
                {podeDono || acesso.role === 'OWNER' ? <option value="OWNER">Dono</option> : null}
              </Select>
            </Field>
          </>
        )}
      </PainelForm>
      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">{ativo ? 'Desativar acesso' : 'Reativar acesso'}</span>
          <span className="af-careful__help">
            {ativo ? `${nomeFicha} sai do painel e do app na hora, em todos os aparelhos. A ficha continua.` : `${nomeFicha} volta a poder entrar com a senha que já tem.`}
          </span>
        </div>
        {ativo ? (
          <Button variant="secondary" icon={<UserX size={16} />} onClick={() => setDesativando(true)}>
            Desativar acesso
          </Button>
        ) : (
          <AcaoDeLinha action={alternarAcesso} campos={{ membershipId: acesso.membershipId, active: '1' }} icon={<UserCheck size={16} />} size="md">
            Reativar acesso
          </AcaoDeLinha>
        )}
      </div>
      {ativo && convitePendente ? (
        <div className="af-careful__row">
          <div className="af-careful__text">
            <span className="af-careful__title">{falhou ? 'Convite não enviado' : 'Reenviar convite'}</span>
            <span className="af-careful__help">
              {falhou
                ? `O e-mail para ${acesso.email} não saiu, mas o cadastro ficou salvo. Confira o endereço e reenvie o convite.`
                : `Manda um convite novo para ${acesso.email}. O anterior deixa de valer.`}
            </span>
          </div>
          <AcaoDeLinha action={reenviarConviteAcesso} campos={{ membershipId: acesso.membershipId }} icon={falhou ? <MailWarning size={16} /> : <MailCheck size={16} />} variant={falhou ? 'primary' : 'secondary'} size="md" showOk>
            Reenviar convite
          </AcaoDeLinha>
        </div>
      ) : null}
      {ativo && !convitePendente ? (
        <div className="af-careful__row">
          <div className="af-careful__text">
            <span className="af-careful__title">Senha</span>
            <span className="af-careful__help">
              {suporte ? 'O suporte não envia redefinição de senha. Peça a um dono ou gerente da conta.' : `Manda para ${acesso.email} um link para escolher uma senha nova.`}
            </span>
          </div>
          {suporte ? null : (
            <AcaoDeLinha action={redefinirSenhaAcesso} campos={{ membershipId: acesso.membershipId }} icon={<MailCheck size={16} />} size="md" showOk>
              Enviar redefinição de senha
            </AcaoDeLinha>
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={desativando}
        onClose={() => setDesativando(false)}
        title={`Desativar o acesso de ${acesso.name}?`}
        description="A pessoa sai do painel e do app na hora, em todos os aparelhos, e não consegue entrar de novo até você reativar o acesso."
        confirmLabel="Desativar acesso"
        initialState={VAZIO}
        hidden={{ membershipId: acesso.membershipId, active: '0' }}
        action={async (prev, fd) => {
          const r = await alternarAcesso(prev as EstadoPainel, fd)
          if (r.ok) setDesativando(false)
          return r
        }}
      />
    </div>
  )
}

/** Remover o profissional: arquiva a ficha e desativa o acesso ligado. */
export function RemoverProfissional({ id, nome, singular, temAcesso }: { id: string; nome: string; singular: string; temAcesso: boolean }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const sing = singular.toLowerCase()
  return (
    <div className="af-careful__row">
      <div className="af-careful__text">
        <span className="af-careful__title">Remover {sing}</span>
        <span className="af-careful__help">
          {`Arquiva a ficha de ${nome}${temAcesso ? ' e desativa o acesso ao painel' : ''}. O histórico de atendimentos fica guardado. Antes, cancele ou remaneje os agendamentos futuros.`}
        </span>
      </div>
      <Button variant="secondary" icon={<Trash2 size={16} />} onClick={() => setAberto(true)}>
        Remover {sing}
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title={`Remover ${nome}?`}
        description={`A ficha vai para o arquivo${temAcesso ? ' e o acesso ao painel é desativado na hora' : ''}. Os atendimentos já feitos continuam no histórico.`}
        confirmLabel={`Remover ${sing}`}
        initialState={VAZIO}
        hidden={{ id }}
        action={async (prev, fd) => {
          const r = await arquivarProfissional(prev as EstadoPainel, fd)
          if (r.ok) router.push('/equipe')
          return r
        }}
      />
    </div>
  )
}
