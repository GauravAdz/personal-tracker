import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  appendSet,
  finishSession,
  RecordNotFoundError,
  saveRoutine,
  startSession,
} from '../../data/repositories'
import type { CatalogExercise } from '../../domain/models'
import { undoWorkoutSet } from '../../services/workout'
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

describe('SetLogger — fast set logging, previous sets, reload/edit, and duplicate-tap guard (T11)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(async () => {
    testDb = createDatabase(`set-logger-${crypto.randomUUID()}`)

    // Routine with Barbell Bench Press appearing twice (distinct routine item IDs) + One-Arm Dumbbell Row.
    await saveRoutine(
      {
        id: routineId,
        name: 'Bench Double Specialization',
        items: [
          {
            id: itemOneId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 3,
            repMin: 6,
            repMax: 8,
            restSeconds: 150,
          },
          {
            id: itemTwoId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 1,
            workingSets: 2,
            repMin: 10,
            repMax: 12,
            restSeconds: 90,
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
        createdAt: '2026-10-20T08:00:00.000Z',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
      testDb,
    )

    // Seed a prior completed workout with 1 warmup set (50kg x 10) and 2 working sets (80kg x 8, 80kg x 7) on Bench Press.
    const prior = await startSession(
      routineId,
      { startedAt: '2026-10-24T08:00:00.000Z' },
      testDb,
    )
    const priorBench = prior.exercises[0]!
    await appendSet(
      {
        sessionId: prior.session.id,
        sessionExerciseId: priorBench.id,
        ordinal: 1,
        kind: 'warmup',
        externalLoadKg: 50,
        reps: 10,
        completedAt: '2026-10-24T08:05:00.000Z',
      },
      testDb,
    )
    await appendSet(
      {
        sessionId: prior.session.id,
        sessionExerciseId: priorBench.id,
        ordinal: 2,
        kind: 'working',
        externalLoadKg: 80,
        reps: 8,
        completedAt: '2026-10-24T08:10:00.000Z',
      },
      testDb,
    )
    await appendSet(
      {
        sessionId: prior.session.id,
        sessionExerciseId: priorBench.id,
        ordinal: 3,
        kind: 'working',
        externalLoadKg: 80,
        reps: 7,
        completedAt: '2026-10-24T08:15:00.000Z',
      },
      testDb,
    )
    await finishSession(
      prior.session.id,
      { endedAt: '2026-10-24T08:40:00.000Z' },
      testDb,
    )
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('displays previous working sets excluding warmups, logs 3+ sets, keeps duplicate exercises separated, and survives reload + edit/undo without duplication', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T10:00:00.000Z')}
      />,
    )

    await user.click(
      await screen.findByRole('button', {
        name: 'Start Bench Double Specialization',
      }),
    )

    const loggerOne = await screen.findByRole('region', {
      name: 'Set logger for #1 Barbell Bench Press',
    })
    const loggerTwo = screen.getByRole('region', {
      name: 'Set logger for #2 Barbell Bench Press',
    })
    const loggerThree = screen.getByRole('region', {
      name: 'Set logger for #3 One-Arm Dumbbell Row',
    })

    // Previous working sets exclude the 50 kg warmup set, and show '—' when unavailable.
    expect(within(loggerOne).getByText('80 kg × 8, 80 kg × 7')).toBeVisible()
    expect(within(loggerThree).getByText('—')).toBeVisible()

    // Log 3 sets on #1 Barbell Bench Press: 1 warmup + 2 working sets
    await user.selectOptions(
      within(loggerOne).getByLabelText('Set kind (#1 Barbell Bench Press)'),
      'warmup',
    )
    const loadInputOne = within(loggerOne).getByLabelText(
      'Load kg (#1 Barbell Bench Press)',
    )
    const repsInputOne = within(loggerOne).getByLabelText(
      'Actual reps (#1 Barbell Bench Press)',
    )
    await user.clear(loadInputOne)
    await user.type(loadInputOne, '60')
    await user.clear(repsInputOne)
    await user.type(repsInputOne, '8')
    await user.click(
      within(loggerOne).getByRole('button', {
        name: 'Log set for #1 Barbell Bench Press',
      }),
    )
    expect(await within(loggerOne).findByRole('status')).toHaveTextContent(
      'Logged Set #1 (Warm-up: 60 kg × 8 reps).',
    )

    // Set #2 (working, 82.5 kg x 8)
    await user.selectOptions(
      within(loggerOne).getByLabelText('Set kind (#1 Barbell Bench Press)'),
      'working',
    )
    await user.clear(loadInputOne)
    await user.type(loadInputOne, '82.5')
    await user.clear(repsInputOne)
    await user.type(repsInputOne, '8')
    await user.click(
      within(loggerOne).getByRole('button', {
        name: 'Log set for #1 Barbell Bench Press',
      }),
    )
    expect(await within(loggerOne).findByRole('status')).toHaveTextContent(
      'Logged Set #2 (Working: 82.5 kg × 8 reps).',
    )

    // Set #3 (working, 82.5 kg x 7, RIR 1, feedback hard)
    await user.clear(repsInputOne)
    await user.type(repsInputOne, '7')
    await user.type(
      within(loggerOne).getByLabelText('RIR 0–10 (#1 Barbell Bench Press)'),
      '1',
    )
    await user.selectOptions(
      within(loggerOne).getByLabelText('Feedback (#1 Barbell Bench Press)'),
      'hard',
    )
    await user.click(
      within(loggerOne).getByRole('button', {
        name: 'Log set for #1 Barbell Bench Press',
      }),
    )
    expect(await within(loggerOne).findByRole('status')).toHaveTextContent(
      'Logged Set #3 (Working: 82.5 kg × 7 reps).',
    )

    // Log 1 working set on #2 Barbell Bench Press (70 kg x 11) and verify separation from #1
    const loadInputTwo = within(loggerTwo).getByLabelText(
      'Load kg (#2 Barbell Bench Press)',
    )
    const repsInputTwo = within(loggerTwo).getByLabelText(
      'Actual reps (#2 Barbell Bench Press)',
    )
    await user.clear(loadInputTwo)
    await user.type(loadInputTwo, '70')
    await user.clear(repsInputTwo)
    await user.type(repsInputTwo, '11')
    await user.click(
      within(loggerTwo).getByRole('button', {
        name: 'Log set for #2 Barbell Bench Press',
      }),
    )
    expect(await within(loggerTwo).findByRole('status')).toHaveTextContent(
      'Logged Set #1 (Working: 70 kg × 11 reps).',
    )

    // Simulate reload: unmount and remount GymWorkspace
    unmount()
    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T10:15:00.000Z')}
      />,
    )

    const reloadedLoggerOne = await screen.findByRole('region', {
      name: 'Set logger for #1 Barbell Bench Press',
    })
    const reloadedLoggerTwo = screen.getByRole('region', {
      name: 'Set logger for #2 Barbell Bench Press',
    })

    const completedListOne = within(reloadedLoggerOne).getByRole('list', {
      name: 'Completed sets for #1 Barbell Bench Press',
    })
    const completedListTwo = within(reloadedLoggerTwo).getByRole('list', {
      name: 'Completed sets for #2 Barbell Bench Press',
    })
    expect(within(completedListOne).getAllByRole('listitem')).toHaveLength(3)
    expect(within(completedListTwo).getAllByRole('listitem')).toHaveLength(1)

    // Edit Set #3 on #1 Barbell Bench Press without creating a duplicate row
    await user.click(
      within(reloadedLoggerOne).getByRole('button', {
        name: 'Edit set #3 for #1 Barbell Bench Press',
      }),
    )
    const editRepsInput =
      within(reloadedLoggerOne).getByLabelText('Edit reps (Set #3)')
    await user.clear(editRepsInput)
    await user.type(editRepsInput, '8')
    await user.click(
      within(reloadedLoggerOne).getByRole('button', {
        name: 'Save set #3 for #1 Barbell Bench Press',
      }),
    )
    expect(
      await within(reloadedLoggerOne).findByRole('status'),
    ).toHaveTextContent('Updated Set #3 (82.5 kg × 8 reps).')
    expect(within(completedListOne).getAllByRole('listitem')).toHaveLength(3)

    // Undo Set #1 (warmup) on #1 Barbell Bench Press -> remaining 2 sets re-indexed to #1 and #2
    await user.click(
      within(reloadedLoggerOne).getByRole('button', {
        name: 'Undo set #1 for #1 Barbell Bench Press',
      }),
    )
    expect(
      await within(reloadedLoggerOne).findByRole('status'),
    ).toHaveTextContent('Undid Set #1 for #1 Barbell Bench Press.')
    expect(within(completedListOne).getAllByRole('listitem')).toHaveLength(2)
  })

  it('prevents duplicate rows on rapid double-tap and rejects invalid reps', async () => {
    const user = userEvent.setup()
    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T11:00:00.000Z')}
      />,
    )

    await user.click(
      await screen.findByRole('button', {
        name: 'Start Bench Double Specialization',
      }),
    )

    const loggerOne = await screen.findByRole('region', {
      name: 'Set logger for #1 Barbell Bench Press',
    })
    const logButton = within(loggerOne).getByRole('button', {
      name: 'Log set for #1 Barbell Bench Press',
    })

    // Rapid synchronous double-tap on the same Log set button
    fireEvent.click(logButton)
    fireEvent.click(logButton)

    expect(await within(loggerOne).findByRole('status')).toHaveTextContent(
      'Logged Set #1',
    )

    const completedListOne = within(loggerOne).getByRole('list', {
      name: 'Completed sets for #1 Barbell Bench Press',
    })
    expect(within(completedListOne).getAllByRole('listitem')).toHaveLength(1)

    // Invalid 0 reps rejected with alert
    const repsInput = within(loggerOne).getByLabelText(
      'Actual reps (#1 Barbell Bench Press)',
    )
    await user.clear(repsInput)
    await user.type(repsInput, '0')
    await user.click(
      within(loggerOne).getByRole('button', {
        name: 'Log set for #1 Barbell Bench Press',
      }),
    )
    expect(await within(loggerOne).findByRole('alert')).toBeVisible()
    expect(within(completedListOne).getAllByRole('listitem')).toHaveLength(1)

    await expect(
      undoWorkoutSet('99999999-9999-4999-8999-999999999999', testDb),
    ).rejects.toThrow(RecordNotFoundError)
  })

  it('displays deterministic progression suggestions without auto-modifying load (T13)', async () => {
    const user = userEvent.setup()

    // Seed a more recent completed session where all 3 working sets met repMax (8) at 80 kg.
    const latestPrior = await startSession(
      routineId,
      { startedAt: '2026-10-25T08:00:00.000Z' },
      testDb,
    )
    const priorBench = latestPrior.exercises[0]!
    for (const [index, minute] of ['05', '10', '15'].entries()) {
      await appendSet(
        {
          sessionId: latestPrior.session.id,
          sessionExerciseId: priorBench.id,
          ordinal: index + 1,
          kind: 'working',
          externalLoadKg: 80,
          reps: 8,
          repsInReserve: 1,
          feedback: 'normal',
          completedAt: `2026-10-25T08:${minute}:00.000Z`,
        },
        testDb,
      )
    }
    await finishSession(
      latestPrior.session.id,
      { endedAt: '2026-10-25T08:40:00.000Z' },
      testDb,
    )

    render(
      <GymWorkspace
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T12:00:00.000Z')}
      />,
    )

    await user.click(
      await screen.findByRole('button', {
        name: 'Start Bench Double Specialization',
      }),
    )

    const loggerOne = await screen.findByRole('region', {
      name: 'Set logger for #1 Barbell Bench Press',
    })
    const loggerThree = screen.getByRole('region', {
      name: 'Set logger for #3 One-Arm Dumbbell Row',
    })

    const progressionOne = within(loggerOne).getByLabelText(
      'Progression suggestion for #1 Barbell Bench Press',
    )
    expect(progressionOne).toHaveTextContent('Eligible to increase load')
    expect(progressionOne).toHaveTextContent('All 3 sets met 8 reps at 80 kg')

    const loadInputOne = within(loggerOne).getByLabelText(
      'Load kg (#1 Barbell Bench Press)',
    )
    expect(loadInputOne).toHaveValue(80)

    const progressionThree = within(loggerThree).getByLabelText(
      'Progression suggestion for #3 One-Arm Dumbbell Row',
    )
    expect(progressionThree).toHaveTextContent('No suggestion')
    expect(progressionThree).toHaveTextContent(
      'no previous completed working sets recorded',
    )

    // Selecting discomfort feedback updates progression to Review exercise without modifying load.
    await user.selectOptions(
      within(loggerOne).getByLabelText('Feedback (#1 Barbell Bench Press)'),
      'discomfort',
    )
    expect(progressionOne).toHaveTextContent('Review exercise')
    expect(progressionOne).toHaveTextContent('Discomfort reported')
    expect(loadInputOne).toHaveValue(80)
  })
})
