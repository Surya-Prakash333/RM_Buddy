import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { appEnv } from '@/config/env';
import axios from 'axios';

interface RmOption {
  rm_id: string;
  rm_name: string;
  role: string;
  branch: string;
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login, isLoading } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [rmOptions, setRmOptions] = useState<RmOption[]>([]);
  const [loadingRms, setLoadingRms] = useState(true);
  const [selectedRmId, setSelectedRmId] = useState<string>('');

  const apiUrl = import.meta.env.VITE_API_URL ?? '';

  // Fetch RM list from DB on mount
  useEffect(() => {
    axios
      .get<{ status: string; data: RmOption[] }>(`${apiUrl}/api/v1/rm/list`)
      .then((res) => {
        const rms = res.data?.data ?? [];
        setRmOptions(rms);
        if (rms.length > 0) setSelectedRmId(rms[0].rm_id);
      })
      .catch(() => {
        // fallback: empty list, user sees error
        setError('Could not load RM list from server. Is core-api running?');
      })
      .finally(() => setLoadingRms(false));
  }, [apiUrl]);

  // Map rm_id to mock token format expected by auth-service
  function rmIdToMockToken(rmId: string): string {
    return `MOCK_${rmId}`;
  }

  async function handleMockLogin(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!selectedRmId) return;

    try {
      await login(rmIdToMockToken(selectedRmId));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    }
  }

  function handleSSOLogin(): void {
    setError('SSO integration is not yet configured. Use the dev login below during development.');
  }

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mb-4">
            <span className="text-white text-2xl font-bold">RM</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">RM Buddy</h1>
          <p className="text-white/60 text-sm mt-1">Nuvama Wealth Management</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Welcome back</h2>
            <p className="text-sm text-gray-500 mt-1">Sign in to access your client dashboard</p>
          </div>

          {error && (
            <div className="flex items-start gap-3 p-3 bg-danger/5 border border-danger/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {/* Production SSO */}
          <button
            type="button"
            onClick={handleSSOLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-primary text-white rounded-lg px-4 py-3 font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Login with Nuvama SSO
          </button>

          {/* Dev mock login */}
          {appEnv.isDev && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-gray-400 uppercase tracking-wide">
                    Development only
                  </span>
                </div>
              </div>

              <form onSubmit={handleMockLogin} className="space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600 mb-1.5 block">
                    Select mock user
                  </span>
                  <div className="relative">
                    {loadingRms ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading RMs from database…
                      </div>
                    ) : (
                      <select
                        value={selectedRmId}
                        onChange={(e) => setSelectedRmId(e.target.value)}
                        disabled={isLoading || rmOptions.length === 0}
                        className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60"
                      >
                        {rmOptions.map((rm) => (
                          <option key={rm.rm_id} value={rm.rm_id}>
                            {rm.rm_name} ({rm.role} · {rm.branch})
                          </option>
                        ))}
                      </select>
                    )}
                    {!loadingRms && <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />}
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={isLoading || loadingRms || rmOptions.length === 0}
                  className="w-full bg-secondary text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-secondary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Signing in…' : 'Sign in as mock user'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-white/40 text-xs mt-6">
          For authorised Nuvama personnel only
        </p>
      </div>
    </div>
  );
}
