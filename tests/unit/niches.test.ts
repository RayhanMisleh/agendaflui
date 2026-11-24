import { describe, expect, test } from 'vitest'
import { NICHES, parseNicheOptions, variantOfPet, visibleVariants } from '@/server/niches'

describe('registro de nichos', () => {
  test('variantOfPet: cão médio → DOG_MEDIUM; gato → CAT', () => {
    expect(variantOfPet({ species: 'DOG', size: 'MEDIUM' })).toBe('DOG_MEDIUM')
    expect(variantOfPet({ species: 'DOG', size: 'GIANT' })).toBe('DOG_GIANT')
    expect(variantOfPet({ species: 'CAT', size: null })).toBe('CAT')
  })

  test('variantOfPet: cão sem porte lança', () => {
    expect(() => variantOfPet({ species: 'DOG', size: null })).toThrow()
  })

  test('visibleVariants esconde gato sem servesCats e mostra com ele', () => {
    expect(visibleVariants(NICHES.PET, { servesCats: false }).map((v) => v.key)).toEqual(['DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT'])
    expect(visibleVariants(NICHES.PET, { servesCats: true }).map((v) => v.key)).toContain('CAT')
  })

  test('parseNicheOptions: lixo, vazio e nicho nulo viram o padrão', () => {
    expect(parseNicheOptions('PET', { servesCats: 'sim' })).toEqual({ servesCats: false })
    expect(parseNicheOptions('PET', {})).toEqual({ servesCats: false })
    expect(parseNicheOptions('PET', null)).toEqual({ servesCats: false })
    expect(parseNicheOptions(null, { servesCats: true })).toEqual({ servesCats: false })
    expect(parseNicheOptions('PET', { servesCats: true })).toEqual({ servesCats: true })
  })

  test('faixas de porte da spec', () => {
    expect(NICHES.PET.variants.map((v) => v.rangeLabel)).toEqual(['até 10 kg', '10 a 25 kg', '25 a 45 kg', 'acima de 45 kg', null])
  })

  test('sugestões: durações múltiplas de 5 entre 5 e 600 e preços inteiros', () => {
    for (const s of NICHES.PET.serviceSuggestions) {
      for (const p of Object.values(s.prices)) {
        expect(p.durationMin % 5).toBe(0)
        expect(p.durationMin).toBeGreaterThanOrEqual(5)
        expect(p.durationMin).toBeLessThanOrEqual(600)
        expect(Number.isInteger(p.priceCents)).toBe(true)
        expect(p.priceCents).toBeGreaterThan(0)
      }
    }
    expect(NICHES.PET.serviceSuggestions.map((s) => s.name)).toEqual(['Banho', 'Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha'])
  })

  test('nenhum texto do registro usa termo proibido', () => {
    expect(JSON.stringify(NICHES)).not.toMatch(/tutor|tosador|patinhas/i)
  })
})
