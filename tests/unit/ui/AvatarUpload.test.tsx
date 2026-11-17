// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AvatarUpload } from '@/ui/components/AvatarUpload'

const criar = vi.fn()
const revogar = vi.fn()
beforeEach(() => {
  criar.mockReset().mockImplementation(() => `blob:previa-${criar.mock.calls.length}`)
  revogar.mockReset()
  Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar })
})

const foto = (nome: string) => new File(['x'], nome, { type: 'image/png' })

test('cada prévia nova revoga a anterior e sair da tela revoga a última', async () => {
  const { unmount } = render(<AvatarUpload action="/foto" name="Ana" src={null} />)
  const campo = screen.getByLabelText('Foto de Ana')
  await userEvent.upload(campo, foto('a.png'))
  expect(criar).toHaveBeenCalledTimes(1)
  expect(revogar).not.toHaveBeenCalled()
  await userEvent.upload(campo, foto('b.png'))
  expect(criar).toHaveBeenCalledTimes(2)
  expect(revogar).toHaveBeenCalledWith('blob:previa-1')
  unmount()
  expect(revogar).toHaveBeenCalledWith('blob:previa-2')
})
