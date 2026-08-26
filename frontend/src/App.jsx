import { useState, useCallback } from 'react';
import SummaryCard from './components/SummaryCard';
import CaseTable from './components/CaseTable';
import CaseDetailTrace from './components/CaseDetailTrace';
import ApprovalQueue from './components/ApprovalQueue';
import BatchRunProgress from './components/BatchRunProgress';

export default function App() {
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [tab, setTab] = useState('cases');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Background decorative pattern */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-50">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_20%_50%,rgba(59,130,246,0.05)_0%,transparent_50%),radial-gradient(circle_at_80%_80%,rgba(139,92,246,0.05)_0%,transparent_50%)]" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
            <div className="flex items-center justify-between h-20">
              {/* Logo */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white shadow-lg shadow-slate-200 flex items-center justify-center p-2 border border-slate-100">
                  <img src="/favicon.svg" alt="RevivePay Logo" className="w-full h-full object-contain" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">RevivePay</h1>
                  <p className="text-xs text-slate-500 hidden sm:block">AI Recovery Desk for Payments</p>
                </div>
              </div>

              {/* Navigation */}
              <nav className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl">
                <button
                  onClick={() => setTab('cases')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    tab === 'cases'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cases
                </button>
                <button
                  onClick={() => setTab('approvals')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    tab === 'approvals'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Approvals
                </button>
              </nav>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-8 space-y-6">
          <SummaryCard refreshKey={refreshKey} />
          <BatchRunProgress onComplete={refresh} />
          
          {tab === 'cases' ? (
            <CaseTable onSelectCase={setSelectedCaseId} refreshKey={refreshKey} />
          ) : (
            <ApprovalQueue refreshKey={refreshKey} onRefresh={refresh} />
          )}
        </main>
      </div>

      {/* Detail Panel */}
      <CaseDetailTrace caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} />
    </div>
  );
}
