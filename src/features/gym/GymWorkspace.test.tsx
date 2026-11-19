import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  appendSet,
  InvalidSessionStateError,
  ParentReferenceError,
  RecordNotFoundError,
  saveRoutine,
} from '../../data/repositories'
import type { CatalogExercise } from '../../domain/models'
import {
  addExerciseToActiveSession,
  reorderSessionExercise,
  skipSessionExercise,
} from '../../services/workout'
import { GymWorkspace } from './GymWorkspace'

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
  {
    id: 'fedb:Incline_Dumbbell_Press',
    sourceId: 'Incline_Dumbbell_Press',
    name: 'Incline Dumbbell Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: 'dumbbell',
    instructions: ['Lower dumbbells.', 'Press up.'],
    category: 'strength',
    imagePaths: ['exercises/chest/0.svg', 'exercises/chest/1.svg'],
  },
  {
    id: 'fedb:One-Arm_Dumbbell_Row',
    sourceId: 'One-Arm_Dumbbell_Row',
    name: 'One-Arm Dumbbell Row',
    primaryMuscles: ['middle back'],
    secondaryMuscles: ['lats', 'biceps'],
    equipment: 'dumbbell',
    instructions: ['Brace on bench.', 'Row dumbbell.'],
    category: 'strength',
    imagePaths: ['exercises/back/0.svg', 'exercises/back/1.svg'],
  },
]

const routineId = '11111111-1111-4111-8111-111111111111'
const itemOneId = '11111111-1111-4111-8111-111111111112'
const itemTwoId = '11111111-1111-4111-8111-111111111113'
const itemThreeId = '11111111-1111-4111-8111-111111111114'

describe('GymWorkspace — start, resume, reorder/skip, finish, and cancel workout (T10)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(async () => {
    testDb = createDatabase(`gym-workspace-${crypto.randomUUID()}`)
    await saveRoutine(
      {
        id: routineId,
        name: 'Push & Pull',
        items: [
          {
            id: itemOneId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 4,
            repMin: 6,
            repMax: 8,
            restSeconds: 150,
          },
          {
            id: itemTwoId,
            exerciseId: 'fedb:Incline_Dumbbell_Press',
            order: 1,
            workingSets: 3,
            repMin: 8,
            repMax: 12,
            restSeconds: 120,
          },
          {
            id: itemThreeId,
            exerciseId: 'fedb:One-Arm_Dumbbell_Row',
            order: 2,
            workingSets: 3,
            repMin: 8,
            repMax: 12,
            restSeconds: 90,
          },
        ],
        createdAt: '2026-10-27T07:00:00.000Z',
        updatedAt: '2026-10-27T07:00:00.000Z',
      },
      testDb,
    )
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('snapshots a routine, preserves reordered active exercises across reload, ignores mid-workout template edits, and finishes after skipping', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T08:00:00.000Z')}
      />,
    )

    const startBtn = await screen.findByRole('button', {
      name: 'Start Push & Pull',
    })
    await user.click(startBtn)

    const activeSection = await screen.findByRole('region', {
      name: 'Active workout session',
    })
    expect(activeSection).toBeVisible()

    // Reorder #2 Incline Dumbbell Press to #1
    await user.click(
      within(activeSection).getByRole('button', {
        name: 'Move up #2 Incline Dumbbell Press',
      }),
    )

    expect(
      await within(activeSection).findByRole('heading', {
        name: '#1 Incline Dumbbell Press',
      }),
    ).toBeVisible()

    // Edit the routine template mid-workout (change workingSets to 9 and remove items)
    await saveRoutine(
      {
        id: routineId,
        name: 'Push & Pull Edited Template',
        items: [
          {
            id: itemOneId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 9,
            repMin: 1,
            repMax: 3,
            restSeconds: 60,
          },
        ],
        createdAt: '2026-10-27T07:00:00.000Z',
        updatedAt: '2026-10-27T08:05:00.000Z',
      },
      testDb,
    )

    // Simulate reload: unmount and remount GymWorkspace against the same IndexedDB
    unmount()
    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T08:30:00.000Z')}
      />,
    )

    const resumedSection = await screen.findByRole('region', {
      name: 'Active workout session',
    })
    const headings = within(resumedSection)
      .getAllByRole('heading', { level: 3 })
      .map((el) => el.textContent)
    expect(headings).toEqual([
      '#1 Incline Dumbbell Press',
      '#2 Barbell Bench Press',
      '#3 One-Arm Dumbbell Row',
    ])
    // Active snapshot targetSets on Barbell Bench Press is still 4 × 6–8, untouched by template edit!
    expect(
      within(resumedSection).getByText(/Target: 4 × 6–8 reps/i),
    ).toBeVisible()

    // Skip #3 One-Arm Dumbbell Row
    await user.click(
      within(resumedSection).getByRole('button', {
        name: 'Skip #3 One-Arm Dumbbell Row',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Skipped One-Arm Dumbbell Row in active workout.',
    )

    // Finish workout with confirmation
    await user.click(
      within(resumedSection).getByRole('button', { name: 'Finish workout' }),
    )
    const confirmRegion = await screen.findByRole('region', {
      name: 'Confirm finishing workout',
    })
    await user.click(
      within(confirmRegion).getByRole('button', {
        name: 'Confirm finish workout',
      }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Workout completed and saved to session history.',
    )

    const historySection = screen.getByRole('region', {
      name: 'Workout session history',
    })
    expect(within(historySection).getByText('Completed')).toBeVisible()
    expect(
      within(historySection).getByText(
        /Exercises: Incline Dumbbell Press, Barbell Bench Press/i,
      ),
    ).toBeVisible()
    expect(
      within(historySection).getByText(/Note: Skipped: One-Arm Dumbbell Row/i),
    ).toBeVisible()
  })

  it('handles empty sessions and preserves logged sets when cancelling an active workout', async () => {
    const user = userEvent.setup()
    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T09:00:00.000Z')}
      />,
    )

    // 1. Start and finish an empty ad-hoc workout (0 exercises)
    const startEmptyBtn = await screen.findByRole('button', {
      name: 'Start empty workout',
    })
    await user.click(startEmptyBtn)

    const emptyActive = await screen.findByRole('region', {
      name: 'Active workout session',
    })
    expect(
      within(emptyActive).getByText(/No exercises in this session yet/i),
    ).toBeVisible()

    await user.click(
      within(emptyActive).getByRole('button', { name: 'Finish workout' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Confirm finish workout' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Workout completed and saved to session history.',
    )
    expect(screen.getByText(/Empty session \(0 exercises\)/i)).toBeVisible()

    // 2. Start routine workout, log a set, then cancel with confirmation -> logs are preserved
    await user.click(screen.getByRole('button', { name: 'Start Push & Pull' }))
    const activeRegion = await screen.findByRole('region', {
      name: 'Active workout session',
    })

    const [activeSession] = await testDb.sessions
      .where('status')
      .equals('active')
      .toArray()
    const sessionExercises = await testDb.sessionExercises
      .where('sessionId')
      .equals(activeSession!.id)
      .sortBy('order')

    await appendSet(
      {
        sessionId: activeSession!.id,
        sessionExerciseId: sessionExercises[0]!.id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: 80,
        reps: 7,
        completedAt: '2026-10-27T09:05:00.000Z',
      },
      testDb,
    )

    await user.click(
      within(activeRegion).getByRole('button', { name: 'Cancel workout' }),
    )
    const cancelConfirm = await screen.findByRole('region', {
      name: 'Confirm cancelling workout',
    })
    expect(cancelConfirm).toHaveTextContent(
      /Any sets already logged will be kept in your session history/i,
    )
    await user.click(
      within(cancelConfirm).getByRole('button', {
        name: 'Confirm cancel workout',
      }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      /Workout cancelled\. All logged sets and exercises remain preserved/i,
    )
    expect(await testDb.setLogs.count()).toBe(1)

    const historySection = screen.getByRole('region', {
      name: 'Workout session history',
    })
    expect(within(historySection).getByText('Cancelled')).toBeVisible()
    expect(
      within(historySection).getByText(/Sets logged: 1 working, 0 warm-up/i),
    ).toBeVisible()

    // 3. Verify service failure paths on non-active / missing sessions
    const cancelledId = activeSession!.id
    await expect(
      reorderSessionExercise(
        cancelledId,
        sessionExercises[0]!.id,
        'down',
        testDb,
      ),
    ).rejects.toThrow(InvalidSessionStateError)

    await expect(
      skipSessionExercise(cancelledId, sessionExercises[0]!.id, testDb),
    ).rejects.toThrow(InvalidSessionStateError)

    await expect(
      reorderSessionExercise(
        '99999999-9999-4999-8999-999999999999',
        sessionExercises[0]!.id,
        'down',
        testDb,
      ),
    ).rejects.toThrow(RecordNotFoundError)

    await expect(
      addExerciseToActiveSession(
        cancelledId,
        'fedb:Unknown_Exercise',
        { catalog: testCatalog },
        testDb,
      ),
    ).rejects.toThrow(ParentReferenceError)
  })
})
