import QRCode from 'qrcode'
import { areaLink } from './area-links'

/** O link que a loja passa aos clientes: o endereço do app com o slug da loja (`<APP_HOST>/<slug>`). */
export function customerLinkUrl(slug: string): string {
  return areaLink('app', `/${slug}`)
}

/** O QR code do link como SVG (preto no branco, correção de erro média, com a margem de silêncio). */
export function customerLinkQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
}
