import {
  Barlow_Condensed,
  Fredoka,
  Hanken_Grotesk,
  Schibsted_Grotesk,
  Zilla_Slab,
} from 'next/font/google'

const ui = Hanken_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-ui' })
const stamp = Barlow_Condensed({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700'],
  variable: '--font-stamp',
})
const classic = Zilla_Slab({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '600', '700'],
  variable: '--font-display-classic',
})
const modern = Schibsted_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display-modern',
})
const friendly = Fredoka({ subsets: ['latin'], display: 'swap', variable: '--font-display-friendly' })

/** Classes para o <html>. */
export const fontVariables: string = [ui, stamp, classic, modern, friendly]
  .map((f) => f.variable)
  .join(' ')
