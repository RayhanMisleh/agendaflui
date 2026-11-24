import { customerLinkQrSvg, customerLinkUrl } from '@/server/customer-link'

test('link para clientes junta o host do app e o slug', () => {
  expect(customerLinkUrl('demo')).toBe('http://app.localhost:3000/demo')
})

test('QR é um SVG preto no branco que codifica o link', async () => {
  const svg = await customerLinkQrSvg('https://app.agendaflui.com.br/patas')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('<path')
  expect(svg).toContain('#000000')
  expect(svg).toContain('#ffffff')
  expect(await customerLinkQrSvg('https://app.agendaflui.com.br/outra')).not.toBe(svg)
})
