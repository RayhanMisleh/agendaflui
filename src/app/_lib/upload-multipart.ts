/*
 * O que as rotas de envio de imagem (painel dev e painel do negócio) têm em comum: cabeçalhos, teto do arquivo, leitura do
 * corpo com limite, conferência de que o formulário veio deste mesmo host e a resposta de volta. Uma correção de limite ou de
 * origem vale para as duas.
 */

export const CABECALHOS = { 'Cache-Control': 'no-store' }
/** Teto do arquivo, o mesmo do armazenamento de imagens (8 MiB), medido nos bytes reais. */
export const MAX_ARQUIVO = 8 * 1024 * 1024
/** Folga para os campos e as divisórias do multipart em volta do arquivo. */
export const MAX_CORPO = MAX_ARQUIVO + 64 * 1024

/** Volta (303) para a tela de origem; o resultado vai no endereço. */
export function para(destino: string): Response {
  return new Response(null, { status: 303, headers: { ...CABECALHOS, Location: destino } })
}

/** Lê o corpo até o teto: passou dele, para de ler (nada de guardar um corpo sem limite na memória). */
export async function lerCorpo(request: Request): Promise<Uint8Array | null> {
  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_CORPO) return null
  if (!request.body) return new Uint8Array()
  const leitor = request.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_CORPO) {
      await leitor.cancel()
      return null
    }
    partes.push(value)
  }
  const corpo = new Uint8Array(total)
  let pos = 0
  for (const p of partes) {
    corpo.set(p, pos)
    pos += p.byteLength
  }
  return corpo
}

/** O `Origin` do formulário precisa ser este mesmo host; sem ele, ou com outro, a rota responde 403. */
export function mesmaOrigem(request: Request): boolean {
  const origem = request.headers.get('origin')
  const host = request.headers.get('host')
  try {
    return origem !== null && host !== null && new URL(origem).host === host
  } catch {
    return false
  }
}

/** Interpreta o corpo já lido como formulário multipart; `null` se não for um. */
export async function lerFormulario(request: Request, corpo: Uint8Array): Promise<FormData | null> {
  try {
    return await new Response(Buffer.from(corpo), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData()
  } catch {
    return null
  }
}
