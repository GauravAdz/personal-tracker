import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('app shell', () => {
  it('opens Home with five labelled navigation links and Today dashboard', async () => {
    renderApp()
    expect(
      screen.getByRole('heading', { name: 'Home', level: 1 }),
    ).toBeVisible()
    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })
    expect(within(navigation).getAllByRole('link')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      await screen.findByRole('region', { name: 'Workout call to action' }),
    ).toBeVisible()
  })

  it('navigates to each destination and moves focus to the content', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const name of [
      'Workouts',
      'Exercises',
      'Health',
      'Settings',
      'Home',
    ]) {
      await user.click(screen.getByRole('link', { name }))
      expect(screen.getByRole('heading', { name, level: 1 })).toBeVisible()
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
      expect(screen.getByRole('main')).toHaveFocus()
      expect(document.title).toBe(`${name} · Personal Tracker`)
    }
  })

  it('supports keyboard navigation and skipping directly to content', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Workouts' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('heading', { name: 'Workouts', level: 1 }),
    ).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Skip to content' }))
    expect(screen.getByRole('main')).toHaveFocus()
    expect(
      screen.getByRole('heading', { name: 'Workouts', level: 1 }),
    ).toBeVisible()
  })

  it('opens a linked route directly', () => {
    renderApp('/health')
    expect(
      screen.getByRole('heading', { name: 'Health', level: 1 }),
    ).toBeVisible()
  })

  it('offers a working recovery link for an unknown route', async () => {
    const user = userEvent.setup()
    renderApp('/missing')
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Return to Home' }))
    expect(
      screen.getByRole('heading', { name: 'Home', level: 1 }),
    ).toBeVisible()
  })
})
