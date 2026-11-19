import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

it('shows a recovery action if the app fails to render', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  function BrokenApp(): never {
    throw new Error('Render failed')
  }

  try {
    render(
      <AppErrorBoundary>
        <BrokenApp />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The app could not open',
    )
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeVisible()
  } finally {
    consoleError.mockRestore()
  }
})
