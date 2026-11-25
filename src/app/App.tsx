import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import Home from '../screens/Home';
import { ToastHost } from '../components/Toast';

const Import = lazy(() => import('../screens/Import'));
const Processing = lazy(() => import('../screens/Processing'));
const SplitReview = lazy(() => import('../screens/SplitReview'));
const CompareSetup = lazy(() => import('../screens/CompareSetup'));
const ComparePlay = lazy(() => import('../screens/ComparePlay'));
const Result = lazy(() => import('../screens/Result'));
const Settings = lazy(() => import('../screens/Settings'));
const Guide = lazy(() => import('../screens/Guide'));
const History = lazy(() => import('../screens/History'));
const Poc = lazy(() => import('../screens/Poc'));
const Install = lazy(() => import('../screens/Install'));

export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<div className="p-8 text-center text-slate-500">불러오는 중…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/import" element={<Import />} />
          <Route path="/processing" element={<Processing />} />
          <Route path="/review" element={<SplitReview />} />
          <Route path="/s/:id/setup" element={<CompareSetup />} />
          <Route path="/s/:id/play/:roundId" element={<ComparePlay />} />
          <Route path="/s/:id/result" element={<Result />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/history" element={<History />} />
          <Route path="/poc" element={<Poc />} />
          <Route path="/install" element={<Install />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </HashRouter>
  );
}
