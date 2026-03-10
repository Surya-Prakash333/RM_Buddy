import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Suspense, lazy } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';

// Lazy-load pages so each route is a separate code-split chunk
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));

// ── Route-level loading fallback ─────────────────────────────────────────────

function PageLoader(): JSX.Element {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-4">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="table" rows={4} />
      </div>
    </div>
  );
}

// ── PrivateRoute guard ────────────────────────────────────────────────────────

interface PrivateRouteProps {
  children: ReactNode;
}

/**
 * Redirects unauthenticated users to /login.
 * Reads auth state from the Zustand store (persisted across page reloads).
 */
function PrivateRoute({ children }: PrivateRouteProps): JSX.Element {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ── Placeholder pages for routes implemented in later sprints ─────────────────

function PlaceholderPage({ title }: { title: string }): JSX.Element {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center space-y-2">
        <p className="text-lg font-semibold text-gray-700">{title}</p>
        <p className="text-sm text-gray-400">Coming soon in a future sprint.</p>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />

            {/* Root → redirect to dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Protected routes */}
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <DashboardPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/clients"
              element={
                <PrivateRoute>
                  <PlaceholderPage title="Clients" />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/alerts"
              element={
                <PrivateRoute>
                  <PlaceholderPage title="Alerts" />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/pipeline"
              element={
                <PrivateRoute>
                  <PlaceholderPage title="Pipeline" />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard/meetings"
              element={
                <PrivateRoute>
                  <PlaceholderPage title="Meetings" />
                </PrivateRoute>
              }
            />

            {/* 404 fallback */}
            <Route
              path="*"
              element={
                <div className="min-h-screen bg-surface flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <p className="text-6xl font-bold text-gray-200">404</p>
                    <p className="text-gray-600 font-medium">Page not found</p>
                    <a
                      href="/dashboard"
                      className="inline-block mt-2 text-sm text-primary hover:underline"
                    >
                      Go to Dashboard
                    </a>
                  </div>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
