import Link from 'next/link'
import { Search } from 'lucide-react'
import { Button } from './Button'
import { Field } from './Field'
import { Input } from './Input'
import { Select } from './Select'

export type SearchFilter = {
  name: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
}

/**
 * Busca e filtros por GET: funciona sem JavaScript e deixa tudo na URL (voltar e recarregar funcionam). Enviar a busca
 * recomeça a lista (não leva cursor). "Limpar busca" só aparece com algo aplicado.
 */
export function SearchBar({
  action,
  label,
  query,
  filters,
  clearHref,
  name = 'search',
  placeholder,
}: {
  action: string
  label: string
  query: string
  filters: SearchFilter[]
  clearHref: string
  name?: string
  placeholder?: string
}) {
  const aplicado = query !== '' || filters.some((f) => f.value !== '')
  return (
    <form role="search" method="get" action={action} className="af-searchbar">
      <Field label={label} className="af-searchbar__query">
        <Input type="search" name={name} defaultValue={query} placeholder={placeholder} autoComplete="off" spellCheck={false} />
      </Field>
      {filters.map((f) => (
        <Field key={f.name} label={f.label} className="af-searchbar__filter">
          <Select name={f.name} defaultValue={f.value}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      ))}
      <div className="af-searchbar__go">
        <Button type="submit" variant="secondary" icon={<Search size={18} />}>
          Buscar
        </Button>
        {aplicado ? (
          <Link href={clearHref} className="af-searchbar__clear">
            Limpar busca
          </Link>
        ) : null}
      </div>
    </form>
  )
}
