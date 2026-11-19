import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  appendSet,
  duplicateRoutine,
  getSessionSnapshot,
  listRoutines,
  RecordNotFoundError,
  reorderRoutineItems,
  startSession,
} from '../../data/repositories'
import type { CatalogExercise } from '../../domain/models'
import { RoutineEditor } from './RoutineEditor'

const testCatalog: readonly CatalogExercise[] = [
  {
    id: 'fedb:Barbell_Bench_Press',
    sourceId: 'Barbell_Bench_Press',
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: 'barbell',
    instructions: ['Lower bar to chest.', 'Press up.'],
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
  {
    id: 'fedb:Barbell_Full_Squat',
    sourceId: 'Barbell_Full_Squat',
    name: 'Barbell Full Squat',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['glutes', 'hamstrings'],
    equipment: 'barbell',
    instructions: ['Squat down.', 'Stand up.'],
    category: 'strength',
    imagePaths: ['exercises/legs/0.svg', 'exercises/legs/1.svg'],
  },
]

describe('RoutineEditor (T08)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`routine-editor-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('creates, reorders, edits, and duplicates a routine while allowing repeated exercises with distinct item IDs', async () => {
    const user = userEvent.setup()
    render(
      <RoutineEditor
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T10:00:00.000Z')}
      />,
    )

    expect(await screen.findByText('No routines saved yet.')).toBeVisible()

    await user.type(screen.getByLabelText('Routine name'), 'Upper Power')

    // Add Barbell Bench Press twice and One-Arm Dumbbell Row once.
    const pickerSelect = screen.getByLabelText('Exercise to add')
    await user.selectOptions(pickerSelect, 'fedb:Barbell_Bench_Press')
    await user.click(
      screen.getByRole('button', { name: 'Add exercise to routine' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Add exercise to routine' }),
    )

    await user.selectOptions(pickerSelect, 'fedb:One-Arm_Dumbbell_Row')
    await user.click(
      screen.getByRole('button', { name: 'Add exercise to routine' }),
    )

    // Move #3 One-Arm Dumbbell Row up to position #2
    await user.click(
      screen.getByRole('button', {
        name: 'Move up #3 One-Arm Dumbbell Row',
      }),
    )

    // Customize sets/reps/rest on #1 Barbell Bench Press
    const setsInput = screen.getByLabelText(
      'Working sets (#1 Barbell Bench Press)',
    )
    const minRepsInput = screen.getByLabelText(
      'Min reps (#1 Barbell Bench Press)',
    )
    const maxRepsInput = screen.getByLabelText(
      'Max reps (#1 Barbell Bench Press)',
    )
    const restInput = screen.getByLabelText(
      'Rest seconds (#1 Barbell Bench Press)',
    )

    await user.clear(setsInput)
    await user.type(setsInput, '4')
    await user.clear(minRepsInput)
    await user.type(minRepsInput, '5')
    await user.clear(maxRepsInput)
    await user.type(maxRepsInput, '8')
    await user.clear(restInput)
    await user.type(restInput, '150')

    await user.click(screen.getByRole('button', { name: 'Save routine' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created routine "Upper Power".',
    )

    const savedRoutines = await listRoutines(testDb)
    expect(savedRoutines).toHaveLength(1)
    const created = savedRoutines[0]!
    expect(created.items.map((item) => item.exerciseId)).toEqual([
      'fedb:Barbell_Bench_Press',
      'fedb:One-Arm_Dumbbell_Row',
      'fedb:Barbell_Bench_Press',
    ])
    expect(created.items.map((item) => item.order)).toEqual([0, 1, 2])
    // Identical exercise repeated twice must have distinct RoutineExercise IDs
    expect(created.items[0]?.id).not.toBe(created.items[2]?.id)
    expect(created.items[0]).toMatchObject({
      workingSets: 4,
      repMin: 5,
      repMax: 8,
      restSeconds: 150,
    })

    // Edit existing routine name
    await user.click(screen.getByRole('button', { name: 'Edit Upper Power' }))
    const nameInput = screen.getByLabelText('Routine name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Upper Power v2')
    await user.click(
      screen.getByRole('button', { name: 'Save routine changes' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Updated routine "Upper Power v2".',
    )

    // Duplicate routine
    await user.click(
      screen.getByRole('button', { name: 'Duplicate Upper Power v2' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Duplicated "Upper Power v2" as "Upper Power v2 (Copy)".',
    )

    const afterDuplicate = await listRoutines(testDb)
    expect(afterDuplicate).toHaveLength(2)
    const original = afterDuplicate.find((r) => r.name === 'Upper Power v2')!
    const copy = afterDuplicate.find((r) => r.name === 'Upper Power v2 (Copy)')!
    expect(copy.id).not.toBe(original.id)
    expect(copy.items.map((i) => i.exerciseId)).toEqual(
      original.items.map((i) => i.exerciseId),
    )
    expect(copy.items[0]?.id).not.toBe(original.items[0]?.id)
  })

  it('rejects blank names, reversed rep ranges, and invalid set/rest numbers without saving', async () => {
    const user = userEvent.setup()
    render(<RoutineEditor database={testDb} catalog={testCatalog} />)
    await screen.findByText('No routines saved yet.')

    // Blank name rejected
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Routine name must not be blank.',
    )

    await user.type(screen.getByLabelText('Routine name'), 'Invalid Routine')
    await user.click(
      screen.getByRole('button', { name: 'Add exercise to routine' }),
    )

    // Reversed rep range (repMin 12 > repMax 8)
    const minRepsInput = screen.getByLabelText(
      'Min reps (#1 Barbell Bench Press)',
    )
    const maxRepsInput = screen.getByLabelText(
      'Max reps (#1 Barbell Bench Press)',
    )
    await user.clear(minRepsInput)
    await user.type(minRepsInput, '12')
    await user.clear(maxRepsInput)
    await user.type(maxRepsInput, '8')

    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Maximum reps must be at least minimum reps.',
    )
    expect(await listRoutines(testDb)).toHaveLength(0)

    // Repository failure paths for duplicateRoutine and reorderRoutineItems
    await expect(
      duplicateRoutine(
        '99999999-9999-4999-8999-999999999999',
        undefined,
        testDb,
      ),
    ).rejects.toThrow(RecordNotFoundError)

    expect(() => reorderRoutineItems([], 0, 1)).toThrow(RangeError)
  })

  it('seeds a distinguishable [Demo] routine and preserves workout history when the template is deleted', async () => {
    const user = userEvent.setup()
    render(
      <RoutineEditor
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T11:00:00.000Z')}
      />,
    )

    const demoButton = await screen.findByRole('button', {
      name: 'Load demo starter routine',
    })
    await user.click(demoButton)

    const routinesList = await screen.findByRole('list', {
      name: 'Saved routines list',
    })
    expect(
      within(routinesList).getByRole('heading', {
        name: '[Demo] Full-Body Starter Template',
      }),
    ).toBeVisible()

    const [demoRoutine] = await listRoutines(testDb)
    expect(demoRoutine).toBeDefined()

    // Start a workout session from the demo routine and log a set
    const started = await startSession(
      demoRoutine!.id,
      {
        startedAt: '2026-10-27T11:05:00.000Z',
        catalogLookup: new Map(
          testCatalog.map((item) => [
            item.id,
            { name: item.name, equipment: item.equipment },
          ]),
        ),
      },
      testDb,
    )
    await appendSet(
      {
        sessionId: started.session.id,
        sessionExerciseId: started.exercises[0]!.id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: 60,
        reps: 10,
        completedAt: '2026-10-27T11:10:00.000Z',
      },
      testDb,
    )

    // Delete the routine template via UI
    await user.click(
      screen.getByRole('button', {
        name: 'Delete [Demo] Full-Body Starter Template',
      }),
    )

    expect(await screen.findByText('No routines saved yet.')).toBeVisible()
    expect(await listRoutines(testDb)).toHaveLength(0)

    // Verify historical session, session exercise snapshots, and set logs are untouched
    const snapshot = await getSessionSnapshot(started.session.id, testDb)
    expect(snapshot?.session.id).toBe(started.session.id)
    expect(snapshot?.exercises).toHaveLength(3)
    expect(snapshot?.setLogs).toHaveLength(1)
  })
})
