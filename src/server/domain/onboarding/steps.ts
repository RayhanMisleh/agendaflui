import type { TenantContext } from "@/server/auth/actor";
import { createServiceIn } from "@/server/domain/catalog/services";
import type { VariantPriceRow } from "@/server/domain/catalog/pricing";
import { searchKey } from "@/server/domain/customers/contact";
import { authorize, DomainError, parse, z } from "@/server/domain/errors";
import {
  markOnboardingStep,
  type OnboardingStepKey,
} from "@/server/domain/onboarding/progress";
import { getNicheSettings } from "@/server/domain/settings/niche-settings";
import { getSchedulingRules } from "@/server/domain/settings/scheduling-rules";
import { addTeamMember } from "@/server/domain/team/access";
import {
  createProfessional,
  ownProfessionalId,
} from "@/server/domain/team/professionals";
import {
  setWeekSchedule,
  type WeekSchedule,
} from "@/server/domain/team/working-hours";
import { visibleVariants, type VariantDef } from "@/server/niches";
import { isServiceIcon, type ServiceIconName } from "@/shared/service-icons";

/** Marca o passo; conta sem começo (as anteriores à fase 4) simplesmente não tem o que marcar. */
async function marcar(
  ctx: TenantContext,
  step: OnboardingStepKey,
  how: "done" | "skipped" = "done",
): Promise<void> {
  try {
    await markOnboardingStep(ctx, step, how);
  } catch (err) {
    if (err instanceof DomainError && err.code === "not_found") return;
    throw err;
  }
}

// ---------------------------------------------------------------- serviços sugeridos

export type SuggestionRow = {
  name: string;
  icon: ServiceIconName;
  description: string | null;
  prices: VariantPriceRow[];
};

/** Sobe a duração até a grade de horários da conta, para a sugestão já caber nela. */
const naGrade = (min: number, passo: number): number =>
  Math.ceil(min / passo) * passo;

/** As sugestões do nicho só com as variantes visíveis; `exists` diz que a loja já tem serviço ativo com o mesmo nome. */
export async function getServiceSuggestions(
  ctx: TenantContext,
): Promise<{
  rows: (SuggestionRow & { exists: boolean })[];
  variants: VariantDef[];
  slotStepMin: number;
}> {
  authorize(ctx, "manage_catalog");
  const { niche, options } = await getNicheSettings(ctx);
  const { slotStepMin } = await getSchedulingRules(ctx);
  if (niche === null) return { rows: [], variants: [], slotStepMin };
  const variants = [...visibleVariants(niche, options)];
  const ativos = await ctx.db.service.findMany({
    where: { active: true, archivedAt: null },
    select: { name: true },
  });
  const nomes = new Set(ativos.map((s) => searchKey(s.name)));
  const rows = niche.serviceSuggestions.map((s) => ({
    name: s.name,
    icon: s.icon,
    description: s.description,
    prices: variants.map((v) => ({
      variant: v.key,
      priceCents: s.prices[v.key].priceCents,
      durationMin: naGrade(s.prices[v.key].durationMin, slotStepMin),
    })),
    exists: nomes.has(searchKey(s.name)),
  }));
  return { rows, variants, slotStepMin };
}

const MSG_PRECO = "Preencha o preço de pelo menos um porte.";

const priceRowSchema = z.object({
  variant: z.enum(
    ["DOG_SMALL", "DOG_MEDIUM", "DOG_LARGE", "DOG_GIANT", "CAT"],
    { error: "Escolha o porte." },
  ),
  priceCents: z
    .number()
    .int("Informe o preço em centavos, sem fração.")
    .min(0, "O preço não pode ser negativo.")
    .max(10_000_000, "O preço é alto demais."),
  durationMin: z
    .number()
    .int("Informe a duração em minutos inteiros.")
    .min(5, "A duração mínima é de 5 minutos.")
    .max(600, "A duração máxima é de 600 minutos.")
    .multipleOf(5, "A duração deve ser múltipla de 5 minutos."),
});

const suggestionRowsSchema = z
  .array(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, "Informe o nome do serviço.")
        .max(80, "Use até 80 caracteres."),
      icon: z.string().refine(isServiceIcon, "Escolha um ícone da lista."),
      description: z
        .string()
        .trim()
        .max(500, "Use até 500 caracteres.")
        .nullable(),
      prices: z.array(priceRowSchema).max(10, "Há linhas demais."),
    }),
  )
  .min(1, "Marque pelo menos um serviço.")
  .max(15, "Use até 15 serviços por vez.");

/**
 * Cria os serviços marcados na tabela por porte (um `BY_VARIANT` por linha), ligados a todos os profissionais ativos, numa
 * transação só: uma linha sem nenhum porte desfaz tudo (`validation` com o nome do serviço). Nome que já existe entre os
 * serviços ativos é pulado (repetir o envio não duplica). Marca o passo Serviços como feito.
 */
export async function applyServiceSuggestions(
  ctx: TenantContext,
  rows: SuggestionRow[],
): Promise<{ created: number; skipped: number }> {
  authorize(ctx, "manage_catalog");
  const linhas = parse(suggestionRowsSchema, rows);
  const resultado = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey("catalog", ctx.businessId);
    const ativos = await tx.service.findMany({
      where: { active: true, archivedAt: null },
      select: { name: true },
    });
    const nomes = new Set(ativos.map((s) => searchKey(s.name)));
    const criados: string[] = [];
    let skipped = 0;
    for (const [indice, linha] of linhas.entries()) {
      const chave = searchKey(linha.name);
      if (nomes.has(chave)) {
        skipped += 1;
        continue;
      }
      try {
        const servico = await createServiceIn(
          tx,
          ctx,
          {
            name: linha.name,
            description: linha.description,
            icon: linha.icon,
            pricingMode: "BY_VARIANT",
            variantPrices: linha.prices,
          },
          { onGrid: true },
        );
        criados.push(servico.id);
        nomes.add(chave);
      } catch (err) {
        if (err instanceof DomainError && err.code === "validation") {
          const msg =
            err.message === MSG_PRECO
              ? `Preencha o preço de pelo menos um porte em "${linha.name}".`
              : err.message;
          throw new DomainError("validation", msg, {
            fields: { [`rows.${indice}`]: msg },
          });
        }
        throw err;
      }
    }
    if (criados.length > 0) {
      const profissionais = await tx.professional.findMany({
        where: { active: true, archivedAt: null },
        select: { id: true },
      });
      const ligacoes = profissionais.flatMap((p) =>
        criados.map((serviceId) => ({
          businessId: ctx.businessId,
          professionalId: p.id,
          serviceId,
        })),
      );
      if (ligacoes.length > 0)
        await tx.professionalService.createMany({
          data: ligacoes,
          skipDuplicates: true,
        });
    }
    return { created: criados.length, skipped };
  });
  await marcar(ctx, "SERVICES");
  return resultado;
}

// ---------------------------------------------------------------- expediente do dono

const DIAS_UTEIS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

/** Segunda a sexta, 09:00–18:00; sábado, 09:00–13:00. */
export function defaultOwnerSchedule(): Partial<WeekSchedule> {
  const semana: Partial<WeekSchedule> = {
    SATURDAY: [{ startMin: 540, endMin: 780 }],
    SUNDAY: [],
  };
  for (const dia of DIAS_UTEIS) semana[dia] = [{ startMin: 540, endMin: 1080 }];
  return semana;
}

/**
 * "Você também atende?": com `attends`, acha ou cria a ficha de profissional do dono (nome da pessoa, todos os serviços ativos)
 * e grava o expediente; sem, não cria nada. Repetir reaproveita a ficha. Marca o passo Expediente como feito.
 */
export async function setupOwnerSchedule(
  ctx: TenantContext,
  i: { attends: boolean; schedule?: Partial<WeekSchedule> },
): Promise<{ professionalId: string | null }> {
  authorize(ctx, "manage_account");
  if (!i.attends) {
    await marcar(ctx, "HOURS");
    return { professionalId: null };
  }
  if (ctx.actor.kind !== "member")
    throw new DomainError(
      "forbidden",
      "O suporte não tem ficha de profissional.",
    );
  const { membershipId, name } = ctx.actor;
  let id = await ownProfessionalId(ctx);
  if (id === null) {
    try {
      id = (await createProfessional(ctx, { name, membershipId })).id;
    } catch (err) {
      // Duas abas ao mesmo tempo: a segunda perde a corrida pela ficha e reaproveita a que a primeira criou.
      id = await ownProfessionalId(ctx);
      if (id === null) throw err;
    }
  }
  await setWeekSchedule(ctx, id, i.schedule ?? defaultOwnerSchedule());
  await marcar(ctx, "HOURS");
  return { professionalId: id };
}

// ---------------------------------------------------------------- equipe

const MAX_CONVITES = 5;

/** Convida até cinco pessoas. Cada linha vale sozinha: a que falha vira erro da linha e as outras seguem. */
export async function inviteTeamFromOnboarding(
  ctx: TenantContext,
  rows: { name: string; email: string; role: "PROFESSIONAL" | "MANAGER" }[],
): Promise<{ invited: number; errors: Record<number, string> }> {
  authorize(ctx, "manage_team");
  if (rows.length === 0)
    throw new DomainError("validation", "Informe pelo menos uma pessoa.");
  if (rows.length > MAX_CONVITES)
    throw new DomainError(
      "validation",
      `Convide até ${MAX_CONVITES} pessoas por vez.`,
    );
  let invited = 0;
  const errors: Record<number, string> = {};
  for (const [indice, linha] of rows.entries()) {
    try {
      await addTeamMember(ctx, linha);
      invited += 1;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      errors[indice] = err.message.startsWith("Esta pessoa já faz parte")
        ? "Esta pessoa já está na equipe."
        : (Object.values(err.fields ?? {})[0] ?? err.message);
    }
  }
  if (invited > 0) await marcar(ctx, "TEAM");
  return { invited, errors };
}
