import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  getExercises,
  listExerciseFilterMetadata,
  listMusclePreferences,
  MAX_EXERCISE_NOTE_LENGTH,
  type ResolvedExercise,
  upsertExerciseOverride,
} from '../../data/repositories/exercises'
import {
  EXERCISE_CATALOG,
  EXERCISE_FALLBACK_IMAGE_PATH,
  resolveExerciseImagePaths,
} from '../../data/seed'
import type { CatalogExercise, ID, MusclePreference } from '../../domain/models'
import {
  type EffectiveMusclePriority,
  formatRestrictionBadgeLabel,
} from '../../domain/restrictions'
import { MusclePriorityEditor, RestrictionEditor } from './RestrictionEditor'

const EQUIPMENT_ALL = '__ALL__'
const EQUIPMENT_BODYWEIGHT = '__BODYWEIGHT__'

export interface ExerciseLibraryProps {
  database?: PersonalTrackerDB
  catalog?: readonly CatalogExercise[]
  now?: () => Date
}

function formatEquipmentLabel(equipment: string | null): string {
  return equipment === null ? 'Bodyweight (none)' : equipment
}

export function ExerciseLibrary({
  database = db,
  catalog = EXERCISE_CATALOG,
  now = () => new Date(),
}: ExerciseLibraryProps) {
  const searchInputId = useId()
  const muscleSelectId = useId()
  const equipmentSelectId = useId()
  const priorityFilterSelectId = useId()
  const noteTextareaId = useId()

  const filterMetadata = useMemo(
    () => listExerciseFilterMetadata(catalog),
    [catalog],
  )
  const knownCatalogIds = useMemo(
    () => new Set(catalog.map((exercise) => exercise.id)),
    [catalog],
  )

  const [query, setQuery] = useState('')
  const [selectedMuscle, setSelectedMuscle] = useState('')
  const [selectedEquipment, setSelectedEquipment] = useState(EQUIPMENT_ALL)
  const [selectedMusclePriority, setSelectedMusclePriority] =
    useState<string>('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  const [exercises, setExercises] = useState<ResolvedExercise[]>([])
  const [musclePreferences, setMusclePreferences] = useState<
    MusclePreference[]
  >([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const [selectedExerciseId, setSelectedExerciseId] = useState<ID | null>(null)
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const equipmentFilterValue =
    selectedEquipment === EQUIPMENT_ALL
      ? undefined
      : selectedEquipment === EQUIPMENT_BODYWEIGHT
        ? null
        : selectedEquipment

  const reloadExercises = useCallback(async () => {
    try {
      const [result, prefs] = await Promise.all([
        getExercises(
          {
            catalog,
            query,
            primaryMuscle: selectedMuscle || undefined,
            equipment: equipmentFilterValue,
            favoritesOnly,
            musclePriority:
              (selectedMusclePriority as EffectiveMusclePriority) || undefined,
          },
          database,
        ),
        listMusclePreferences(database),
      ])
      setExercises(result)
      setMusclePreferences(prefs)
      setErrorMessage(null)
    } catch {
      setErrorMessage('Could not load exercises from local storage.')
    } finally {
      setIsLoading(false)
    }
  }, [
    catalog,
    database,
    equipmentFilterValue,
    favoritesOnly,
    query,
    selectedMuscle,
    selectedMusclePriority,
  ])

  useEffect(() => {
    let active = true
    void Promise.all([
      getExercises(
        {
          catalog,
          query,
          primaryMuscle: selectedMuscle || undefined,
          equipment: equipmentFilterValue,
          favoritesOnly,
          musclePriority:
            (selectedMusclePriority as EffectiveMusclePriority) || undefined,
        },
        database,
      ),
      listMusclePreferences(database),
    ])
      .then(([result, prefs]) => {
        if (!active) return
        setExercises(result)
        setMusclePreferences(prefs)
        setErrorMessage(null)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setErrorMessage('Could not load exercises from local storage.')
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [
    catalog,
    database,
    equipmentFilterValue,
    favoritesOnly,
    query,
    selectedMuscle,
    selectedMusclePriority,
  ])

  const selectedExercise = useMemo(
    () =>
      selectedExerciseId
        ? (exercises.find((item) => item.id === selectedExerciseId) ?? null)
        : null,
    [exercises, selectedExerciseId],
  )

  const hasActiveFilters =
    query.trim().length > 0 ||
    selectedMuscle !== '' ||
    selectedEquipment !== EQUIPMENT_ALL ||
    selectedMusclePriority !== '' ||
    favoritesOnly

  const handleResetFilters = () => {
    setQuery('')
    setSelectedMuscle('')
    setSelectedEquipment(EQUIPMENT_ALL)
    setSelectedMusclePriority('')
    setFavoritesOnly(false)
    setStatusMessage(null)
  }

  const handleSelectExercise = (exercise: ResolvedExercise) => {
    setStatusMessage(null)
    if (selectedExerciseId === exercise.id) {
      setSelectedExerciseId(null)
      return
    }
    setSelectedExerciseId(exercise.id)
    setActiveImageIndex(0)
    setImageLoadFailed(false)
    setNoteDraft(exercise.userNotes ?? '')
  }

  const handleToggleFavorite = async (exercise: ResolvedExercise) => {
    setIsSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const nextFavorite = !exercise.favorite
      await upsertExerciseOverride(
        {
          exerciseId: exercise.id,
          favorite: nextFavorite,
          updatedAt: now().toISOString(),
        },
        { knownCatalogIds, database },
      )
      await reloadExercises()
      setStatusMessage(
        nextFavorite
          ? `Added ${exercise.displayName} to favorites.`
          : `Removed ${exercise.displayName} from favorites.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not update favorite status.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveNote = async () => {
    if (!selectedExercise) return
    setIsSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await upsertExerciseOverride(
        {
          exerciseId: selectedExercise.id,
          userNotes: noteDraft,
          updatedAt: now().toISOString(),
        },
        { knownCatalogIds, database },
      )
      await reloadExercises()
      setStatusMessage(`Saved note for ${selectedExercise.displayName}.`)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not save exercise note.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const resolvedImages = selectedExercise
    ? resolveExerciseImagePaths(selectedExercise)
    : [EXERCISE_FALLBACK_IMAGE_PATH]
  const safeImageIndex =
    activeImageIndex < resolvedImages.length ? activeImageIndex : 0
  const displayedImageSrc = imageLoadFailed
    ? EXERCISE_FALLBACK_IMAGE_PATH
    : (resolvedImages[safeImageIndex] ?? EXERCISE_FALLBACK_IMAGE_PATH)

  return (
    <section
      aria-label="Exercise library"
      className="mt-6 space-y-6 border-t border-[var(--line)] pt-6"
    >
      <div
        role="search"
        aria-label="Filter exercises"
        className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor={searchInputId}
              className="block text-sm font-medium"
            >
              Search exercises by name
            </label>
            <input
              id={searchInputId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. Bench press, squat, pullup"
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor={muscleSelectId}
              className="block text-sm font-medium"
            >
              Primary muscle
            </label>
            <select
              id={muscleSelectId}
              value={selectedMuscle}
              onChange={(event) => setSelectedMuscle(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">All primary muscles</option>
              {filterMetadata.primaryMuscles.map((muscle) => (
                <option key={muscle} value={muscle}>
                  {muscle}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={equipmentSelectId}
              className="block text-sm font-medium"
            >
              Equipment
            </label>
            <select
              id={equipmentSelectId}
              value={selectedEquipment}
              onChange={(event) => setSelectedEquipment(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value={EQUIPMENT_ALL}>All equipment</option>
              {filterMetadata.hasBodyweight && (
                <option value={EQUIPMENT_BODYWEIGHT}>Bodyweight (none)</option>
              )}
              {filterMetadata.equipmentOptions.map((equipment) => (
                <option key={equipment} value={equipment}>
                  {equipment}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={priorityFilterSelectId}
              className="block text-sm font-medium"
            >
              Muscle priority filter
            </label>
            <select
              id={priorityFilterSelectId}
              value={selectedMusclePriority}
              onChange={(event) =>
                setSelectedMusclePriority(event.target.value)
              }
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">All muscle priorities</option>
              <option value="priority">Priority focus</option>
              <option value="normal">Normal</option>
              <option value="deprioritized">Deprioritized</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((prev) => !prev)}
              className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold ${
                favoritesOnly
                  ? 'border-[var(--accent)] bg-[var(--selected)] text-[var(--accent)]'
                  : 'border-[var(--line)]'
              }`}
            >
              Favorites only
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium"
              >
                Reset filters
              </button>
            )}
          </div>

          <p aria-live="polite" className="text-sm text-muted">
            {isLoading
              ? 'Loading exercises…'
              : `Showing ${exercises.length} of ${catalog.length} exercises`}
          </p>
        </div>
      </div>

      {statusMessage && (
        <p
          role="status"
          className="rounded-lg border border-[var(--accent)] bg-[var(--selected)] p-3 text-sm"
        >
          {statusMessage}
        </p>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm"
        >
          <p className="font-medium">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void reloadExercises()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {selectedExercise && (
        <section
          aria-label={`${selectedExercise.displayName} details`}
          className="space-y-4 rounded-lg border border-[var(--accent)] bg-[var(--raised)] p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                {selectedExercise.displayName}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Primary: {selectedExercise.primaryMuscles.join(', ')} ·
                Equipment: {formatEquipmentLabel(selectedExercise.equipment)} ·
                Category: {selectedExercise.category}
              </p>
              <p className="mt-1 text-sm text-muted">
                Secondary muscles:{' '}
                {selectedExercise.secondaryMuscles.length > 0
                  ? selectedExercise.secondaryMuscles.join(', ')
                  : 'None'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isSaving}
                aria-pressed={selectedExercise.favorite}
                onClick={() => void handleToggleFavorite(selectedExercise)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold"
              >
                {selectedExercise.favorite
                  ? 'Favorited ★'
                  : 'Add to favorites ☆'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedExerciseId(null)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium"
              >
                Close details
              </button>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Position demonstration</h3>
              {resolvedImages.length > 1 && (
                <div
                  role="group"
                  aria-label="Position image toggle"
                  className="flex flex-wrap gap-2"
                >
                  <button
                    type="button"
                    aria-pressed={safeImageIndex === 0}
                    onClick={() => {
                      setActiveImageIndex(0)
                      setImageLoadFailed(false)
                    }}
                    className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      safeImageIndex === 0
                        ? 'border-[var(--accent)] bg-[var(--selected)] text-[var(--accent)]'
                        : 'border-[var(--line)]'
                    }`}
                  >
                    Start position (1/{resolvedImages.length})
                  </button>
                  <button
                    type="button"
                    aria-pressed={safeImageIndex === 1}
                    onClick={() => {
                      setActiveImageIndex(1)
                      setImageLoadFailed(false)
                    }}
                    className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      safeImageIndex === 1
                        ? 'border-[var(--accent)] bg-[var(--selected)] text-[var(--accent)]'
                        : 'border-[var(--line)]'
                    }`}
                  >
                    End position (2/{resolvedImages.length})
                  </button>
                </div>
              )}
            </div>

            <img
              src={displayedImageSrc}
              alt={`${selectedExercise.displayName} ${safeImageIndex === 0 ? 'start' : 'end'} position illustration`}
              onError={() => setImageLoadFailed(true)}
              className="max-h-56 w-auto rounded-lg border border-[var(--line)]"
            />
            {(selectedExercise.imagePaths.length === 0 || imageLoadFailed) && (
              <p className="text-xs text-muted">
                Showing local fallback illustration. Follow the step-by-step
                instructions below.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold">Instructions</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {selectedExercise.instructions.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="space-y-2 border-t border-[var(--line)] pt-4">
            <label
              htmlFor={noteTextareaId}
              className="block text-sm font-semibold"
            >
              Personal notes for {selectedExercise.displayName}
            </label>
            <textarea
              id={noteTextareaId}
              rows={3}
              maxLength={MAX_EXERCISE_NOTE_LENGTH}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Add your own setup cues, seat settings, or grip notes…"
              className="block w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted">
                {noteDraft.length} / {MAX_EXERCISE_NOTE_LENGTH} characters
              </span>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSaveNote()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
              >
                Save note
              </button>
            </div>
          </div>

          <RestrictionEditor
            key={selectedExercise.id}
            exerciseId={selectedExercise.id}
            exerciseName={selectedExercise.displayName}
            restriction={selectedExercise.restriction}
            knownCatalogIds={knownCatalogIds}
            database={database}
            now={now}
            onSaved={() => reloadExercises()}
          />
        </section>
      )}

      {!isLoading && exercises.length === 0 && (
        <div
          role="region"
          aria-label="Empty exercise results"
          className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-6 text-center"
        >
          <h2 className="text-lg font-semibold">
            No exercises match your current search or filters.
          </h2>
          <p className="mt-2 text-sm text-muted">
            {favoritesOnly
              ? 'You have no matching favorite exercises yet. Try clearing the Favorites filter or search query.'
              : 'Try broadening your search term or selecting a different muscle group or equipment filter.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)]"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {exercises.length > 0 && (
        <ul aria-label="Exercises list" className="space-y-3">
          {exercises.map((exercise) => {
            const isSelected = selectedExerciseId === exercise.id
            return (
              <li
                key={exercise.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">
                      {exercise.displayName}
                    </h2>
                    {exercise.restriction && (
                      <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs font-medium">
                        {formatRestrictionBadgeLabel(exercise.restriction)}
                      </span>
                    )}
                    {exercise.userNotes && exercise.userNotes.trim() !== '' && (
                      <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-muted">
                        Note saved
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {exercise.primaryMuscles.join(', ')} ·{' '}
                    {formatEquipmentLabel(exercise.equipment)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    aria-pressed={exercise.favorite}
                    aria-label={
                      exercise.favorite
                        ? `Remove ${exercise.displayName} from favorites`
                        : `Favorite ${exercise.displayName}`
                    }
                    onClick={() => void handleToggleFavorite(exercise)}
                    className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold ${
                      exercise.favorite
                        ? 'border-[var(--accent)] bg-[var(--selected)] text-[var(--accent)]'
                        : 'border-[var(--line)]'
                    }`}
                  >
                    {exercise.favorite ? '★ Favorite' : '☆ Favorite'}
                  </button>
                  <button
                    type="button"
                    aria-expanded={isSelected}
                    aria-label={
                      isSelected
                        ? `Hide details for ${exercise.displayName}`
                        : `View details for ${exercise.displayName}`
                    }
                    onClick={() => handleSelectExercise(exercise)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium"
                  >
                    {isSelected ? 'Hide details' : 'View details'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <MusclePriorityEditor
        muscleGroups={filterMetadata.primaryMuscles}
        preferences={musclePreferences}
        database={database}
        now={now}
        onSaved={() => reloadExercises()}
      />
    </section>
  )
}
