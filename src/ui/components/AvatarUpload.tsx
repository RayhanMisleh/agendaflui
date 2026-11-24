'use client'
import { useEffect, useId, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { Avatar } from './Avatar'
import { SubmitButton } from './SubmitButton'

/** Teto do arquivo, o mesmo do servidor (8 MiB). */
export const FOTO_MAX_BYTES = 8 * 1024 * 1024

/**
 * Troca da foto: um formulário POST multipart (funciona sem JavaScript) para a rota própria de envio. Mostra a imagem
 * escolhida antes de enviar e avisa na hora se o arquivo passa do limite. `remove` leva ao botão de tirar a foto.
 */
export function AvatarUpload({ action, name, src, size = 'lg' }: { action: string; name: string; src: string | null; size?: 'md' | 'lg' }) {
  const id = useId()
  const [previa, setPrevia] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // A URL de prévia vive enquanto a imagem escolhida está na tela; trocar a escolha ou sair do componente a revoga.
  useEffect(() => {
    if (previa === null) return
    return () => URL.revokeObjectURL(previa)
  }, [previa])
  return (
    <form method="post" action={action} encType="multipart/form-data" className="af-avatarup">
      <Avatar name={name} src={previa ?? src} size={size} />
      <div className="af-avatarup__body">
        <label htmlFor={id} className="af-field__label">
          Foto de {name}
        </label>
        <input
          id={id}
          className="af-input"
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const arquivo = e.target.files?.[0]
            if (!arquivo) {
              setPrevia(null)
              setAviso(null)
              return
            }
            if (arquivo.size > FOTO_MAX_BYTES) {
              e.target.value = ''
              setPrevia(null)
              setAviso('A foto passa de 8 MB. Escolha um arquivo menor.')
              return
            }
            setAviso(null)
            setPrevia(URL.createObjectURL(arquivo))
          }}
        />
        {aviso ? (
          <p role="alert" className="af-field__error">
            {aviso}
          </p>
        ) : (
          <p className="af-field__hint">JPEG, PNG ou WebP, até 8 MB. A foto sai quadrada.</p>
        )}
        <div className="af-avatarup__actions">
          <SubmitButton variant="secondary" size="sm" icon={<Camera size={16} />}>
            Enviar foto
          </SubmitButton>
          {src ? (
            <SubmitButton name="intent" value="remove" variant="ghost" size="sm" icon={<Trash2 size={16} />}>
              Remover foto
            </SubmitButton>
          ) : null}
        </div>
      </div>
    </form>
  )
}
