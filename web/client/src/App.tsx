import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';

const Landing = lazy(() => import('./pages/Landing'));
const MapPage = lazy(() => import('./pages/MapPage'));
const AgenciesPage = lazy(() => import('./pages/AgenciesPage'));
const MonitorPage = lazy(() => import('./pages/MonitorPage'));

function PageFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}
    >
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/view-map" element={<MapPage />} />
          <Route path="/dash/agencies" element={<AgenciesPage />} />
          <Route path="/dash/monitor" element={<MonitorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ThemeProvider>
  );
}
