import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import './app/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('The application root element is missing.')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
