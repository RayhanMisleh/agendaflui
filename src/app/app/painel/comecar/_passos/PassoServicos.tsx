"use client";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Checkbox,
  DurationField,
  EmptyHint,
  Field,
  Input,
  MoneyField,
  PetIllustration,
  StatusBadge,
} from "@/ui/components";
import { formatMoneyInput } from "@/ui/money";
import type { PriceVariant } from "@/server/db/generated/client";
import { PainelForm } from "../../_lib/PainelForm";
import type { EstadoPainel } from "../../_lib/PainelForm";
import { salvarServicos } from "../actions";

export type SugestaoLinha = {
  name: string;
  icon: string;
  description: string | null;
  exists: boolean;
  prices: { variant: PriceVariant; priceCents: number; durationMin: number }[];
};
export type PorteDef = {
  key: PriceVariant;
  shortLabel: string;
  rangeLabel: string | null;
};

const MAX_LINHAS = 20;

/** Uma linha da tabela: o serviço (marcado ou não) e, por porte, o preço e a duração já preenchidos com o exemplo. */
function Linha({
  i,
  sugestao,
  portes,
  slotStepMin,
  valores,
  erros,
  onRemove,
}: {
  i: number;
  sugestao: SugestaoLinha | null;
  portes: readonly PorteDef[];
  slotStepMin: number;
  valores: Record<string, string>;
  erros: Record<string, string>;
  onRemove: (() => void) | null;
}) {
  const existe = sugestao?.exists ?? false;
  const marcado = valores[`s_${i}_on`];
  const [ligada, setLigada] = useState(
    existe ? false : marcado !== undefined ? marcado === "on" : true,
  );
  const nomeId = `s-${i}-nome`;
  return (
    <li
      className={`af-onb-svc${ligada ? "" : " af-onb-svc--off"}`}
      style={{ "--i": i } as React.CSSProperties}
    >
      <div className="af-onb-svc__head">
        <Checkbox
          name={`s_${i}_on`}
          label={
            <>
              <span className="af-sr">
                {sugestao?.name ?? `Serviço ${i + 1}`}:{" "}
              </span>
              Oferecer
            </>
          }
          checked={ligada}
          disabled={existe}
          onChange={(e) => setLigada(e.target.checked)}
        />
        {existe ? (
          <StatusBadge tone="confirmed">Já cadastrado</StatusBadge>
        ) : null}
        {onRemove ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={16} />}
            aria-label="Remover esta linha"
            onClick={onRemove}
          >
            Remover
          </Button>
        ) : null}
      </div>
      <Field
        label="Nome do serviço"
        error={erros[`s_${i}_name`]}
        className="af-onb-svc__name"
      >
        <Input
          id={nomeId}
          name={`s_${i}_name`}
          defaultValue={valores[`s_${i}_name`] ?? sugestao?.name ?? ""}
          maxLength={80}
          autoComplete="off"
          disabled={!ligada}
        />
      </Field>
      <input
        type="hidden"
        name={`s_${i}_icon`}
        value={sugestao?.icon ?? "sparkles"}
        disabled={!ligada}
      />
      <input
        type="hidden"
        name={`s_${i}_desc`}
        value={sugestao?.description ?? ""}
        disabled={!ligada}
      />
      <ul
        className="af-onb-svc__sizes"
        aria-label={`Preço e duração por porte de ${sugestao?.name ?? `serviço ${i + 1}`}`}
      >
        {portes.map((p) => {
          const nomeServico = valores[`s_${i}_name`] ?? sugestao?.name ?? `Serviço ${i + 1}`;
          const exemplo = sugestao?.prices.find((x) => x.variant === p.key);
          const preco =
            valores[`s_${i}_${p.key}_price`] ??
            (exemplo ? formatMoneyInput(exemplo.priceCents) : "");
          const duracao =
            Number(valores[`s_${i}_${p.key}_duration`]) || exemplo?.durationMin;
          return (
            <li key={p.key} className="af-onb-svc__size">
              <span className="af-onb-svc__art" aria-hidden="true">
                <PetIllustration variant={p.key} size={32} />
              </span>
              <span className="af-onb-svc__label">
                {p.shortLabel}
                {p.rangeLabel ? <small> · {p.rangeLabel}</small> : null}
              </span>
              <Field label={<><span className="af-sr">{nomeServico} · {p.shortLabel}: </span>Preço (R$)</>} error={erros[`s_${i}_${p.key}_price`]}>
                <MoneyField
                  name={`s_${i}_${p.key}_price`}
                  defaultValue={preco}
                  disabled={!ligada}
                />
              </Field>
              <Field label={<><span className="af-sr">{nomeServico} · {p.shortLabel}: </span>Duração</>} error={erros[`s_${i}_${p.key}_duration`]}>
                <DurationField
                  name={`s_${i}_${p.key}_duration`}
                  stepMin={slotStepMin}
                  {...(duracao !== undefined
                    ? { value: duracao }
                    : { value: Math.ceil(30 / slotStepMin) * slotStepMin })}
                  disabled={!ligada}
                />
              </Field>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * Passo 4: uma linha por serviço sugerido, com a tabela por porte preenchida com valores de exemplo para ajustar. Desmarque o
 * que não oferece, mude o que quiser, ou acrescente outro serviço. Porte sem preço fica de fora do serviço.
 */
export function PassoServicos({
  rows,
  portes,
  slotStepMin,
}: {
  rows: SugestaoLinha[];
  portes: readonly PorteDef[];
  slotStepMin: number;
}) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: {},
  };
  return (
    <PainelForm
      action={salvarServicos}
      initial={inicial}
      submit="Salvar e continuar"
      className="af-acctform af-onb__services"
      anchors={{}}
    >
      {(state) => (
        <Tabela
          rows={rows}
          portes={portes}
          slotStepMin={slotStepMin}
          valores={state.values}
          erros={state.fields}
        />
      )}
    </PainelForm>
  );
}

function Tabela({
  rows,
  portes,
  slotStepMin,
  valores,
  erros,
}: {
  rows: SugestaoLinha[];
  portes: readonly PorteDef[];
  slotStepMin: number;
  valores: Record<string, string>;
  erros: Record<string, string>;
}) {
  const [extras, setExtras] = useState<number[]>(() => {
    const n = Number(valores.n) || 0;
    return Array.from({ length: Math.max(0, n - rows.length) }, (_, k) => k);
  });
  const [proximo, setProximo] = useState(extras.length);
  const total = rows.length + extras.length;
  return (
    <>
      <input type="hidden" name="n" value={String(total)} />
      {rows.length === 0 && extras.length === 0 ? (
        <EmptyHint>
          Nenhuma sugestão para esta loja. Adicione o primeiro serviço.
        </EmptyHint>
      ) : null}
      <ul className="af-onb-svc__list">
        {rows.map((r, i) => (
          <Linha
            key={r.name}
            i={i}
            sugestao={r}
            portes={portes}
            slotStepMin={slotStepMin}
            valores={valores}
            erros={erros}
            onRemove={null}
          />
        ))}
        {extras.map((chave, k) => (
          <Linha
            key={`extra-${chave}`}
            i={rows.length + k}
            sugestao={null}
            portes={portes}
            slotStepMin={slotStepMin}
            valores={valores}
            erros={erros}
            onRemove={() => setExtras((x) => x.filter((c) => c !== chave))}
          />
        ))}
      </ul>
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={16} />}
          disabled={total >= MAX_LINHAS}
          onClick={() => {
            setExtras((x) => [...x, proximo]);
            setProximo((p) => p + 1);
          }}
        >
          Adicionar outro serviço
        </Button>
      </div>
    </>
  );
}
