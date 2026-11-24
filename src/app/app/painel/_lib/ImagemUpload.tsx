'use client'
import { useEffect, useId, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { FOTO_MAX_BYTES, SubmitButton } from '@/ui/components'

/**
 * Envio de uma imagem retangular (banner, prêmio): formulário POST multipart para a rota própria, que funciona sem
 * JavaScript. Mostra a prévia em 16:9 antes de enviar e avisa na hora se o arquivo passa de 8 MB.
 */
export function ImagemUpload({ action, rotulo, src, dica }: { action: string; rotulo: string; src: string | null; dica: string }) {
  const id = useId()
  const [previa, setPrevia] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  useEffect(() => {
    if (previa === null) return
    return () => URL.revokeObjectURL(previa)
  }, [previa])
  const mostrada = previa ?? src
  return (
    <form method="post" action={action} encType="multipart/form-data" className="af-imgup">
      <div className="af-imgup__frame">
        {mostrada ? (
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui
          <img src={mostrada} alt={previa ? 'Prévia da imagem escolhida' : rotulo} className="af-imgup__img" />
        ) : (
          <span className="af-imgup__empty">Sem imagem</span>
        )}
      </div>
      <div className="af-imgup__body">
        <label htmlFor={id} className="af-field__label">
          {rotulo}
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
              setAviso('A imagem passa de 8 MB. Escolha um arquivo menor.')
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
          <p className="af-field__hint">{dica}</p>
        )}
        <div className="af-avatarup__actions">
          <SubmitButton variant="secondary" size="sm" icon={<Camera size={16} />}>
            Enviar imagem
          </SubmitButton>
          {src ? (
            <SubmitButton name="intent" value="remove" variant="ghost" size="sm" icon={<Trash2 size={16} />}>
              Remover imagem
            </SubmitButton>
          ) : null}
        </div>
      </div>
    </form>
  )
}
