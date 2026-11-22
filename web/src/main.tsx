import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import './styles.css';
import { qc } from './lib/data';
import { api } from './lib/api';
import { Shell } from './components/Shell';
import { AcceptInvite, Login, Setup } from './pages/Auth';
import type { Me } from './types';
import { initPwa } from './lib/pwa';

initPwa();

const Dashboard = lazy(() => import('./pages/Dashboard'));
const MyWork = lazy(() => import('./pages/MyWork'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace'));
const Members = lazy(() => import('./pages/Members'));
const MemberProfile = lazy(() => import('./pages/MemberProfile'));
const Research = lazy(() => import('./pages/Research'));
const PaperReader = lazy(() => import('./pages/PaperReader'));
const Competitions = lazy(() => import('./pages/Competitions'));
const Equipment = lazy(() => import('./pages/Equipment'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Chat = lazy(() => import('./pages/Chat'));
const Code = lazy(() => import('./pages/Code'));
const RepoView = lazy(() => import('./pages/RepoView'));
const Settings = lazy(() => import('./pages/Settings'));
const Submissions = lazy(() => import('./pages/Submissions'));

// Apply the last theme before React renders, so there is no flash.
try {
  const t = localStorage.getItem('aether-theme');
  if (t) document.documentElement.dataset.theme = t;
} catch {
  /* storage blocked */
}

function RequireAuth() {
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), retry: false });
  useEffect(() => {
    const out = () => {
      qc.clear();
      nav('/login', { replace: true });
    };
    window.addEventListener('aether:signed-out', out);
    return () => window.removeEventListener('aether:signed-out', out);
  }, [nav]);
  useEffect(() => {
    if (me.error) {
      api
        .get<{ setupNeeded: boolean }>('/api/auth/state')
        .then((s) => nav(s.setupNeeded ? '/setup' : '/login', { replace: true }))
        .catch(() => nav('/login', { replace: true }));
    }
  }, [me.error, nav]);
  useEffect(() => {
    // Start loading the workspace-wide collections in parallel as soon as we know who you are.
    if (me.data) api.get('/api/auth/state').then((s) => qc.setQueryData(['auth-state'], s));
  }, [me.data]);
  if (me.isLoading)
    return (
      <div className="row center" style={{ height: '100%' }}>
        <span className="spin" />
      </div>
    );
  if (!me.data) return null;
  return <Shell />;
}

const Loading = () => (
  <div className="page">
    <div className="skeleton" style={{ height: 28, width: 260, marginBottom: 24 }} />
    <div className="skeleton" style={{ height: 120 }} />
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/invite/:token" element={<AcceptInvite kind="invite" />} />
            <Route path="/reset/:token" element={<AcceptInvite kind="reset" />} />
            <Route element={<RequireAuth />}>
              <Route index element={<Dashboard />} />
              <Route path="my-work" element={<MyWork />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="submissions" element={<Submissions />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:key/*" element={<ProjectWorkspace />} />
              <Route path="members" element={<Members />} />
              <Route path="members/skills" element={<Members matrix />} />
              <Route path="members/:id" element={<MemberProfile />} />
              <Route path="research" element={<Research />} />
              <Route path="research/:id" element={<PaperReader />} />
              <Route path="competitions" element={<Competitions />} />
              <Route path="equipment" element={<Equipment />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="chat" element={<Chat />} />
              <Route path="chat/:channelId" element={<Chat />} />
              <Route path="code" element={<Code />} />
              <Route path="code/:owner/:repo/*" element={<RepoView />} />
              <Route path="settings" element={<Navigate to="/settings/profile" replace />} />
              <Route path="settings/:section" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
