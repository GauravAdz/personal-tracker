import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import { getAppSettings, saveRoutine } from '../../data/repositories'
import { logWorkoutSet, startWorkoutFromRoutine } from '../../services/workout'
import { RestTimer, type WakeLockAdapter } from './RestTimer'

const routineId = '11111111-1111-4111-8111-111111111111'
const itemOneId = '11111111-1111-4111-8111-111111111112'

describe('RestTimer — persisted UTC deadline, suspension/reload recovery, and Wake Lock (T12)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(async () => {
    testDb = createDatabase(`rest-timer-${crypto.randomUUID()}`)
    await saveRoutine(
      {
        id: routineId,
        name: 'Timer Routine',
        items: [
          {
            id: itemOneId,
            exerciseId: 'fedb:Barbell_Bench_Press_-_Medium_Grip',
            order: 0,
            workingSets: 3,
            repMin: 6,
            repMax: 8,
            restSeconds: 120,
          },
        ],
        createdAt: '2026-10-27T09:00:00.000Z',
        updatedAt: '2026-10-27T09:00:00.000Z',
      },
      testDb,
    )
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('starts from persisted endsAt after set log, refreshes from wall clock after suspension/reload, supports pause/adjust/skip/restart, and leaves no zombie intervals', async () => {
    const user = userEvent.setup()
    let currentMs = Date.parse('2026-10-27T10:00:00.000Z')
    const now = () => new Date(currentMs)

    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

    const started = await startWorkoutFromRoutine(
      routineId,
      { startedAt: now().toISOString() },
      testDb,
    )
    const firstExercise = started.exercises[0]!

    // Logging a set automatically persists a 120s restTimer deadline in AppSettings
    await logWorkoutSet(
      {
        sessionId: started.session.id,
        sessionExerciseId: firstExercise.id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: 80,
        reps: 8,
        completedAt: now().toISOString(),
      },
      testDb,
    )

    let settings = await getAppSettings(testDb)
    expect(settings?.restTimer).toEqual({
      sessionId: started.session.id,
      endsAt: '2026-10-27T10:02:00.000Z',
    })

    const { unmount } = render(
      <RestTimer
        sessionId={started.session.id}
        restTimer={settings?.restTimer}
        defaultRestSeconds={120}
        database={testDb}
        now={now}
        onChanged={async () => {
          settings = await getAppSettings(testDb)
        }}
      />,
    )

    expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
      '02:00',
    )

    // Simulate 45s background suspension without any interval tick, then visibilitychange reopen
    currentMs += 45_000
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
      '01:15',
    )

    // Simulate reload: unmount, advance wall clock 15s more, and mount fresh RestTimer from DB settings
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()

    currentMs += 15_000
    settings = await getAppSettings(testDb)

    const reloadRender = render(
      <RestTimer
        sessionId={started.session.id}
        restTimer={settings?.restTimer}
        defaultRestSeconds={120}
        database={testDb}
        now={now}
        onChanged={async () => {
          settings = await getAppSettings(testDb)
        }}
      />,
    )

    expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
      '01:00',
    )

    // Adjust +15s -> 01:15
    await user.click(
      screen.getByRole('button', { name: 'Adjust rest timer +15 seconds' }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
        '01:15',
      ),
    )

    // Pause -> advance wall clock 30s -> remains paused at 01:15 -> Resume
    await user.click(screen.getByRole('button', { name: 'Pause rest' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume rest' })).toBeVisible(),
    )
    currentMs += 30_000
    expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
      '01:15',
    )

    await user.click(screen.getByRole('button', { name: 'Resume rest' }))
    await waitFor(() =>
      expect(settings?.restTimer?.endsAt).toBe('2026-10-27T10:02:45.000Z'),
    )

    // Skip rest -> 00:00 and clears AppSettings.restTimer
    await user.click(screen.getByRole('button', { name: 'Skip rest' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
        '00:00',
      ),
    )
    expect((await getAppSettings(testDb))?.restTimer).toBeUndefined()

    // Restart (120s) -> 02:00
    await user.click(screen.getByRole('button', { name: 'Restart (120s)' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Remaining rest time')).toHaveTextContent(
        '02:00',
      ),
    )

    const intervalsCreated = setIntervalSpy.mock.calls.length
    reloadRender.unmount()
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(
      intervalsCreated,
    )
  })

  it('acquires, reacquires on visibilitychange, and releases Screen Wake Lock, and handles denial non-fatally', async () => {
    const user = userEvent.setup()
    const releaseMock = vi.fn().mockResolvedValue(undefined)
    const workingWakeLock: WakeLockAdapter = {
      request: vi.fn().mockResolvedValue({
        released: false,
        release: releaseMock,
      }),
    }

    const { unmount } = render(
      <RestTimer
        sessionId="22222222-2222-4222-8222-222222222221"
        database={testDb}
        wakeLockApi={workingWakeLock}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Keep screen awake' }))
    expect(workingWakeLock.request).toHaveBeenCalledWith('screen')
    expect(screen.getByText(/Active while Gym Mode is visible/i)).toBeVisible()

    // Simulate returning to visible tab -> reacquires Wake Lock
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(workingWakeLock.request).toHaveBeenCalledTimes(2)

    // Unmounting releases Wake Lock
    unmount()
    expect(releaseMock).toHaveBeenCalled()

    // Non-fatal failure when Wake Lock is denied by browser
    const deniedWakeLock: WakeLockAdapter = {
      request: vi
        .fn()
        .mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
    }
    render(
      <RestTimer
        sessionId="22222222-2222-4222-8222-222222222221"
        database={testDb}
        wakeLockApi={deniedWakeLock}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Keep screen awake' }))
    expect(
      await screen.findByText(
        /Unavailable \/ declined \(timer still tracks wall clock\)/i,
      ),
    ).toBeVisible()
  })
})
