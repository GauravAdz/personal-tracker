import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  appendSet,
  finishSession,
  saveAppSettings,
  saveBodyWeight,
  saveHabitDefinition,
  saveRoutine,
  startSession,
} from '../../data/repositories'
import { HomeDashboard } from './HomeDashboard'

const routineId = '11111111-1111-4111-8111-111111111111'
const routineItemId = '11111111-1111-4111-8111-111111111112'
const habitId = '22222222-2222-4222-8222-222222222221'
const amSlotId = '22222222-2222-4222-8222-222222222222'
const pmSlotId = '22222222-2222-4222-8222-222222222223'

describe('HomeDashboard — compact Today screen, quick check-ins, Resume/Start CTA, and live refresh (T16)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`home-dashboard-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('renders honest empty states and Start workout CTA on an empty install', async () => {
    render(
      <MemoryRouter>
        <HomeDashboard
          database={testDb}
          now={() => new Date('2026-10-27T09:00:00.000Z')}
          timeZone="Europe/Vienna"
        />
      </MemoryRouter>,
    )

    const ctaRegion = await screen.findByRole('region', {
      name: 'Workout call to action',
    })
    expect(
      within(ctaRegion).getByRole('link', { name: 'Start workout' }),
    ).toHaveAttribute('href', '/workouts')
    expect(screen.getByText(/2026-10-27/)).toBeVisible()
    expect(screen.getByText(/Europe\/Vienna/)).toBeVisible()

    expect(
      screen.getByText('No active daily habits configured yet.'),
    ).toBeVisible()
    expect(screen.getByText('No completed workouts yet.')).toBeVisible()
    expect(
      screen.getByText('No body-weight check-ins yet (0 of 7 days).'),
    ).toBeVisible()

    const backupRegion = screen.getByRole('region', {
      name: 'Backup status and settings',
    })
    expect(backupRegion).toHaveTextContent('Last exported: Never exported')
    expect(
      within(backupRegion).getByRole('link', {
        name: 'Open Settings & Backups',
      }),
    ).toHaveAttribute('href', '/settings')
  })

  it('displays Resume workout CTA, last completed workout, 7-day weight trend, stale export reminder, and quick habit logging', async () => {
    const user = userEvent.setup()

    await saveRoutine(
      {
        id: routineId,
        name: 'Upper Strength',
        items: [
          {
            id: routineItemId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 3,
            repMin: 6,
            repMax: 8,
            restSeconds: 120,
          },
        ],
        createdAt: '2026-10-20T08:00:00.000Z',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
      testDb,
    )

    // Completed workout from Oct 25 with 2 working sets.
    const prior = await startSession(
      routineId,
      { startedAt: '2026-10-25T08:00:00.000Z' },
      testDb,
    )
    await appendSet(
      {
        sessionId: prior.session.id,
        sessionExerciseId: prior.exercises[0]!.id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: 80,
        reps: 8,
        completedAt: '2026-10-25T08:10:00.000Z',
      },
      testDb,
    )
    await appendSet(
      {
        sessionId: prior.session.id,
        sessionExerciseId: prior.exercises[0]!.id,
        ordinal: 2,
        kind: 'working',
        externalLoadKg: 80,
        reps: 8,
        completedAt: '2026-10-25T08:15:00.000Z',
      },
      testDb,
    )
    await finishSession(
      prior.session.id,
      { endedAt: '2026-10-25T08:40:00.000Z' },
      testDb,
    )

    // Active workout started Oct 27 with 1 set logged.
    const active = await startSession(
      routineId,
      { startedAt: '2026-10-27T08:00:00.000Z' },
      testDb,
    )
    await appendSet(
      {
        sessionId: active.session.id,
        sessionExerciseId: active.exercises[0]!.id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: 82.5,
        reps: 7,
        completedAt: '2026-10-27T08:10:00.000Z',
      },
      testDb,
    )

    // Active daily habit with AM / PM slots.
    await saveHabitDefinition(
      {
        id: habitId,
        name: 'Daily Routine',
        slots: [
          { id: amSlotId, label: 'AM', localTime: '08:00' },
          { id: pmSlotId, label: 'PM', localTime: '20:00' },
        ],
        archived: false,
        createdAt: '2026-10-20T08:00:00.000Z',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
      testDb,
    )

    // Body-weight check-ins across 2 days in the 7-day window.
    await saveBodyWeight(
      {
        weightKg: 79.0,
        occurredAt: '2026-10-25T07:00:00.000Z',
        localDate: '2026-10-25',
        timeZone: 'Europe/Vienna',
      },
      testDb,
    )
    await saveBodyWeight(
      {
        weightKg: 80.0,
        occurredAt: '2026-10-27T07:00:00.000Z',
        localDate: '2026-10-27',
        timeZone: 'Europe/Vienna',
      },
      testDb,
    )

    // Exported 10 days ago -> should trigger gentle 7-day reminder.
    await saveAppSettings(
      {
        id: 'singleton',
        preferredMassUnit: 'kg',
        catalogVersion: 'fedb-b67291321c9f',
        lastExportedAt: '2026-10-17T08:00:00.000Z',
      },
      testDb,
    )

    render(
      <MemoryRouter>
        <HomeDashboard
          database={testDb}
          now={() => new Date('2026-10-27T09:00:00.000Z')}
          timeZone="Europe/Vienna"
        />
      </MemoryRouter>,
    )

    // Primary CTA shows Resume workout for active session.
    const ctaRegion = await screen.findByRole('region', {
      name: 'Workout call to action',
    })
    expect(
      within(ctaRegion).getByRole('link', { name: 'Resume workout' }),
    ).toHaveAttribute('href', '/workouts')
    expect(ctaRegion).toHaveTextContent('Upper Strength')
    expect(ctaRegion).toHaveTextContent('1 set logged')

    // Last workout summary shows completed Oct 25 session.
    const lastWorkoutRegion = screen.getByRole('region', {
      name: 'Last workout summary',
    })
    expect(lastWorkoutRegion).toHaveTextContent('Upper Strength')
    expect(lastWorkoutRegion).toHaveTextContent('Completed')
    expect(lastWorkoutRegion).toHaveTextContent('2026-10-25')
    expect(lastWorkoutRegion).toHaveTextContent('2 working sets')

    // Weight summary shows latest + 7-day average (2 of 7 days).
    const weightRegion = screen.getByRole('region', {
      name: 'Body-weight trend summary',
    })
    expect(weightRegion).toHaveTextContent('Latest: 80 kg (2026-10-27)')
    expect(weightRegion).toHaveTextContent(
      '7-day average: 79.5 kg (2 of 7 days)',
    )

    // Export reminder shows Oct 17 date and 7-day reminder.
    const backupRegion = screen.getByRole('region', {
      name: 'Backup status and settings',
    })
    expect(backupRegion).toHaveTextContent('Last exported: 2026-10-17')
    expect(backupRegion).toHaveTextContent(/at least 7 days old/i)

    // Quick-log AM done and PM skipped directly on Home.
    await user.click(
      screen.getByRole('button', {
        name: 'Quick mark done: Daily Routine — AM',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked "Daily Routine — AM" as done for 2026-10-27.',
    )

    await user.click(
      screen.getByRole('button', { name: 'Quick skip: Daily Routine — PM' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked "Daily Routine — PM" as skipped for 2026-10-27.',
    )
    expect(await testDb.habitLogs.count()).toBe(2)

    // Quick undo PM leaves AM done.
    await user.click(
      screen.getByRole('button', { name: 'Quick undo: Daily Routine — PM' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Cleared check-in for "Daily Routine — PM" on 2026-10-27.',
    )
    expect(await testDb.habitLogs.count()).toBe(1)
  })

  it('reflects recent IndexedDB changes on focus without a hard reload and handles load errors with Retry', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <HomeDashboard
          database={testDb}
          now={() => new Date('2026-10-27T10:00:00.000Z')}
          timeZone="Europe/Vienna"
        />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('link', { name: 'Start workout' }),
    ).toBeVisible()

    // Mutate DB as if user logged data on another view, then focus window (no reload).
    await startSession(null, { startedAt: '2026-10-27T10:00:00.000Z' }, testDb)
    await saveBodyWeight(
      {
        weightKg: 77.4,
        occurredAt: '2026-10-27T09:30:00.000Z',
        localDate: '2026-10-27',
        timeZone: 'Europe/Vienna',
      },
      testDb,
    )

    fireEvent.focus(window)

    expect(
      await screen.findByRole('link', { name: 'Resume workout' }),
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Body-weight trend summary' }),
    ).toHaveTextContent('Latest: 77.4 kg (2026-10-27)')

    // Failure path: simulate transient storage failure on focus, then recover via Retry.
    const spy = vi
      .spyOn(testDb.bodyWeights, 'toArray')
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    fireEvent.focus(window)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not load today/i,
    )
    spy.mockRestore()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('link', { name: 'Resume workout' }),
    ).toBeVisible()
  })
})
