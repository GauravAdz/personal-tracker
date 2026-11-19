import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import { saveRoutine } from '../../data/repositories'
import type { CatalogExercise } from '../../domain/models'
import { GymWorkspace } from './GymWorkspace'
import { PreparationFlow } from './PreparationFlow'

const testCatalog: readonly CatalogExercise[] = [
  {
    id: 'fedb:Barbell_Bench_Press',
    sourceId: 'Barbell_Bench_Press',
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: 'barbell',
    instructions: ['Lower bar.', 'Press up.'],
    category: 'strength',
    imagePaths: ['exercises/chest/0.svg', 'exercises/chest/1.svg'],
  },
]

const routineId = '11111111-1111-4111-8111-111111111111'
const itemId = '11111111-1111-4111-8111-111111111112'

describe('PreparationFlow — optional nonblocking warm-up/cooldown checklist & timer (T17)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(async () => {
    testDb = createDatabase(`prep-flow-${crypto.randomUUID()}`)
    await saveRoutine(
      {
        id: routineId,
        name: 'Quick Bench',
        items: [
          {
            id: itemId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 3,
            repMin: 8,
            repMax: 12,
            restSeconds: 90,
          },
        ],
        createdAt: '2026-10-20T08:00:00.000Z',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
      testDb,
    )
  })

  afterEach(async () => {
    vi.useRealTimers()
    await testDb.delete()
  })

  it('can be bypassed entirely and never blocks set logging even while a warm-up timer is running', async () => {
    const user = userEvent.setup()
    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T09:00:00.000Z')}
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Start Quick Bench' }),
    )

    const prepRegion = await screen.findByRole('region', {
      name: 'Optional warm-up and cooldown',
    })
    await user.click(
      within(prepRegion).getByRole('button', { name: 'Open checklist' }),
    )

    // Start warm-up timer (5:00) and verify set logging is still immediately allowed!
    await user.click(
      within(prepRegion).getByRole('button', {
        name: 'Start timer for Cross-trainer / light cardio',
      }),
    )
    expect(
      within(prepRegion).getByRole('region', {
        name: 'Preparation step timer',
      }),
    ).toHaveTextContent('05:00')

    const logger = screen.getByRole('region', {
      name: 'Set logger for #1 Barbell Bench Press',
    })
    await user.click(
      within(logger).getByRole('button', {
        name: 'Log set for #1 Barbell Bench Press',
      }),
    )
    expect(await within(logger).findByRole('status')).toHaveTextContent(
      'Logged Set #1',
    )

    // Bypass entire warm-up/cooldown flow in one tap.
    await user.click(
      within(prepRegion).getByRole('button', { name: 'Bypass all' }),
    )
    expect(prepRegion).toHaveTextContent(/Bypassed for this workout/i)
    expect(
      within(prepRegion).queryByRole('region', {
        name: 'Preparation step timer',
      }),
    ).toBeNull()
  })

  it('recalculates step timer from wall clock after background suspension, supports pause/resume, and cleans up intervals', () => {
    vi.useFakeTimers()
    let nowMs = Date.parse('2026-10-27T10:00:00.000Z')
    const now = () => new Date(nowMs)

    const { unmount } = render(<PreparationFlow database={testDb} now={now} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open checklist' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Start timer for Dynamic mobility' }),
    )

    const timerRegion = screen.getByRole('region', {
      name: 'Preparation step timer',
    })
    expect(timerRegion).toHaveTextContent('03:00')

    // Simulate background suspension: 95 seconds elapse without intervals firing, then page becomes visible.
    nowMs += 95_000
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(timerRegion).toHaveTextContent('01:25')

    // Pause and advance wall clock 30s -> paused remaining stays 01:25.
    fireEvent.click(within(timerRegion).getByRole('button', { name: 'Pause' }))
    nowMs += 30_000
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(timerRegion).toHaveTextContent('01:25')

    // Resume and advance 85s -> timer completes and clears without errors.
    fireEvent.click(within(timerRegion).getByRole('button', { name: 'Resume' }))
    nowMs += 85_000
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(
      screen.queryByRole('region', { name: 'Preparation step timer' }),
    ).toBeNull()

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('persists user-edited checklist preferences across reload and rejects invalid step inputs', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T11:00:00.000Z')}
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Start Quick Bench' }),
    )

    const prepRegion = await screen.findByRole('region', {
      name: 'Optional warm-up and cooldown',
    })
    await user.click(
      within(prepRegion).getByRole('button', { name: 'Open checklist' }),
    )
    await user.click(
      within(prepRegion).getByRole('button', { name: 'Edit checklist' }),
    )

    // Invalid blank label rejected.
    const addRegion = within(prepRegion).getByRole('region', {
      name: 'Add preparation step',
    })
    await user.click(
      within(addRegion).getByRole('button', { name: 'Add step' }),
    )
    expect(within(addRegion).getByRole('alert')).toBeVisible()

    // Invalid negative duration rejected.
    await user.type(
      within(addRegion).getByLabelText('Step label'),
      'Band pull-aparts',
    )
    const durationInput = within(addRegion).getByLabelText('Duration (seconds)')
    await user.clear(durationInput)
    await user.type(durationInput, '-10')
    await user.click(
      within(addRegion).getByRole('button', { name: 'Add step' }),
    )
    expect(within(addRegion).getByRole('alert')).toBeVisible()

    // Valid custom step added and default cross-trainer step removed.
    await user.clear(durationInput)
    await user.type(durationInput, '60')
    await user.click(
      within(addRegion).getByRole('button', { name: 'Add step' }),
    )
    expect(
      await within(prepRegion).findByText('Band pull-aparts'),
    ).toBeVisible()

    await user.click(
      within(prepRegion).getByRole('button', {
        name: 'Remove Cross-trainer / light cardio',
      }),
    )

    // Simulate reload: unmount and remount GymWorkspace.
    unmount()
    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T11:05:00.000Z')}
      />,
    )

    const reloadedPrep = await screen.findByRole('region', {
      name: 'Optional warm-up and cooldown',
    })
    await user.click(
      within(reloadedPrep).getByRole('button', { name: 'Open checklist' }),
    )
    expect(within(reloadedPrep).getByText('Band pull-aparts')).toBeVisible()
    expect(
      within(reloadedPrep).queryByText('Cross-trainer / light cardio'),
    ).toBeNull()
  })
})
