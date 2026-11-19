import 'fake-indexeddb/auto'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../data/db'
import { startSession } from '../data/repositories/sessions'
import { UpdatePrompt } from './UpdatePrompt'

const sessionId = '22222222-2222-4222-8222-222222222221'

describe('UpdatePrompt', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`update-prompt-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('stays hidden when no service worker update or offline notification is pending', () => {
    render(<UpdatePrompt database={testDb} />)
    expect(
      screen.queryByRole('complementary', {
        name: 'Application update status',
      }),
    ).not.toBeInTheDocument()
  })

  it('shows non-blocking update prompt during an active workout without auto-reloading, and allows postpone or explicit reload', async () => {
    const user = userEvent.setup()
    const onAcceptUpdate = vi.fn()

    await startSession(
      null,
      { id: sessionId, startedAt: '2026-10-27T08:00:00.000Z' },
      testDb,
    )

    render(
      <UpdatePrompt
        database={testDb}
        needRefreshOverride={true}
        onAcceptUpdate={onAcceptUpdate}
      />,
    )

    expect(await screen.findByText(/Active workout in progress/i)).toBeVisible()
    // Must never auto-trigger update on mount.
    expect(onAcceptUpdate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(onAcceptUpdate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Postpone' }))
    expect(
      screen.queryByRole('complementary', {
        name: 'Application update status',
      }),
    ).not.toBeInTheDocument()
  })

  it('responds to the sw-update-available event and supports dismissing the offline-ready banner', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <UpdatePrompt database={testDb} offlineReadyOverride={true} />,
    )

    expect(
      screen.getByText(/Offline ready: app shell cached for offline use\./i),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(
      screen.queryByText(/Offline ready: app shell cached for offline use\./i),
    ).not.toBeInTheDocument()

    rerender(<UpdatePrompt database={testDb} />)
    act(() => {
      window.dispatchEvent(new Event('personal-tracker:sw-update-available'))
    })

    expect(
      await screen.findByText(
        /Update available: a new version of Personal Tracker is ready\./i,
      ),
    ).toBeVisible()
  })
})
