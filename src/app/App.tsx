import { useEffect, useRef } from 'react'
import {
  Link,
  matchPath,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { ExerciseLibrary } from '../features/exercises/ExerciseLibrary'
import { GymWorkspace } from '../features/gym/GymWorkspace'
import { DailyHabits } from '../features/health/DailyHabits'
import { HomeDashboard } from '../features/home/HomeDashboard'
import { BodyWeightTracker } from '../features/measurements/BodyWeightTracker'
import { BackupPanel } from '../features/settings/BackupPanel'
import { UpdatePrompt } from './UpdatePrompt'

const destinations = [
  { path: '/', label: 'Home' },
  { path: '/workouts', label: 'Workouts' },
  { path: '/exercises', label: 'Exercises' },
  { path: '/health', label: 'Health' },
  { path: '/settings', label: 'Settings' },
] as const

export function App() {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const previousLocation = useRef(location.key)

  useEffect(() => {
    const destination = destinations.find((item) =>
      matchPath(item.path, location.pathname),
    )
    document.title = `${destination?.label ?? 'Page not found'} · Personal Tracker`
    if (previousLocation.current !== location.key) {
      mainRef.current?.focus()
      previousLocation.current = location.key
    }
  }, [location.key, location.pathname])

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          mainRef.current?.focus()
        }}
      >
        Skip to content
      </a>
      <header className="app-header">
        <div className="shell-width flex items-center justify-between gap-4">
          <p className="text-lg font-semibold tracking-tight">
            Personal Tracker
          </p>
          <span className="text-sm text-muted">Personal use</span>
        </div>
      </header>
      <UpdatePrompt />
      <nav aria-label="Main navigation" className="app-navigation">
        <div className="shell-width navigation-items">
          {destinations.map(({ path, label }) => (
            <NavLink key={path} to={path} end className="navigation-link">
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="shell-width main-content"
      >
        <Routes>
          {destinations.map(({ path, label }) => (
            <Route
              key={path}
              path={path}
              element={
                <>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    {label}
                  </h1>
                  {path === '/' ? (
                    <HomeDashboard />
                  ) : path === '/settings' ? (
                    <BackupPanel />
                  ) : path === '/exercises' ? (
                    <ExerciseLibrary />
                  ) : path === '/workouts' ? (
                    <GymWorkspace />
                  ) : (
                    <>
                      <DailyHabits />
                      <BodyWeightTracker />
                    </>
                  )}
                </>
              }
            />
          ))}
          <Route
            path="*"
            element={
              <>
                <h1 className="text-3xl font-semibold">Page not found</h1>
                <p className="mt-4 text-muted">
                  This address does not match a page in Personal Tracker.
                </p>
                <Link
                  className="text-link mt-6 inline-flex min-h-12 items-center"
                  to="/"
                >
                  Return to Home
                </Link>
              </>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
