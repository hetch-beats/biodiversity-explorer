import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
// Self-hosted via @fontsource (not a Google Fonts CDN <link>) so the font
// still loads with no network access — this app is offline-capable, and a
// CDN font would silently fall back to the system stack on a first offline
// launch. Weights match the font-medium/semibold/bold Tailwind classes used
// across the app plus the regular-weight body default.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './styles/globals.css'

// Deliberately NOT wrapped in <React.StrictMode>. In dev, StrictMode
// double-invokes mount effects (mount -> cleanup -> mount again) to surface
// side-effect bugs, but Globe.tsx's setup effect creates a real WebGL
// Engine/Scene on mount and disposes it on cleanup. The double-invoke tears
// down the first Engine's WebGL context and creates a second Engine on the
// same <canvas> — browsers don't hand out a fresh context once one has been
// explicitly lost, so the second Engine can never draw again. The globe then
// just shows whatever the first (already-disposed) Engine happened to render
// before teardown — e.g. the grid and earth, but never any occurrence
// points, no matter what's selected. This is a known Babylon.js/React 18
// StrictMode incompatibility; StrictMode's production-only value here isn't
// worth breaking the one component that owns a raw WebGL context.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
