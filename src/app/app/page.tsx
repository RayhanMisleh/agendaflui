import { redirect } from 'next/navigation'

/** Provisório: a entrada do endereço único (destino da pessoa) chega na Tarefa 6; por ora a raiz leva ao painel. */
export default function AppRaiz(): never {
  redirect('/painel')
}
