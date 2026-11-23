import QRCode from 'qrcode'
import { env } from './env'

/** O link que a loja passa aos clientes: o app web na raiz do endereço da loja (`<APP_WEB_URL>/<slug>`). */
export function customerLinkUrl(slug: string, base: string = env.APP_WEB_URL): string {
  return `${base}/${slug}`
}

/** O QR code do link como SVG (preto no branco, correção de erro média, com a margem de silêncio). */
export function customerLinkQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
}
