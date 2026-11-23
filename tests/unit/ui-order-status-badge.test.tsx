// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ATTENTION_LABELS, OrderStatusBadge, orderStatusText } from '@/ui/components/OrderStatusBadge'

const STATUS = ['AWAITING_PAYMENT', 'PAID', 'CANCELED', 'EXPIRED'] as const
const ENTREGA = ['PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'] as const
const METODO = ['PICKUP', 'SHIPPING'] as const
const ATENCAO = [null, 'amount_mismatch', 'stock_shortfall', 'payment_reversed', 'double_payment'] as const

describe('OrderStatusBadge', () => {
  test('dá texto para toda combinação de situação, entrega e atenção (nunca só cor)', () => {
    for (const status of STATUS)
      for (const fulfillmentStatus of ENTREGA)
        for (const deliveryMethod of METODO)
          for (const attention of ATENCAO) {
            const { container, unmount } = render(<OrderStatusBadge status={status} fulfillmentStatus={fulfillmentStatus} deliveryMethod={deliveryMethod} attention={attention} />)
            const texto = (container.textContent ?? '').trim()
            expect(texto.length, `${status} ${fulfillmentStatus} ${deliveryMethod} ${String(attention)}`).toBeGreaterThan(3)
            expect(texto).toContain(orderStatusText(status, fulfillmentStatus, deliveryMethod))
            if (attention !== null) expect(texto).toContain(ATTENTION_LABELS[attention])
            else for (const rotulo of Object.values(ATTENTION_LABELS)) expect(texto).not.toContain(rotulo)
            unmount()
          }
  })

  test('os textos principais', () => {
    expect(orderStatusText('AWAITING_PAYMENT', 'PENDING', 'PICKUP')).toBe('Aguardando pagamento')
    expect(orderStatusText('PAID', 'PENDING', 'PICKUP')).toBe('Pago, a separar')
    expect(orderStatusText('PAID', 'READY_FOR_PICKUP', 'PICKUP')).toBe('Pronto para retirar')
    expect(orderStatusText('PAID', 'PENDING', 'SHIPPING')).toBe('Pago, a enviar')
    expect(orderStatusText('PAID', 'SHIPPED', 'SHIPPING')).toBe('Enviado')
    expect(orderStatusText('PAID', 'DELIVERED', 'SHIPPING')).toBe('Entregue')
    expect(orderStatusText('CANCELED', 'PENDING', 'PICKUP')).toBe('Cancelado')
    expect(orderStatusText('EXPIRED', 'PENDING', 'PICKUP')).toBe('Venceu sem pagamento')
    expect(ATTENTION_LABELS).toEqual({ amount_mismatch: 'Valor divergente', stock_shortfall: 'Pago sem estoque', payment_reversed: 'Pagamento devolvido', double_payment: 'Pagamento em dobro' })
  })

  test('mostra a atenção como selo com o texto', () => {
    render(<OrderStatusBadge status="PAID" fulfillmentStatus="PENDING" deliveryMethod="PICKUP" attention="stock_shortfall" />)
    expect(screen.getByText('Pago sem estoque')).toBeTruthy()
    expect(screen.getByText('Pago, a separar')).toBeTruthy()
  })
})
