# Imagem de produção do AgendaFlui: um contêiner, porta 3000, atrás do proxy do Coolify.
# Escolha deliberada: `next start` com node_modules de produção (e não `output: 'standalone'`), porque a imagem
# precisa também rodar `prisma migrate deploy` e o script de criar admin (tsx importando de src/), e o
# standalone não leva o CLI do Prisma, o tsx nem o src/.

FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Todas as dependências (o build precisa das de desenvolvimento). O postinstall roda `prisma generate`,
# que precisa do esquema e do prisma.config.ts já presentes.
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `--include=dev` é explícito: plataformas como o Coolify injetam as variáveis da aplicação no build, e com
# NODE_ENV=production o npm pularia as dependências de desenvolvimento de que o build precisa.
RUN npm ci --include=dev

# Build. Os valores abaixo são fictícios, existem só durante este RUN (não viram ENV da imagem) e o
# `next build` não valida segredos (NEXT_PHASE=phase-production-build). Nenhum segredo real entra aqui.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O cliente gerado é ignorado pelo Git e pelo .dockerignore: vem do estágio de dependências (postinstall).
COPY --from=deps /app/src/server/db/generated ./src/server/db/generated
RUN test -f src/server/db/generated/client.ts || npx prisma generate
# A chave das Server Actions fica gravada na saída do build: passe-a como build arg (o Coolify injeta as variáveis
# da aplicação como ARG). Ausente ou vazia, é retirada do ambiente e o build segue sem ela.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
RUN if [ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]; then unset NEXT_SERVER_ACTIONS_ENCRYPTION_KEY; fi; \
    DATABASE_URL="postgres://build:build@localhost:5432/build" \
    APP_SECRET="segredo-ficticio-so-para-o-build-do-next-0123456789" \
    DEV_HOST="dev.build.test" PAINEL_HOST="painel.build.test" API_HOST="api.build.test" \
    npm run build

# Só dependências de produção (inclui prisma e tsx, usados na partida e no admin:create).
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# O npm instala o Playwright como par opcional do Next; ele é só de teste e não pode ir para a imagem final.
RUN npm ci --omit=dev && rm -rf node_modules/@playwright node_modules/playwright node_modules/playwright-core && npm cache clean --force

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/storage
# O Next grava cache em .next/cache; o armazenamento persistente é /data/storage (monte o volume aí).
RUN mkdir -p /data/storage && chown -R node:node /data
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node package.json next.config.ts tsconfig.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
RUN chown node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "--import", "tsx", "scripts/start-production.ts"]
