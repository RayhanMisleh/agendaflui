import { createHealthHandler } from '@/server/db/health'

// Sem isto o Next pré-renderiza a rota no build e a resposta nunca mais consultaria o banco.
export const dynamic = 'force-dynamic'

export const GET = createHealthHandler()
