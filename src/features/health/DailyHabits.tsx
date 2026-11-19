import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  archiveHabitDefinition,
  deleteHabitLog,
  listHabitDefinitions,
  listHabitLogsForDay,
  MAX_HABIT_NAME_LENGTH,
  MAX_HABIT_QUANTITY_LABEL_LENGTH,
  MAX_HABIT_SLOT_LABEL_LENGTH,
  saveHabitDefinition,
  upsertHabitLog,
} from '../../data/repositories'
import {
  habitDefinitionSchema,
  habitLogInputSchema,
} from '../../data/validation'
import { createId } from '../../domain/id'
import type {
  HabitDefinition,
  HabitLog,
  IANATimeZone,
  ID,
  LocalDate,
} from '../../domain/models'
import {
  getDefaultTimeZone,
  getLocalDate,
  isLocalDate,
  shiftLocalDate,
  toUTCISOString,
} from '../../domain/time'

export interface DailyHabitsProps {
  database?: PersonalTrackerDB
  now?: () => Date
  timeZone?: IANATimeZone
}

interface SlotDraft {
  id: ID
  label: string
  localTime: string
}

function makeDefaultSlotDrafts(): SlotDraft[] {
  return [
    { id: createId(), label: 'AM', localTime: '08:00' },
    { id: createId(), label: 'PM', localTime: '20:00' },
  ]
}

function parseOptionalQuantity(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

function formatEventTime(occurredAt: string, timeZone: IANATimeZone): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(occurredAt))
    return `${formatted} (${timeZone})`
  } catch {
    return occurredAt
  }
}

export function DailyHabits({
  database = db,
  now = () => new Date(),
  timeZone,
}: DailyHabitsProps) {
  const dateInputId = useId()
  const habitNameInputId = useId()
  const quantityLabelInputId = useId()

  const activeTimeZone = useMemo(
    () => timeZone ?? getDefaultTimeZone(),
    [timeZone],
  )

  const computeToday = useCallback(
    () => getLocalDate(toUTCISOString(now()), activeTimeZone),
    [activeTimeZone, now],
  )

  const [todayLocalDate, setTodayLocalDate] = useState<LocalDate>(() =>
    computeToday(),
  )
  const [selectedDate, setSelectedDate] = useState<LocalDate>(() =>
    computeToday(),
  )
  const lastTodayRef = useRef<LocalDate>(todayLocalDate)

  const [habits, setHabits] = useState<HabitDefinition[]>([])
  const [dayLogs, setDayLogs] = useState<HabitLog[]>([])
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>(
    {},
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingHabitId, setEditingHabitId] = useState<ID | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [quantityLabelDraft, setQuantityLabelDraft] = useState('')
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>(() =>
    makeDefaultSlotDrafts(),
  )

  const [showArchived, setShowArchived] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const reloadData = useCallback(
    async (targetDate: LocalDate) => {
      try {
        const [loadedHabits, loadedLogs] = await Promise.all([
          listHabitDefinitions({ includeArchived: true }, database),
          listHabitLogsForDay(targetDate, database),
        ])
        setHabits(loadedHabits)
        setDayLogs(loadedLogs)
        setErrorMessage(null)
      } catch {
        setErrorMessage('Could not load daily habits for this calendar day.')
      } finally {
        setIsLoading(false)
      }
    },
    [database],
  )

  useEffect(() => {
    let active = true
    void Promise.all([
      listHabitDefinitions({ includeArchived: true }, database),
      listHabitLogsForDay(selectedDate, database),
    ])
      .then(([loadedHabits, loadedLogs]) => {
        if (!active) return
        setHabits(loadedHabits)
        setDayLogs(loadedLogs)
        setErrorMessage(null)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setErrorMessage('Could not load daily habits for this calendar day.')
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [database, selectedDate])

  useEffect(() => {
    const syncDateRollover = () => {
      const latestToday = computeToday()
      if (latestToday !== lastTodayRef.current) {
        const previousToday = lastTodayRef.current
        lastTodayRef.current = latestToday
        setTodayLocalDate(latestToday)
        setSelectedDate((current) =>
          current === previousToday ? latestToday : current,
        )
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncDateRollover()
      }
    }

    window.addEventListener('focus', syncDateRollover)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', syncDateRollover)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [computeToday])

  const activeHabits = useMemo(
    () => habits.filter((habit) => !habit.archived),
    [habits],
  )
  const archivedHabits = useMemo(
    () => habits.filter((habit) => habit.archived),
    [habits],
  )

  const logByHabitSlotKey = useMemo(() => {
    const map = new Map<string, HabitLog>()
    for (const log of dayLogs) {
      map.set(`${log.habitId}:${log.slotId}`, log)
    }
    return map
  }, [dayLogs])

  const archivedLogsForSelectedDay = useMemo(() => {
    const archivedById = new Map(archivedHabits.map((h) => [h.id, h]))
    return dayLogs
      .map((log) => {
        const habit = archivedById.get(log.habitId)
        if (!habit) return null
        const slot = habit.slots.find((item) => item.id === log.slotId)
        return { log, habit, slot }
      })
      .filter(
        (
          entry,
        ): entry is {
          log: HabitLog
          habit: HabitDefinition
          slot: HabitDefinition['slots'][number] | undefined
        } => entry !== null,
      )
  }, [archivedHabits, dayLogs])

  const openCreateForm = () => {
    setEditingHabitId(null)
    setNameDraft('')
    setQuantityLabelDraft('')
    setSlotDrafts(makeDefaultSlotDrafts())
    setFormError(null)
    setStatusMessage(null)
    setIsFormOpen(true)
  }

  const openEditForm = (habit: HabitDefinition) => {
    setEditingHabitId(habit.id)
    setNameDraft(habit.name)
    setQuantityLabelDraft(habit.quantityLabel ?? '')
    setSlotDrafts(
      habit.slots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        localTime: slot.localTime ?? '',
      })),
    )
    setFormError(null)
    setStatusMessage(null)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    setIsFormOpen(false)
    setEditingHabitId(null)
    setFormError(null)
  }

  const handleSeedExampleTemplate = async () => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const timestamp = toUTCISOString(now())
      await saveHabitDefinition(
        {
          id: createId(),
          name: '[Example] Daily AM / PM Routine',
          slots: [
            { id: createId(), label: 'AM', localTime: '08:00' },
            { id: createId(), label: 'PM', localTime: '20:00' },
          ],
          archived: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        database,
      )
      await reloadData(selectedDate)
      setStatusMessage(
        'Added optional [Example] Daily AM / PM Routine. Rename or adjust slots anytime.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not add example habit template.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleSaveHabit = async () => {
    setFormError(null)
    setStatusMessage(null)

    const existing =
      editingHabitId !== null
        ? habits.find((habit) => habit.id === editingHabitId)
        : undefined
    const timestamp = toUTCISOString(now())

    const trimmedName = nameDraft.trim()
    const trimmedQuantityLabel = quantityLabelDraft.trim()
    const normalizedSlots = slotDrafts.map((slot) => {
      const trimmedTime = slot.localTime.trim()
      return {
        id: slot.id,
        label: slot.label.trim(),
        ...(trimmedTime !== '' ? { localTime: trimmedTime } : {}),
      }
    })

    const candidate = {
      id: existing?.id ?? createId(),
      name: trimmedName,
      slots: normalizedSlots,
      ...(trimmedQuantityLabel !== ''
        ? { quantityLabel: trimmedQuantityLabel }
        : {}),
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }

    const validation = habitDefinitionSchema.safeParse(candidate)
    if (!validation.success) {
      const issue = validation.error.issues[0]
      setFormError(
        issue?.message ??
          'Enter a habit name and at least one slot with a valid label and optional HH:MM time.',
      )
      return
    }

    setIsBusy(true)
    try {
      await saveHabitDefinition(validation.data, database)
      await reloadData(selectedDate)
      setIsFormOpen(false)
      setEditingHabitId(null)
      setStatusMessage(
        existing
          ? `Updated habit "${validation.data.name}".`
          : `Created habit "${validation.data.name}".`,
      )
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not save habit.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleArchiveToggle = async (
    habit: HabitDefinition,
    archived: boolean,
  ) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await archiveHabitDefinition(
        habit.id,
        archived,
        toUTCISOString(now()),
        database,
      )
      if (editingHabitId === habit.id) {
        setIsFormOpen(false)
        setEditingHabitId(null)
      }
      await reloadData(selectedDate)
      setStatusMessage(
        archived
          ? `Archived "${habit.name}". Historical check-ins are preserved.`
          : `Restored "${habit.name}" to active daily habits.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not update archive state.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleLogSlot = async (
    habit: HabitDefinition,
    slot: HabitDefinition['slots'][number],
    status: 'done' | 'skipped',
  ) => {
    setErrorMessage(null)
    setStatusMessage(null)

    const draftKey = `${habit.id}:${slot.id}:${selectedDate}`
    const rawQuantity = quantityDrafts[draftKey] ?? ''
    const parsedQuantity = parseOptionalQuantity(rawQuantity)

    const candidate = {
      habitId: habit.id,
      slotId: slot.id,
      localDate: selectedDate,
      timeZone: activeTimeZone,
      status,
      occurredAt: toUTCISOString(now()),
      ...(parsedQuantity !== undefined ? { quantity: parsedQuantity } : {}),
    }

    const validation = habitLogInputSchema.safeParse(candidate)
    if (!validation.success) {
      const issue = validation.error.issues[0]
      setErrorMessage(
        issue?.message ?? 'Enter a valid nonnegative quantity or leave blank.',
      )
      return
    }

    setIsBusy(true)
    try {
      await upsertHabitLog(validation.data, database)
      await reloadData(selectedDate)
      setStatusMessage(
        `Marked "${habit.name} — ${slot.label}" as ${status} for ${selectedDate}.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not save habit check-in.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleUndoSlot = async (
    habit: HabitDefinition,
    slot: HabitDefinition['slots'][number],
    log: HabitLog,
  ) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await deleteHabitLog(log.id, database)
      await reloadData(selectedDate)
      setStatusMessage(
        `Cleared check-in for "${habit.name} — ${slot.label}" on ${selectedDate}.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not undo check-in.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <section
        aria-label="Daily habits"
        className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Daily habits</h2>
            <p className="mt-1 text-xs text-muted">
              Records your own check-in events by calendar day and IANA time
              zone — no medical, dosing, or timing prescriptions.
            </p>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={openCreateForm}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            New habit
          </button>
        </div>

        <div
          role="region"
          aria-label="Calendar day navigation"
          className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                setSelectedDate((current) => shiftLocalDate(current, -1))
              }
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
            >
              Previous day
            </button>
            <div>
              <label
                htmlFor={dateInputId}
                className="block text-xs font-medium"
              >
                Calendar date
              </label>
              <input
                id={dateInputId}
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  const next = event.target.value
                  if (isLocalDate(next)) {
                    setSelectedDate(next)
                  }
                }}
                className="mt-1 block min-h-11 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                setSelectedDate((current) => shiftLocalDate(current, 1))
              }
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
            >
              Next day
            </button>
            <button
              type="button"
              disabled={isBusy || selectedDate === todayLocalDate}
              onClick={() => {
                const latestToday = computeToday()
                lastTodayRef.current = latestToday
                setTodayLocalDate(latestToday)
                setSelectedDate(latestToday)
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-40"
            >
              Today
            </button>
          </div>
          <p className="text-xs text-muted">
            Day: <span className="font-medium">{selectedDate}</span> · Zone:{' '}
            <span className="font-medium">{activeTimeZone}</span>
          </p>
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
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-medium"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => void reloadData(selectedDate)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {isFormOpen && (
          <div
            role="region"
            aria-label={editingHabitId ? 'Edit habit' : 'Create habit'}
            className="space-y-4 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4"
          >
            <h3 className="text-base font-semibold">
              {editingHabitId ? 'Edit habit' : 'Create habit'}
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={habitNameInputId}
                  className="block text-xs font-medium"
                >
                  Habit name
                </label>
                <input
                  id={habitNameInputId}
                  type="text"
                  maxLength={MAX_HABIT_NAME_LENGTH}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder="e.g., Hydration, Stretching, Daily Routine"
                  className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor={quantityLabelInputId}
                  className="block text-xs font-medium"
                >
                  Optional quantity label
                </label>
                <input
                  id={quantityLabelInputId}
                  type="text"
                  maxLength={MAX_HABIT_QUANTITY_LABEL_LENGTH}
                  value={quantityLabelDraft}
                  onChange={(event) =>
                    setQuantityLabelDraft(event.target.value)
                  }
                  placeholder="e.g., glasses, minutes, units"
                  className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">
                  Scheduled slots (at least 1)
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setSlotDrafts((current) => [
                      ...current,
                      { id: createId(), label: '', localTime: '' },
                    ])
                  }
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                >
                  Add slot
                </button>
              </div>

              <ul aria-label="Habit slots editor" className="space-y-2">
                {slotDrafts.map((slot, index) => (
                  <li
                    key={slot.id}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 sm:grid-cols-[1fr_10rem_auto]"
                  >
                    <label className="block text-xs font-medium">
                      Slot {index + 1} label
                      <input
                        type="text"
                        maxLength={MAX_HABIT_SLOT_LABEL_LENGTH}
                        value={slot.label}
                        placeholder="e.g., AM, PM, Midday"
                        onChange={(event) => {
                          const nextLabel = event.target.value
                          setSlotDrafts((current) =>
                            current.map((item) =>
                              item.id === slot.id
                                ? { ...item, label: nextLabel }
                                : item,
                            ),
                          )
                        }}
                        className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-medium">
                      Slot {index + 1} time (HH:MM)
                      <input
                        type="text"
                        value={slot.localTime}
                        placeholder="Optional, e.g. 08:00"
                        onChange={(event) => {
                          const nextTime = event.target.value
                          setSlotDrafts((current) =>
                            current.map((item) =>
                              item.id === slot.id
                                ? { ...item, localTime: nextTime }
                                : item,
                            ),
                          )
                        }}
                        className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                      />
                    </label>

                    <div className="flex items-end">
                      <button
                        type="button"
                        disabled={slotDrafts.length <= 1}
                        aria-label={`Remove slot ${index + 1}`}
                        onClick={() =>
                          setSlotDrafts((current) =>
                            current.filter((item) => item.id !== slot.id),
                          )
                        }
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {formError && (
              <p role="alert" className="text-xs font-medium">
                {formError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleSaveHabit()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
              >
                {editingHabitId ? 'Save changes' : 'Save habit'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={closeForm}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-muted">
            Loading daily habits…
          </p>
        ) : activeHabits.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
            <p className="text-muted">
              No active daily habits yet. Create your own habit with custom
              slots, or add an optional AM / PM check-in template.
            </p>
            {habits.length === 0 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleSeedExampleTemplate()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold"
              >
                Add [Example] AM / PM Check-in
              </button>
            )}
          </div>
        ) : (
          <ul aria-label="Active daily habits" className="space-y-4">
            {activeHabits.map((habit) => (
              <li
                key={habit.id}
                className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">{habit.name}</h3>
                    {habit.quantityLabel && (
                      <p className="text-xs text-muted">
                        Optional quantity unit: {habit.quantityLabel}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`Edit ${habit.name}`}
                      onClick={() => openEditForm(habit)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`Archive ${habit.name}`}
                      onClick={() => void handleArchiveToggle(habit, true)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                    >
                      Archive
                    </button>
                  </div>
                </div>

                <ul
                  aria-label={`Slots for ${habit.name}`}
                  className="space-y-2"
                >
                  {habit.slots.map((slot) => {
                    const log = logByHabitSlotKey.get(`${habit.id}:${slot.id}`)
                    const draftKey = `${habit.id}:${slot.id}:${selectedDate}`
                    const quantityValue =
                      quantityDrafts[draftKey] ??
                      (log?.quantity !== undefined ? String(log.quantity) : '')

                    return (
                      <li
                        key={slot.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 text-sm"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{slot.label}</span>
                            {slot.localTime && (
                              <span className="text-xs text-muted">
                                ({slot.localTime})
                              </span>
                            )}
                            <span
                              className={
                                log?.status === 'done'
                                  ? 'rounded border border-[var(--accent)] bg-[var(--selected)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]'
                                  : 'rounded border border-[var(--line)] px-2 py-0.5 text-xs font-medium'
                              }
                            >
                              {log
                                ? log.status === 'done'
                                  ? 'Done'
                                  : 'Skipped'
                                : 'Not logged'}
                            </span>
                          </div>
                          {log && (
                            <p className="text-xs text-muted">
                              Logged at{' '}
                              {formatEventTime(log.occurredAt, log.timeZone)}
                              {log.quantity !== undefined
                                ? ` · ${log.quantity}${habit.quantityLabel ? ` ${habit.quantityLabel}` : ''}`
                                : ''}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {habit.quantityLabel && (
                            <label className="flex items-center gap-1.5 text-xs font-medium">
                              <span className="sr-only">
                                Quantity ({habit.quantityLabel}) for{' '}
                                {habit.name} — {slot.label}
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="any"
                                value={quantityValue}
                                placeholder={habit.quantityLabel}
                                aria-label={`Quantity for ${habit.name} — ${slot.label}`}
                                onChange={(event) => {
                                  const nextVal = event.target.value
                                  setQuantityDrafts((current) => ({
                                    ...current,
                                    [draftKey]: nextVal,
                                  }))
                                }}
                                className="min-h-11 w-24 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-xs"
                              />
                            </label>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            aria-label={`Mark done: ${habit.name} — ${slot.label}`}
                            onClick={() =>
                              void handleLogSlot(habit, slot, 'done')
                            }
                            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                          >
                            Mark done
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            aria-label={`Skip: ${habit.name} — ${slot.label}`}
                            onClick={() =>
                              void handleLogSlot(habit, slot, 'skipped')
                            }
                            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          >
                            Skip
                          </button>

                          {log && (
                            <button
                              type="button"
                              disabled={isBusy}
                              aria-label={`Undo: ${habit.name} — ${slot.label}`}
                              onClick={() =>
                                void handleUndoSlot(habit, slot, log)
                              }
                              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {archivedLogsForSelectedDay.length > 0 && (
          <div
            role="region"
            aria-label={`Archived habit history for ${selectedDate}`}
            className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-xs"
          >
            <h3 className="font-semibold">
              Archived habit history on {selectedDate}
            </h3>
            <ul className="space-y-1">
              {archivedLogsForSelectedDay.map(({ log, habit, slot }) => (
                <li key={log.id} className="text-muted">
                  <span className="font-medium text-[var(--ink)]">
                    {habit.name}
                  </span>{' '}
                  — {slot?.label ?? 'Slot'}:{' '}
                  {log.status === 'done' ? 'Done' : 'Skipped'} at{' '}
                  {formatEventTime(log.occurredAt, log.timeZone)}
                  {log.quantity !== undefined
                    ? ` · ${log.quantity}${habit.quantityLabel ? ` ${habit.quantityLabel}` : ''}`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {archivedHabits.length > 0 && (
          <div className="space-y-2 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              onClick={() => setShowArchived((current) => !current)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              {showArchived
                ? `Hide archived habits (${archivedHabits.length})`
                : `Show archived habits (${archivedHabits.length})`}
            </button>

            {showArchived && (
              <ul aria-label="Archived habits" className="space-y-2">
                {archivedHabits.map((habit) => (
                  <li
                    key={habit.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold">{habit.name}</span>
                      <span className="ml-2 text-xs text-muted">
                        ({habit.slots.map((slot) => slot.label).join(', ')})
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`Restore ${habit.name}`}
                      onClick={() => void handleArchiveToggle(habit, false)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
