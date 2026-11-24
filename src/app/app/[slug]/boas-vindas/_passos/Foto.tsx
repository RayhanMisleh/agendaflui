'use client'
import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button, PetIllustration } from '@/ui/components'
import { variantOfPet } from '@/server/niches'
import { Pergunta, type PassoProps } from './Pergunta'

const MAX_FOTO = 8 * 1024 * 1024

/** Prévia redonda da foto escolhida (lida no aparelho; nada sobe antes de o pet ser salvo). */
export function usePrevia(foto: File | null): string | null {
  const [lida, setLida] = useState<{ foto: File; url: string } | null>(null)
  useEffect(() => {
    if (!foto) return
    const leitor = new FileReader()
    leitor.onload = () => {
      if (typeof leitor.result === 'string') setLida({ foto, url: leitor.result })
    }
    leitor.readAsDataURL(foto)
    return () => leitor.abort()
  }, [foto])
  return foto && lida?.foto === foto ? lida.url : null
}

export function Foto({ a, set, error }: PassoProps) {
  const entrada = useRef<HTMLInputElement>(null)
  const [recusa, setRecusa] = useState<string | null>(null)
  const previa = usePrevia(a.photo)
  const variante = variantOfPet({ species: a.species, size: a.size ?? 'MEDIUM' })

  function escolheu(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > MAX_FOTO) {
      setRecusa('A foto passa de 8 MB. Escolha uma menor.')
      return
    }
    setRecusa(null)
    set({ photo: arquivo })
  }

  return (
    <Pergunta step="photo" hint="Aparece no seu histórico e para a equipe." error={error ?? recusa}>
      <div className="af-cl-quiz__photo">
        <span className="af-cl-quiz__avatar" aria-hidden="true">
          {previa ? (
            // eslint-disable-next-line @next/next/no-img-element -- prévia local da foto escolhida (blob:), sem otimização
            <img src={previa} alt="" className="af-cl-quiz__avatar-img" />
          ) : (
            <PetIllustration variant={variante} size={64} />
          )}
        </span>
        <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="af-sr" tabIndex={-1} aria-label="Foto do pet" onChange={(e) => escolheu(e.target.files?.[0])} />
        <Button variant="secondary" size="lg" icon={<Camera size={18} />} onClick={() => entrada.current?.click()}>
          {a.photo ? 'Trocar foto' : 'Escolher foto'}
        </Button>
        {a.photo ? (
          <Button variant="ghost" onClick={() => set({ photo: null })}>
            Remover foto
          </Button>
        ) : null}
      </div>
    </Pergunta>
  )
}
