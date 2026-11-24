"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  BellRing,
  CalendarClock,
  Check,
  CircleCheck,
  Undo2,
  UserX,
} from "lucide-react";
import type {
  AgendaPage,
  PageDetail,
} from "@/server/domain/scheduling/agenda-page";
import {
  AppointmentStatusBadge,
  Button,
  Checkbox,
  Dialog,
  Field,
  MinutesField,
  MoneyField,
  PetIllustration,
  PhoneLink,
  Sheet,
  Textarea,
} from "@/ui/components";
import { formatDuration, formatLocalDate, formatMoney } from "@/ui/format";
import { formatMoneyInput } from "@/ui/money";
import { AcaoDeLinha } from "../_lib/AcaoDeLinha";
import { PainelForm } from "../_lib/PainelForm";
import type { EstadoPainel } from "../_lib/PainelForm";
import { ajustarAtendimento, avisarLivre, mudarSituacao } from "./actions";
import { petsDoCliente } from "./consultas";
import type { PetResumo } from "./consultas";
import { ConflitosDialog } from "./ConflitosDialog";
import {
  EscolherPet,
  ServicosDoPetLista,
  useServicosDoPet,
} from "./PetsEServicos";

type Decisao = "complete" | "noshow" | "cancel";

const DECISOES: Record<
  Decisao,
  { titulo: (nome: string) => string; verbo: string; texto: string }
> = {
  complete: {
    titulo: (n) => `Concluir o atendimento de ${n}?`,
    verbo: "Concluir atendimento",
    texto: "O atendimento passa a contar como feito e a comissão é registrada.",
  },
  noshow: {
    titulo: (n) => `Marcar falta de ${n}?`,
    verbo: "Marcar falta",
    texto:
      "O horário fica sem atendimento. Você pode desfazer depois, se foi engano.",
  },
  cancel: {
    titulo: (n) => `Cancelar o atendimento de ${n}?`,
    verbo: "Cancelar atendimento",
    texto: "O horário volta a ficar livre e o cliente é avisado.",
  },
};

/** Confirmação de concluir, faltou e cancelar: o botão repete o verbo do título. Cancelar leva o motivo. */
function DecisaoDialog({
  detalhe,
  decisao,
  onClose,
  onDone,
}: {
  detalhe: PageDetail;
  decisao: Decisao | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const d = decisao ? DECISOES[decisao] : null;
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: {},
  };
  return (
    <Dialog
      open={decisao !== null}
      onClose={onClose}
      title={d ? d.titulo(detalhe.customer.name) : ""}
    >
      {d && decisao ? (
        <PainelForm
          action={mudarSituacao}
          initial={inicial}
          submit={d.verbo}
          onDone={onDone}
          secondary={
            <Button variant="ghost" onClick={onClose}>
              Voltar
            </Button>
          }
        >
          {(state) => (
            <>
              <input type="hidden" name="id" value={detalhe.id} />
              <input type="hidden" name="to" value={decisao} />
              <p className="af-confirm__text">{d.texto}</p>
              {decisao === "cancel" ? (
                <Field
                  label="Motivo"
                  hint="Opcional. Fica no histórico do atendimento."
                  error={state.fields.reason}
                >
                  <Textarea name="reason" rows={2} maxLength={300} />
                </Field>
              ) : null}
            </>
          )}
        </PainelForm>
      ) : null}
    </Dialog>
  );
}

/** Desfazer falta: o horário pode ter virado de outro; o servidor pede confirmação e, confirmado, reabre como encaixe. */
function DesfazerFalta({ id, onDone }: { id: string; onDone: () => void }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: {},
  };
  return (
    <PainelForm
      id="desfazer-form"
      action={mudarSituacao}
      initial={inicial}
      submit="Desfazer falta"
      onDone={onDone}
      className="af-slipdetail__undo"
    >
      {(state) => (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="to" value="undo" />
          <ConflitosDialog
            formId="desfazer-form"
            confirmation={state.confirmation}
            confirmLabel="Reabrir mesmo assim"
          />
        </>
      )}
    </PainelForm>
  );
}

import { duracaoBase } from "./duracao-ajuste";

function Ajustes({
  detalhe,
  page,
  onDone,
}: {
  detalhe: PageDetail;
  page: AgendaPage;
  onDone: () => void;
}) {
  const niche = page.niche;
  const [marcados, setMarcados] = useState(
    detalhe.items.map((i) => i.serviceId),
  );
  const [pets, setPets] = useState<PetResumo[]>(
    detalhe.pet
      ? [
          {
            id: detalhe.pet.id,
            name: detalhe.pet.name,
            typeLabel: detalhe.pet.typeLabel,
            variant: detalhe.items[0]?.variant ?? "DOG_MEDIUM",
          },
        ]
      : [],
  );
  const [petId, setPetId] = useState<string | null>(detalhe.pet?.id ?? null);
  const somaAtual = detalhe.items.reduce((t, i) => t + i.durationMin, 0);
  const [duracao, setDuracao] = useState(String(detalhe.totalDurationMin));
  const [editada, setEditada] = useState(
    detalhe.totalDurationMin !== somaAtual,
  );

  useEffect(() => {
    if (!niche) return;
    let vivo = true;
    void petsDoCliente(detalhe.customer.id).then((r) => {
      if (vivo && r.ok) setPets(r.pets);
    });
    return () => {
      vivo = false;
    };
  }, [niche, detalhe.customer.id]);

  const doPet = useServicosDoPet(niche ? petId : null);
  const opcoes = useMemo(
    () =>
      niche && petId
        ? doPet.servicos
            .filter((s) => s.offered && s.durationMin !== null)
            .map((s) => ({ id: s.id, durationMin: s.durationMin ?? 0 }))
        : page.services,
    [niche, petId, doPet.servicos, page.services],
  );
  const soma =
    opcoes
      .filter((s) => marcados.includes(s.id))
      .reduce((t, s) => t + s.durationMin, 0) || somaAtual;
  // Enquanto pet e serviços são os do atendimento, a duração é a guardada nele: a tabela de hoje não vale para o que já foi marcado.
  const base = duracaoBase({
    petId,
    marcados,
    original: {
      petId: detalhe.pet?.id ?? null,
      serviceIds: detalhe.items.map((i) => i.serviceId),
    },
    somaViva: soma,
    totalGuardado: detalhe.totalDurationMin,
  });
  const valor = editada ? duracao : String(base);
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: {
      price: formatMoneyInput(detalhe.totalCents),
      notes: detalhe.notes ?? "",
    },
  };
  const lista = niche && petId !== null;

  return (
    <details className="af-slipdetail__adjust">
      <summary>Ajustar pet, serviços, duração, valor e observação</summary>
      <PainelForm
        id="ajustar-form"
        action={ajustarAtendimento}
        initial={inicial}
        submit="Salvar ajustes"
        onDone={onDone}
        labels={{
          price: "Valor",
          notes: "Observação",
          serviceIds: "Serviços",
          petId: "Pet",
          durationMin: "Duração",
        }}
      >
        {(state) => (
          <>
            <input type="hidden" name="id" value={detalhe.id} />
            {niche ? (
              <>
                <input type="hidden" name="petId" value={petId ?? ""} />
                <EscolherPet
                  customerId={detalhe.customer.id}
                  pets={pets}
                  valor={pets.find((p) => p.id === petId) ?? null}
                  onChange={(p) => setPetId(p.id)}
                  onAdded={(p) => {
                    setPets((l) => [...l, p]);
                    setPetId(p.id);
                  }}
                  servesCats={niche.servesCats}
                  podeAdicionar={false}
                  erro={state.fields.petId}
                />
              </>
            ) : null}
            {lista ? (
              <ServicosDoPetLista
                petId={petId}
                marcados={marcados}
                onToggle={(id, on) =>
                  setMarcados((l) =>
                    on ? [...l, id] : l.filter((x) => x !== id),
                  )
                }
                erroDeCampo={state.fields.serviceIds}
                semPet="Escolha o pet para ver os serviços."
                servicos={doPet}
                id="ajustar-servicos"
              />
            ) : (
              <fieldset className="af-pick">
                <legend className="af-field__label">Serviços</legend>
                {page.services.map((s) => (
                  <Checkbox
                    key={s.id}
                    name="serviceIds"
                    value={s.id}
                    checked={marcados.includes(s.id)}
                    onChange={(e) =>
                      setMarcados((l) =>
                        e.target.checked
                          ? [...l, s.id]
                          : l.filter((x) => x !== s.id),
                      )
                    }
                    label={`${s.name} · ${formatDuration(s.durationMin)} · ${formatMoney(s.priceCents)}`}
                  />
                ))}
              </fieldset>
            )}
            <MinutesField
              id="ajustar-duracao"
              name="durationMin"
              value={valor}
              sumMin={soma}
              error={state.fields.durationMin}
              onChange={(v) => {
                if (v.trim() === String(base)) {
                  setEditada(false);
                  setDuracao("");
                } else {
                  setEditada(true);
                  setDuracao(v);
                }
              }}
            />
            {page.scope === "all" ? (
              <Field
                label="Valor (R$)"
                hint="Trocar o pet ou os serviços recalcula o valor; digite aqui para combinar outro."
                error={state.fields.price}
              >
                <MoneyField
                  name="price"
                  defaultValue={state.values.price ?? ""}
                />
              </Field>
            ) : null}
            <Field
              label="Observação"
              hint="Anotação da equipe."
              error={state.fields.notes}
            >
              <Textarea
                name="notes"
                rows={2}
                maxLength={2000}
                defaultValue={state.values.notes ?? ""}
              />
            </Field>
            <ConflitosDialog
              formId="ajustar-form"
              confirmation={state.confirmation}
              confirmLabel="Salvar mesmo assim"
            />
          </>
        )}
      </PainelForm>
    </details>
  );
}

/** A ficha do atendimento: quem, quando, o que, e o que dá para fazer com ele agora. */
export function AppointmentSheet({
  detalhe,
  page,
  onClose,
  onReschedule,
}: {
  detalhe: PageDetail | null;
  page: AgendaPage;
  onClose: () => void;
  onReschedule?: (id: string) => void;
}) {
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const d = detalhe;
  const emAberto =
    d !== null && (d.status === "PENDING" || d.status === "CONFIRMED");
  const fechar = () => {
    setDecisao(null);
    onClose();
  };
  return (
    <>
      <Sheet
        open={d !== null}
        onClose={fechar}
        title={
          d
            ? d.pet
              ? `${d.pet.name} · ${d.customer.name}`
              : d.customer.name
            : "Atendimento"
        }
      >
        {d ? (
          <div className="af-slipdetail">
            {d.pet ? (
              <div className="af-slipdetail__pet">
                <span className="af-slipdetail__petart" aria-hidden="true">
                  <PetIllustration
                    variant={d.items[0]?.variant ?? "DOG_MEDIUM"}
                    size={32}
                  />
                </span>
                <div>
                  <p className="af-slipdetail__petname">{d.pet.name}</p>
                  <p className="af-slipdetail__pettype">{d.pet.typeLabel}</p>
                </div>
              </div>
            ) : null}
            <div className="af-slipdetail__head">
              <AppointmentStatusBadge status={d.status} />
              {d.squeezeIn ? (
                <span className="af-slipdetail__tag">Encaixe</span>
              ) : null}
              <p className="af-slipdetail__when">
                <time dateTime={d.date}>{formatLocalDate(d.date)}</time>,{" "}
                {d.startLabel} às {d.endLabel}
              </p>
            </div>
            <dl className="af-slipdetail__facts">
              <div>
                <dt>Telefone</dt>
                <dd>
                  <PhoneLink phone={d.customer.phoneLabel} />
                </dd>
              </div>
              <div>
                <dt>Profissional</dt>
                <dd>{d.professional.name}</dd>
              </div>
              <div>
                <dt>Serviços</dt>
                <dd>
                  <ul className="af-slipdetail__items">
                    {d.items.map((i) => (
                      <li key={i.serviceId}>
                        {i.name} · {formatDuration(i.durationMin)} ·{" "}
                        {formatMoney(i.priceCents)}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd className="af-tabular">
                  {formatMoney(d.totalCents)} ·{" "}
                  {formatDuration(d.totalDurationMin)}
                </dd>
              </div>
              {d.customerNote ? (
                <div>
                  <dt>Pedido do cliente</dt>
                  <dd>{d.customerNote}</dd>
                </div>
              ) : null}
              {d.notes ? (
                <div>
                  <dt>Anotação da equipe</dt>
                  <dd>{d.notes}</dd>
                </div>
              ) : null}
            </dl>

            <div className="af-slipdetail__actions">
              {d.status === "PENDING" ? (
                <AcaoDeLinha
                  action={mudarSituacao}
                  campos={{ id: d.id, to: "confirm" }}
                  variant="primary"
                  size="md"
                  icon={<Check size={18} />}
                  showOk
                >
                  Confirmar atendimento
                </AcaoDeLinha>
              ) : null}
              {d.status === "CONFIRMED" ? (
                <>
                  <Button
                    variant="primary"
                    icon={<CircleCheck size={18} />}
                    onClick={() => setDecisao("complete")}
                  >
                    Concluir atendimento
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<UserX size={18} />}
                    onClick={() => setDecisao("noshow")}
                  >
                    Marcar falta
                  </Button>
                </>
              ) : null}
              {d.canFreeEarly ? (
                <AcaoDeLinha
                  action={avisarLivre}
                  campos={{ id: d.id }}
                  variant="secondary"
                  size="md"
                  icon={<BellRing size={18} />}
                  showOk
                >
                  Já estou livre
                </AcaoDeLinha>
              ) : null}
              {d.status === "COMPLETED" ? (
                <AcaoDeLinha
                  action={mudarSituacao}
                  campos={{ id: d.id, to: "undo" }}
                  variant="secondary"
                  size="md"
                  icon={<Undo2 size={18} />}
                  showOk
                >
                  Desfazer conclusão
                </AcaoDeLinha>
              ) : null}
              {d.status === "NO_SHOW" ? (
                <DesfazerFalta id={d.id} onDone={fechar} />
              ) : null}
              {emAberto && onReschedule ? (
                <Button
                  variant="secondary"
                  icon={<CalendarClock size={18} />}
                  onClick={() => onReschedule(d.id)}
                >
                  Remarcar
                </Button>
              ) : null}
              {emAberto ? (
                <Button
                  variant="ghost"
                  icon={<Ban size={18} />}
                  onClick={() => setDecisao("cancel")}
                >
                  Cancelar atendimento
                </Button>
              ) : null}
            </div>

            {emAberto ? (
              <Ajustes
                key={`${d.id}-${d.totalCents}-${d.items.length}`}
                detalhe={d}
                page={page}
                onDone={() => undefined}
              />
            ) : null}
          </div>
        ) : null}
      </Sheet>
      {d ? (
        <DecisaoDialog
          detalhe={d}
          decisao={decisao}
          onClose={() => setDecisao(null)}
          onDone={fechar}
        />
      ) : null}
    </>
  );
}
