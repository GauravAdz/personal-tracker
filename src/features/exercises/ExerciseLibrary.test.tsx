import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  MAX_EXERCISE_NOTE_LENGTH,
  ParentReferenceError,
  upsertExerciseOverride,
} from '../../data/repositories'
import { EXERCISE_FALLBACK_IMAGE_PATH } from '../../data/seed'
import type { CatalogExercise } from '../../domain/models'
import { ExerciseLibrary } from './ExerciseLibrary'

const testCatalog: readonly CatalogExercise[] = [
  {
    id: 'fedb:Barbell_Bench_Press',
    sourceId: 'Barbell_Bench_Press',
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: 'barbell',
    instructions: [
      'Lie flat on the bench.',
      'Lower the bar to mid-chest.',
      'Press back to lockout.',
    ],
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
    instructions: ['Support knee on bench.', 'Row dumbbell to hip.'],
    category: 'strength',
    imagePaths: ['exercises/back/0.svg', 'exercises/back/1.svg'],
  },
  {
    id: 'fedb:Pullups',
    sourceId: 'Pullups',
    name: 'Pullups',
    primaryMuscles: ['lats'],
    secondaryMuscles: ['biceps'],
    equipment: null,
    instructions: ['Hang from bar.', 'Pull chin over bar.'],
    category: 'strength',
    imagePaths: [],
  },
]

describe('ExerciseLibrary (T07)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`exercise-library-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('filters by case-insensitive name, primary muscle, and bodyweight/equipment with empty-state reset', async () => {
    const user = userEvent.setup()
    render(<ExerciseLibrary database={testDb} catalog={testCatalog} />)

    expect(await screen.findByText('Showing 3 of 3 exercises')).toBeVisible()

    const searchInput = screen.getByLabelText('Search exercises by name')
    await user.type(searchInput, 'bench')
    expect(await screen.findByText('Showing 1 of 3 exercises')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Barbell Bench Press' }),
    ).toBeVisible()

    await user.clear(searchInput)
    expect(await screen.findByText('Showing 3 of 3 exercises')).toBeVisible()

    // Filter by primary muscle
    await user.selectOptions(
      screen.getByLabelText('Primary muscle'),
      'middle back',
    )
    expect(await screen.findByText('Showing 1 of 3 exercises')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'One-Arm Dumbbell Row' }),
    ).toBeVisible()

    // Combine with incompatible equipment to trigger empty state
    await user.selectOptions(
      screen.getByLabelText('Equipment'),
      '__BODYWEIGHT__',
    )
    expect(
      await screen.findByRole('heading', {
        name: 'No exercises match your current search or filters.',
      }),
    ).toBeVisible()

    // Reset filters from empty state
    const emptyRegion = screen.getByRole('region', {
      name: 'Empty exercise results',
    })
    await user.click(
      within(emptyRegion).getByRole('button', { name: 'Reset filters' }),
    )
    expect(await screen.findByText('Showing 3 of 3 exercises')).toBeVisible()

    // Filter Bodyweight (none) alone
    await user.selectOptions(
      screen.getByLabelText('Equipment'),
      '__BODYWEIGHT__',
    )
    expect(await screen.findByText('Showing 1 of 3 exercises')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Pullups' })).toBeVisible()
  })

  it('displays exercise details, toggles start/end position images, and falls back to placeholder when needed', async () => {
    const user = userEvent.setup()
    render(<ExerciseLibrary database={testDb} catalog={testCatalog} />)
    await screen.findByText('Showing 3 of 3 exercises')

    await user.click(
      screen.getByRole('button', {
        name: 'View details for Barbell Bench Press',
      }),
    )

    const details = await screen.findByRole('region', {
      name: 'Barbell Bench Press details',
    })
    expect(details).toBeVisible()
    expect(
      within(details).getByText(/Lower the bar to mid-chest\./),
    ).toBeVisible()

    const startBtn = within(details).getByRole('button', {
      name: 'Start position (1/2)',
    })
    const endBtn = within(details).getByRole('button', {
      name: 'End position (2/2)',
    })
    const img = within(details).getByRole('img', {
      name: /Barbell Bench Press start position illustration/i,
    })

    expect(startBtn).toHaveAttribute('aria-pressed', 'true')
    expect(endBtn).toHaveAttribute('aria-pressed', 'false')
    expect(img).toHaveAttribute('src', 'exercises/chest/0.svg')

    await user.click(endBtn)
    expect(endBtn).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(details).getByRole('img', {
        name: /Barbell Bench Press end position illustration/i,
      }),
    ).toHaveAttribute('src', 'exercises/chest/1.svg')

    // Simulate image load error -> falls back to placeholder.svg
    fireEvent.error(
      within(details).getByRole('img', {
        name: /Barbell Bench Press end position illustration/i,
      }),
    )
    expect(
      within(details).getByRole('img', {
        name: /Barbell Bench Press end position illustration/i,
      }),
    ).toHaveAttribute('src', EXERCISE_FALLBACK_IMAGE_PATH)

    // Switch to text-only exercise (Pullups, imagePaths: [])
    await user.click(
      screen.getByRole('button', { name: 'View details for Pullups' }),
    )
    const pullupDetails = await screen.findByRole('region', {
      name: 'Pullups details',
    })
    expect(
      within(pullupDetails).getByRole('img', {
        name: /Pullups start position illustration/i,
      }),
    ).toHaveAttribute('src', EXERCISE_FALLBACK_IMAGE_PATH)
    expect(
      within(pullupDetails).getByText(/Showing local fallback illustration/i),
    ).toBeVisible()
  })

  it('persists favorites and user notes via ExerciseOverride across reload and enforces note bounds', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <ExerciseLibrary
        database={testDb}
        catalog={testCatalog}
        now={() => new Date('2026-10-27T12:00:00.000Z')}
      />,
    )
    await screen.findByText('Showing 3 of 3 exercises')

    // Favorite Barbell Bench Press and add a personal note
    await user.click(
      screen.getByRole('button', { name: 'Favorite Barbell Bench Press' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added Barbell Bench Press to favorites.',
    )

    await user.click(
      screen.getByRole('button', {
        name: 'View details for Barbell Bench Press',
      }),
    )
    const noteField = screen.getByLabelText(
      'Personal notes for Barbell Bench Press',
    )
    await user.type(noteField, 'Index finger on knurl ring; pause 1s.')
    await user.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved note for Barbell Bench Press.',
    )
    expect(screen.getByText('Note saved')).toBeVisible()

    // Simulate reload by unmounting and mounting a fresh component connected to the same IndexedDB
    unmount()
    render(<ExerciseLibrary database={testDb} catalog={testCatalog} />)
    await screen.findByText('Showing 3 of 3 exercises')

    await user.click(screen.getByRole('button', { name: 'Favorites only' }))
    expect(await screen.findByText('Showing 1 of 3 exercises')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Barbell Bench Press' }),
    ).toBeVisible()
    expect(screen.getByText('Note saved')).toBeVisible()

    await user.click(
      screen.getByRole('button', {
        name: 'View details for Barbell Bench Press',
      }),
    )
    expect(
      screen.getByLabelText('Personal notes for Barbell Bench Press'),
    ).toHaveValue('Index finger on knurl ring; pause 1s.')

    // Verify repository failure paths for note length cap and unknown exerciseId
    await expect(
      upsertExerciseOverride(
        {
          exerciseId: 'fedb:Barbell_Bench_Press',
          userNotes: 'x'.repeat(MAX_EXERCISE_NOTE_LENGTH + 1),
        },
        testDb,
      ),
    ).rejects.toThrow(RangeError)

    await expect(
      upsertExerciseOverride(
        {
          exerciseId: 'fedb:Missing_Exercise',
          favorite: true,
        },
        {
          knownCatalogIds: new Set(testCatalog.map((item) => item.id)),
          database: testDb,
        },
      ),
    ).rejects.toThrow(ParentReferenceError)
  })
})
