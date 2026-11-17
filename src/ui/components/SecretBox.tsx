import { CopyButton } from './CopyButton'

/** O segredo de uma chave, mostrado uma única vez: caixa tracejada, o segredo em fonte monoespaçada, copiar e o aviso em Mel. */
export function SecretBox({ name, secret }: { name: string; secret: string }) {
  return (
    <div className="af-secret" role="status">
      <span className="af-secret__name">{name}</span>
      <div className="af-secret__row">
        <code className="af-secret__code">{secret}</code>
        <CopyButton text={secret} label={`Copiar a chave ${name}`} />
      </div>
      <p className="af-secret__warn">Copie a chave de app agora. Ela não será mostrada de novo.</p>
    </div>
  )
}
