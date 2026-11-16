import { CopyButton } from './CopyButton'

/** O segredo de uma chave, mostrado uma única vez: caixa destacada, aviso em texto e botão de copiar. */
export function SecretBox({ name, secret }: { name: string; secret: string }) {
  return (
    <div className="af-secret" role="status">
      <p className="af-secret__warn">Copie a chave de app agora. Ela não será mostrada de novo.</p>
      <span className="af-done__label">{name}</span>
      <code className="af-secret__code">{secret}</code>
      <CopyButton text={secret} label={`Copiar a chave ${name}`} variant="primary" />
    </div>
  )
}
