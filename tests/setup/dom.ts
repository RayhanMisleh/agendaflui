// Preparação para testes de componentes. Tolera ambiente `node` (sem window).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof window !== 'undefined') {
  afterEach(() => cleanup())

  // jsdom não implementa <dialog>.showModal/close: polyfill mínimo.
  const proto = window.HTMLDialogElement?.prototype
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
}
