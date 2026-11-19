import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  appendSet,
  ExcludedExerciseError,
  finishSession,
  getSessionSnapshot,
  MAX_RESTRICTION_NOTE_LENGTH,
  saveExerciseRestriction,
  saveRoutine,
  startSession,
} from '../../data/repositories'
import type { CatalogExercise } from '../../domain/models'
import { RoutineEditor } from '../routines/RoutineEditor'
import { ExerciseLibrary } from './ExerciseLibrary'

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
    id: 'fedb:Dips_-_Chest_Version',
    sourceId: 'Dips_-_Chest_Version',
    name: 'Dips - Chest Version',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: 'other',
    instructions: ['Lower body.', 'Press up.'],
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

describe('User restrictions and muscle priorities (T09)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`restrictions-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('never labels unreviewed exercises as safe, saves explicit restriction status + note, and filters by muscle priority', async () => {
    const user = userEvent.setup()
    render(<ExerciseLibrary database={testDb} catalog={testCatalog} />)
    await screen.findByText('Showing 3 of 3 exercises')

    await user.click(
      screen.getByRole('button', {
        name: 'View details for Barbell Bench Press',
      }),
    )

    const restrictionRegion = await screen.findByRole('region', {
      name: 'Personal restriction for Barbell Bench Press',
    })
    expect(
      within(restrictionRegion).getByText(
        'Current: Unreviewed (status not set)',
      ),
    ).toBeVisible()
    expect(
      within(restrictionRegion).getByText(
        /Unreviewed status does not imply medical approval or injury safety/i,
      ),
    ).toBeVisible()

    // Set Barbell Bench Press to Caution with user note
    await user.selectOptions(
      within(restrictionRegion).getByLabelText(
        'Restriction status for Barbell Bench Press',
      ),
      'caution',
    )
    await user.type(
      within(restrictionRegion).getByLabelText(
        'Restriction note for Barbell Bench Press (user-entered)',
      ),
      'Keep elbows tucked 45 degrees',
    )
    await user.click(
      within(restrictionRegion).getByRole('button', {
        name: 'Save restriction',
      }),
    )
    expect(
      await within(restrictionRegion).findByRole('status'),
    ).toHaveTextContent('Saved restriction for Barbell Bench Press: Caution.')

    // Set muscle priority for chest -> priority
    const priorityRegion = screen.getByRole('region', {
      name: 'Muscle priority preferences',
    })
    await user.selectOptions(
      within(priorityRegion).getByLabelText('Muscle group'),
      'chest',
    )
    await user.selectOptions(
      within(priorityRegion).getByLabelText('Priority level'),
      'priority',
    )
    await user.click(
      within(priorityRegion).getByRole('button', {
        name: 'Save muscle priority',
      }),
    )

    // Filter library by Priority focus
    await user.selectOptions(
      screen.getByLabelText('Muscle priority filter'),
      'priority',
    )
    expect(await screen.findByText('Showing 2 of 3 exercises')).toBeVisible()

    // Repository note-length cap check
    await expect(
      saveExerciseRestriction(
        {
          exerciseId: 'fedb:Barbell_Bench_Press',
          status: 'caution',
          note: 'x'.repeat(MAX_RESTRICTION_NOTE_LENGTH + 1),
          updatedAt: '2026-10-27T10:00:00.000Z',
        },
        testDb,
      ),
    ).rejects.toThrow(RangeError)
  })

  it('hides excluded exercises from routine picker, flags excluded routine items, blocks workout start until replaced, and preserves historical logs', async () => {
    const user = userEvent.setup()

    // 1. Create a routine containing Bench Press and Dips, and complete a historical session with sets.
    await saveRoutine(
      {
        id: routineId,
        name: 'Chest Day',
        items: [
          {
            id: itemOneId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 3,
            repMin: 8,
            repMax: 10,
            restSeconds: 120,
          },
          {
            id: itemTwoId,
            exerciseId: 'fedb:Dips_-_Chest_Version',
            order: 1,
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

    const historicSession = await startSession(
      routineId,
      { startedAt: '2026-10-21T08:00:00.000Z' },
      testDb,
    )
    await appendSet(
      {
        sessionId: historicSession.session.id,
        sessionExerciseId: historicSession.exercises[1]!.id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: null,
        reps: 10,
        completedAt: '2026-10-21T08:10:00.000Z',
      },
      testDb,
    )
    await finishSession(
      historicSession.session.id,
      { endedAt: '2026-10-21T08:30:00.000Z' },
      testDb,
    )

    // 2. Mark Bench Press as Caution (with note) and Dips as Excluded.
    await saveExerciseRestriction(
      {
        exerciseId: 'fedb:Barbell_Bench_Press',
        status: 'caution',
        note: 'Pause briefly on chest',
        updatedAt: '2026-10-27T09:00:00.000Z',
      },
      testDb,
    )
    await saveExerciseRestriction(
      {
        exerciseId: 'fedb:Dips_-_Chest_Version',
        status: 'excluded',
        note: 'Shoulder extension excluded',
        updatedAt: '2026-10-27T09:00:00.000Z',
      },
      testDb,
    )

    // 3. Verify historical session and set logs are completely preserved.
    const historicSnapshot = await getSessionSnapshot(
      historicSession.session.id,
      testDb,
    )
    expect(historicSnapshot?.exercises).toHaveLength(2)
    expect(historicSnapshot?.setLogs).toHaveLength(1)

    // 4. Verify database transaction blocks starting a new workout containing the excluded exercise.
    await expect(
      startSession(
        routineId,
        { startedAt: '2026-10-27T10:00:00.000Z' },
        testDb,
      ),
    ).rejects.toThrow(ExcludedExerciseError)

    // 5. Render RoutineEditor: picker hides Dips, saved routine flags Dips as Excluded and shows Bench Press caution note.
    render(<RoutineEditor database={testDb} catalog={testCatalog} />)

    const excludedAlert = await screen.findByRole('alert', {
      name: 'Excluded exercise warning for Chest Day',
    })
    expect(excludedAlert).toHaveTextContent(
      /Routine blocked from starting: contains excluded exercise\(s\): Dips - Chest Version/i,
    )
    expect(
      screen.getByText(/\[Caution: Pause briefly on chest\]/i),
    ).toBeVisible()

    // Picker options must not include the excluded Dips exercise
    const pickerSelect = screen.getByLabelText('Exercise to add')
    const optionValues = Array.from(
      pickerSelect.querySelectorAll('option'),
    ).map((opt) => opt.getAttribute('value'))
    expect(optionValues).not.toContain('fedb:Dips_-_Chest_Version')
    expect(optionValues).toContain('fedb:Barbell_Bench_Press')
    expect(optionValues).toContain('fedb:One-Arm_Dumbbell_Row')

    // Edit Chest Day and replace the excluded Dips item with One-Arm Dumbbell Row
    await user.click(screen.getByRole('button', { name: 'Edit Chest Day' }))
    await user.selectOptions(pickerSelect, 'fedb:One-Arm_Dumbbell_Row')
    await user.click(
      screen.getByRole('button', {
        name: 'Replace #2 Dips - Chest Version with selected exercise',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Save routine changes' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Updated routine "Chest Day".',
    )

    expect(
      screen.queryByRole('alert', {
        name: 'Excluded exercise warning for Chest Day',
      }),
    ).not.toBeInTheDocument()

    // Now starting a new workout from Chest Day succeeds!
    const newSession = await startSession(
      routineId,
      { startedAt: '2026-10-27T10:05:00.000Z' },
      testDb,
    )
    expect(newSession.exercises.map((ex) => ex.exerciseId)).toEqual([
      'fedb:Barbell_Bench_Press',
      'fedb:One-Arm_Dumbbell_Row',
    ])
  })
})
