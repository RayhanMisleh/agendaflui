'use client'
import { ArrowLeft, SkipForward } from 'lucide-react'
import { LinkButton } from '@/ui/components'
import { AcaoDeLinha } from '../../_lib/AcaoDeLinha'
import { DispensarComeco } from '../../_lib/DispensarComeco'
import { dispensar, pularPasso } from '../actions'

/**
 * O rodapé de todo passo, abaixo do botão principal (que fica no formulário do passo): "Voltar" (um link, funciona sem
 * JavaScript), "Pular por agora" (marca como pulado e avança) e o link discreto para dispensar o passo a passo.
 */
export function Navegacao({ passo, voltar, pular = true }: { passo: string; voltar: string | null; pular?: boolean }) {
  return (
    <div className="af-onb__nav">
      {voltar ? (
        <LinkButton href={voltar} variant="ghost" size="sm" icon={<ArrowLeft size={16} />}>
          Voltar
        </LinkButton>
      ) : null}
      {pular ? (
        <AcaoDeLinha action={pularPasso} campos={{ passo }} variant="ghost" icon={<SkipForward size={16} />}>
          Pular por agora
        </AcaoDeLinha>
      ) : null}
      <DispensarComeco action={dispensar} className="af-onb__dismiss" />
    </div>
  )
}
