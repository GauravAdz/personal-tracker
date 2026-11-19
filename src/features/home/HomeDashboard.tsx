import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { countDatabaseRecords } from '../../data/backup'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  deleteHabitLog,
  getAppSettings,
  listBodyWeights,
  listHabitDefinitions,
  listHabitLogsForDay,
  listRoutines,
  type SessionSnapshot,
  upsertHabitLog,
} from '../../data/repositories'
import { computeBodyWeightTrend, formatWeightKg } from '../../domain/analytics'
import type {
  AppSettings,
  BodyWeightEntry,
  HabitDefinition,
  HabitLog,
  IANATimeZone,
  Routine,
} from '../../domain/models'
import {
  getDefaultTimeZone,
  getLocalDate,
  toUTCISOString,
} from '../../domain/time'
import {
  getActiveSessionSnapshot,
  listSessionHistory,
  type SessionHistorySummary,
} from '../../services/workout'

const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000

export interface HomeDashboardProps {
  database?: PersonalTrackerDB
  now?: () => Date
  timeZone?: IANATimeZone
}

export function HomeDashboard({
  database = db,
  now = () => new Date(),
  timeZone,
}: HomeDashboardProps) {
  const activeTimeZone = useMemo(
    () => timeZone ?? getDefaultTimeZone(),
    [timeZone],
  )
  const computeToday = useCallback(
    () => getLocalDate(toUTCISOString(now()), activeTimeZone),
    [activeTimeZone, now],
  )

  const [todayLocalDate, setTodayLocalDate] = useState(() => computeToday())
  const [activeSession, setActiveSession] = useState<SessionSnapshot | null>(
    null,
  )
  const [routines, setRoutines] = useState<Routine[]>([])
  const [history, setHistory] = useState<SessionHistorySummary[]>([])
  const [activeHabits, setActiveHabits] = useState<HabitDefinition[]>([])
  const [todayHabitLogs, setTodayHabitLogs] = useState<HabitLog[]>([])
  const [bodyWeights, setBodyWeights] = useState<BodyWeightEntry[]>([])
  const [appSettings, setAppSettings] = useState<AppSettings | undefined>(
    undefined,
  )
  const [localRecordCount, setLocalRecordCount] = useState(0)

  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    const currentLocalDate = computeToday()
    setTodayLocalDate(currentLocalDate)
    try {
      const [
        loadedActive,
        loadedRoutines,
        loadedHistory,
        loadedHabits,
        loadedTodayLogs,
        loadedWeights,
        loadedSettings,
        loadedCount,
      ] = await Promise.all([
        getActiveSessionSnapshot(database),
        listRoutines(database),
        listSessionHistory(database),
        listHabitDefinitions({ includeArchived: false }, database),
        listHabitLogsForDay(currentLocalDate, database),
        listBodyWeights(database),
        getAppSettings(database),
        countDatabaseRecords(database),
      ])
      setActiveSession(loadedActive ?? null)
      setRoutines(loadedRoutines)
      setHistory(loadedHistory)
      setActiveHabits(loadedHabits)
      setTodayHabitLogs(loadedTodayLogs)
      setBodyWeights(loadedWeights)
      setAppSettings(loadedSettings)
      setLocalRecordCount(loadedCount)
      setErrorMessage(null)
    } catch {
      setErrorMessage('Could not load today’s local summary.')
    } finally {
      setIsLoading(false)
    }
  }, [computeToday, database])

  useEffect(() => {
    let mounted = true
    const currentLocalDate = computeToday()
    void Promise.all([
      getActiveSessionSnapshot(database),
      listRoutines(database),
      listSessionHistory(database),
      listHabitDefinitions({ includeArchived: false }, database),
      listHabitLogsForDay(currentLocalDate, database),
      listBodyWeights(database),
      getAppSettings(database),
      countDatabaseRecords(database),
    ])
      .then(
        ([
          loadedActive,
          loadedRoutines,
          loadedHistory,
          loadedHabits,
          loadedTodayLogs,
          loadedWeights,
          loadedSettings,
          loadedCount,
        ]) => {
          if (!mounted) return
          setTodayLocalDate(currentLocalDate)
          setActiveSession(loadedActive ?? null)
          setRoutines(loadedRoutines)
          setHistory(loadedHistory)
          setActiveHabits(loadedHabits)
          setTodayHabitLogs(loadedTodayLogs)
          setBodyWeights(loadedWeights)
          setAppSettings(loadedSettings)
          setLocalRecordCount(loadedCount)
          setIsLoading(false)
        },
      )
      .catch(() => {
        if (!mounted) return
        setErrorMessage('Could not load today’s local summary.')
        setIsLoading(false)
      })

    const handleRefresh = () => {
      if (document.visibilityState === 'visible') {
        void loadDashboard()
      }
    }
    const handleFocus = () => {
      void loadDashboard()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleRefresh)
    return () => {
      mounted = false
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleRefresh)
    }
  }, [computeToday, database, loadDashboard])

  const activeRoutineName = useMemo(() => {
    if (!activeSession?.session.routineId) return null
    return (
      routines.find((item) => item.id === activeSession.session.routineId)
        ?.name ?? 'Workout session'
    )
  }, [activeSession, routines])

  const lastWorkout = useMemo(() => {
    const latestCompleted = history.find(
      (entry) => entry.session.status === 'completed',
    )
    return latestCompleted ?? history[0] ?? null
  }, [history])

  const logByHabitSlotKey = useMemo(() => {
    const map = new Map<string, HabitLog>()
    for (const log of todayHabitLogs) {
      map.set(`${log.habitId}:${log.slotId}`, log)
    }
    return map
  }, [todayHabitLogs])

  const weightTrend = useMemo(
    () => computeBodyWeightTrend(bodyWeights, todayLocalDate),
    [bodyWeights, todayLocalDate],
  )

  const exportReminder = useMemo(() => {
    const lastExportedAt = appSettings?.lastExportedAt
    if (!lastExportedAt) {
      return {
        label: 'Never exported',
        needsReminder: localRecordCount > 0,
        message:
          localRecordCount > 0
            ? 'You have local data without a downloaded backup yet.'
            : 'Export a local JSON backup anytime from Settings.',
      }
    }
    const localExportDate = getLocalDate(lastExportedAt, activeTimeZone)
    const elapsedMs = now().getTime() - new Date(lastExportedAt).getTime()
    const isStale = elapsedMs >= EXPORT_REMINDER_MS
    return {
      label: localExportDate,
      needsReminder: isStale,
      message: isStale
        ? 'Your last backup is at least 7 days old — consider downloading a fresh copy.'
        : 'Your local backup is up to date.',
    }
  }, [activeTimeZone, appSettings, localRecordCount, now])

  const handleQuickHabitLog = async (
    habit: HabitDefinition,
    slot: HabitDefinition['slots'][number],
    status: 'done' | 'skipped',
  ) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const occurredAt = toUTCISOString(now())
      const localDate = getLocalDate(occurredAt, activeTimeZone)
      await upsertHabitLog(
        {
          habitId: habit.id,
          slotId: slot.id,
          localDate,
          timeZone: activeTimeZone,
          status,
          occurredAt,
        },
        database,
      )
      await loadDashboard()
      setStatusMessage(
        `Marked "${habit.name} — ${slot.label}" as ${status} for ${localDate}.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not update check-in.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleQuickHabitUndo = async (
    habit: HabitDefinition,
    slot: HabitDefinition['slots'][number],
    log: HabitLog,
  ) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await deleteHabitLog(log.id, database)
      await loadDashboard()
      setStatusMessage(
        `Cleared check-in for "${habit.name} — ${slot.label}" on ${log.localDate}.`,
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
    <div aria-label="Today dashboard" className="mt-6 space-y-5">
      <p className="text-sm text-muted">
        Today · <span className="font-medium">{todayLocalDate}</span> (
        {activeTimeZone})
      </p>

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
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 text-sm font-medium"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm text-muted">
          Loading today’s dashboard…
        </p>
      ) : (
        <>
          <section
            aria-label="Workout call to action"
            className="space-y-3 rounded-lg border-2 border-[var(--accent)] bg-[var(--raised)] p-4"
          >
            {activeSession ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="inline-block rounded bg-[var(--selected)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">
                    Active workout
                  </span>
                  <h2 className="mt-1 text-xl font-semibold">
                    {activeRoutineName ?? 'Ad-hoc workout'}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    Started{' '}
                    {getLocalDate(
                      activeSession.session.startedAt,
                      activeTimeZone,
                    )}{' '}
                    · {activeSession.exercises.length}{' '}
                    {activeSession.exercises.length === 1
                      ? 'exercise'
                      : 'exercises'}{' '}
                    · {activeSession.setLogs.length}{' '}
                    {activeSession.setLogs.length === 1 ? 'set' : 'sets'} logged
                  </p>
                </div>
                <Link
                  to="/workouts"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-5 py-2 text-sm font-semibold text-[var(--accent)]"
                >
                  Resume workout
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Ready to train</h2>
                  <p className="mt-1 text-xs text-muted">
                    {routines.length > 0
                      ? `${routines.length} saved ${routines.length === 1 ? 'routine' : 'routines'} ready offline.`
                      : 'No routines saved yet — build one or launch an ad-hoc workout.'}
                  </p>
                </div>
                <Link
                  to="/workouts"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-5 py-2 text-sm font-semibold text-[var(--accent)]"
                >
                  Start workout
                </Link>
              </div>
            )}
          </section>

          <section
            aria-label="Today's habits"
            className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Today&apos;s habits</h2>
              <Link
                to="/health"
                className="text-link inline-flex min-h-11 items-center text-xs font-medium"
              >
                Manage habits
              </Link>
            </div>

            {activeHabits.length === 0 ? (
              <p className="text-sm text-muted">
                No active daily habits configured yet.
              </p>
            ) : (
              <ul aria-label="Today's habit check-ins" className="space-y-3">
                {activeHabits.map((habit) => (
                  <li
                    key={habit.id}
                    className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
                  >
                    <p className="text-sm font-semibold">{habit.name}</p>
                    <div className="space-y-2">
                      {habit.slots.map((slot) => {
                        const log = logByHabitSlotKey.get(
                          `${habit.id}:${slot.id}`,
                        )
                        return (
                          <div
                            key={slot.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">
                                {slot.label}
                              </span>
                              {slot.localTime && (
                                <span className="text-muted">
                                  ({slot.localTime})
                                </span>
                              )}
                              <span
                                className={
                                  log?.status === 'done'
                                    ? 'rounded border border-[var(--accent)] bg-[var(--selected)] px-1.5 py-0.5 font-semibold text-[var(--accent)]'
                                    : 'rounded border border-[var(--line)] px-1.5 py-0.5 font-medium'
                                }
                              >
                                {log
                                  ? log.status === 'done'
                                    ? 'Done'
                                    : 'Skipped'
                                  : 'Not logged'}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                disabled={isBusy}
                                aria-label={`Quick mark done: ${habit.name} — ${slot.label}`}
                                onClick={() =>
                                  void handleQuickHabitLog(habit, slot, 'done')
                                }
                                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1 font-semibold text-[var(--accent)] disabled:opacity-50"
                              >
                                Done
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                aria-label={`Quick skip: ${habit.name} — ${slot.label}`}
                                onClick={() =>
                                  void handleQuickHabitLog(
                                    habit,
                                    slot,
                                    'skipped',
                                  )
                                }
                                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 font-medium disabled:opacity-50"
                              >
                                Skip
                              </button>
                              {log && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  aria-label={`Quick undo: ${habit.name} — ${slot.label}`}
                                  onClick={() =>
                                    void handleQuickHabitUndo(habit, slot, log)
                                  }
                                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 font-medium disabled:opacity-50"
                                >
                                  Undo
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section
              aria-label="Last workout summary"
              className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
            >
              <h2 className="text-lg font-semibold">Last workout</h2>
              {lastWorkout ? (
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">
                    {lastWorkout.routineName ?? 'Ad-hoc workout'}{' '}
                    <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-xs font-medium">
                      {lastWorkout.session.status === 'completed'
                        ? 'Completed'
                        : 'Cancelled'}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    Date:{' '}
                    {getLocalDate(
                      lastWorkout.session.endedAt ??
                        lastWorkout.session.startedAt,
                      activeTimeZone,
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {lastWorkout.exerciseCount}{' '}
                    {lastWorkout.exerciseCount === 1 ? 'exercise' : 'exercises'}{' '}
                    · {lastWorkout.workingSetCount} working sets
                    {lastWorkout.warmupSetCount > 0
                      ? `, ${lastWorkout.warmupSetCount} warm-up`
                      : ''}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted">No completed workouts yet.</p>
              )}
            </section>

            <section
              aria-label="Body-weight trend summary"
              className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Body weight</h2>
                <Link
                  to="/health"
                  className="text-link inline-flex min-h-11 items-center text-xs font-medium"
                >
                  Open weight log
                </Link>
              </div>
              {weightTrend.currentEntry ? (
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">
                    Latest: {formatWeightKg(weightTrend.currentEntry.weightKg)}{' '}
                    <span className="text-xs font-normal text-muted">
                      ({weightTrend.currentEntry.localDate})
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    7-day average:{' '}
                    {weightTrend.averageKg !== null
                      ? formatWeightKg(weightTrend.averageKg)
                      : '—'}{' '}
                    ({weightTrend.availabilityLabel})
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  No body-weight check-ins yet ({weightTrend.availabilityLabel}
                  ).
                </p>
              )}
            </section>
          </div>

          <section
            aria-label="Backup status and settings"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm"
          >
            <div>
              <h2 className="text-base font-semibold">
                Backups &amp; settings
              </h2>
              <p className="mt-1 text-xs text-muted">
                Last exported:{' '}
                <span className="font-medium">{exportReminder.label}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {exportReminder.message}
              </p>
            </div>
            <Link
              to="/settings"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold"
            >
              Open Settings &amp; Backups
            </Link>
          </section>
        </>
      )}
    </div>
  )
}
