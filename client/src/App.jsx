import { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';

// New Components
import Sidebar from './components/Sidebar';
import AnalysisWorkspace from './components/AnalysisWorkspace';
import History from './components/History';

// Utils
import { buildExportHtml } from './utils/helpers';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const socket = io(API_BASE);

function App() {
  const [prompt, setPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [results, setResults] = useState(null);
  const [liveResults, setLiveResults] = useState({
    perplexity: '', chatgpt: '', gemini: '', claude: '', validation: '', optimal: ''
  });
  const [enabledAgents, setEnabledAgents] = useState({
    perplexity: true,
    chatgpt: true,
    gemini: true,
    claude: true
  });
  const [toast, setToast] = useState({ message: '', visible: false });
  const [history, setHistory] = useState([]);
  const [activeNavTab, setActiveNavTab] = useState('new');
  const [isExporting, setIsExporting] = useState({ pdf: false, html: false, md: false });

  const toastTimerRef = useRef(null);
  const enabledAgentsRef = useRef(enabledAgents);

  useEffect(() => {
    fetchHistory();

    const onProgress = (step) => {
      if (step.status === 'streaming') {
        const enabledList = Object.keys(enabledAgentsRef.current || {}).filter(k => enabledAgentsRef.current[k]);
        const allowed = ['validation', 'optimal', ...enabledList];
        if (allowed.includes(step.service)) {
          setLiveResults(prev => ({ ...prev, [step.service]: step.content }));
        }
      } else {
        setTimeline((prev) => [...prev, { ...step, time: new Date().toLocaleTimeString() }]);
      }
    };

    const onCompleted = (data) => {
      setResults(data);
      setIsAnalyzing(false);
      setTimeline((prev) => [...prev, { status: 'all_done', message: 'Multi Agent Analysis 완료.', time: new Date().toLocaleTimeString() }]);
      fetchHistory();
    };

    const onError = (err) => {
      console.error('Socket Error:', err);
      setIsAnalyzing(false);
    };

    socket.on('progress', onProgress);
    socket.on('completed', onCompleted);
    socket.on('analysis-error', (err) => {
      console.error('Analysis Error:', err);
      setTimeline((prev) => [...prev, { status: 'analysis_error', message: err?.message || err, time: new Date().toLocaleTimeString() }]);
      setIsAnalyzing(false);
    });
    socket.on('error', onError);

    return () => {
      socket.off('progress', onProgress);
      socket.off('completed', onCompleted);
      socket.off('error', onError);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    enabledAgentsRef.current = enabledAgents;
  }, [enabledAgents]);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/history`);
      const data = await res.json();
      setHistory(data);
    } catch (err) { console.error(err); }
  };

  const showToast = (message, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, visible: true });
    toastTimerRef.current = setTimeout(() => setToast({ message: '', visible: false }), duration);
  };

  const handleAnalyze = () => {
    if (!prompt.trim() || isAnalyzing) return;
    const hasEnabled = Object.values(enabledAgents).some(Boolean);
    if (!hasEnabled) {
      showToast('분석 전에 최소 1개 에이전트를 켜주세요.');
      return;
    }
    setIsAnalyzing(true);
    setResults(null);
    setTimeline([]);
    setLiveResults({ perplexity: '', chatgpt: '', gemini: '', claude: '', validation: '', optimal: '' });
    socket.emit('start-analysis', { prompt, enabledAgents });
  };

  const toggleAgent = (id) => {
    if (isAnalyzing) return;
    setEnabledAgents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExport = async (type, activeResultTab) => {
    if (!results) return;

    let content = '';
    if (activeResultTab === 'optimal') content = results.optimalAnswer;
    else if (activeResultTab === 'report') content = results.validationReport;
    else if (activeResultTab === 'individual') {
      content = Object.entries(results.results || {}).map(([k, v]) => (
        `## ${k.toUpperCase()} AGENT RESPONSE\n\n${v || '\uD615\uC2DD \uB370\uC774\uD130 \uB204\uB77D'}`
      )).join('\n\n---\n\n');
    }

    if (!content || !content.trim()) {
      showToast('내보낼 내용이 없습니다.');
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `signal-report-${activeResultTab}-${stamp}`;

    setIsExporting(prev => ({ ...prev, [type]: true }));
    try {
      if (type === 'md') {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        downloadBlob(blob, `${filename}.md`);
      } else if (type === 'html') {
        const meta = {
          timestamp: new Date().toLocaleString('ko-KR'),
          agents: Object.keys(enabledAgents).filter(k => enabledAgents[k]).join(', '),
          prompt: prompt
        };
        const htmlContent = buildExportHtml(content, meta);
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        downloadBlob(blob, `${filename}.html`);
      } else if (type === 'pdf') {
        const meta = {
          timestamp: new Date().toLocaleString('ko-KR'),
          agents: Object.keys(enabledAgents).filter(k => enabledAgents[k]).join(', '),
          prompt: prompt
        };
        const html = buildExportHtml(content, meta);
        const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/export/pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, filename: `${filename}.pdf` })
        });
        if (!res.ok) throw new Error('PDF export failed');
        const blob = await res.blob();
        downloadBlob(blob, `${filename}.pdf`);
      }
      showToast(`${type.toUpperCase()} 내보내기 성공!`);
    } catch (err) {
      console.error(err);
      showToast('내보내기 중 오류가 발생했습니다.');
    } finally {
      setIsExporting(prev => ({ ...prev, [type]: false }));
    }
  };

  const deleteHistory = async (id) => {
    if (!confirm('히스토리를 삭제하시겠습니까?')) return;
    try {
      await fetch(`${API_BASE.replace(/\/$/, '')}/api/history/${id}`, { method: 'DELETE' });
      showToast('기록이 삭제되었습니다.');
      fetchHistory();
    } catch (err) { console.error(err); }
  };

  const selectHistory = (item) => {
    if (isAnalyzing) {
      showToast('분석 중에는 히스토리 선택이 블록됩니다.');
      return;
    }
    setPrompt(item.prompt);
    setResults({
      results: item.results,
      summary: item.summary,
      optimalAnswer: item.summary,
      validationReport: "과거 기록 데이터입니다. (검증 보고서 미포함)"
    });
    setLiveResults(item.results);
    setActiveNavTab('new');
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const agentOptions = [
    { id: 'perplexity', label: 'Perplexity' },
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'gemini', label: 'Gemini' },
    { id: 'claude', label: 'Claude' }
  ];

  return (
    <div className="flex min-h-screen bg-base-50 selection:bg-teal-accent/30 font-sans overflow-x-hidden">
      <Sidebar activeTab={activeNavTab} onTabChange={setActiveNavTab} />

      <div className="flex-1 ml-[260px]">
        <AnimatePresence mode="wait">
          {activeNavTab === 'new' && (
            <motion.div
              key="new-analysis"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="min-h-screen flex flex-col"
            >
              <AnalysisWorkspace
                prompt={prompt}
                setPrompt={setPrompt}
                isAnalyzing={isAnalyzing}
                handleAnalyze={handleAnalyze}
                enabledAgents={enabledAgents}
                toggleAgent={toggleAgent}
                liveResults={liveResults}
                timeline={timeline}
                results={results}
                agentOptions={agentOptions}
                handleExport={handleExport}
                isExporting={isExporting}
              />
            </motion.div>
          )}

          {activeNavTab === 'history' && (
            <motion.div
              key="history-module"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <History
                history={history}
                onSelect={selectHistory}
                onDelete={deleteHistory}
              />
            </motion.div>
          )}

          {!['new', 'history'].includes(activeNavTab) && (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center min-h-screen space-y-8"
            >
              <div className="p-12 bg-base-900 rounded-[3rem] shadow-premium rotate-3 hover:rotate-0 transition-transform duration-500">
                <div className="flex items-center gap-4 text-white font-display font-black text-6xl uppercase italic tracking-tighter">
                  Signal<span className="text-teal-accent">Lab</span>
                </div>
              </div>
              <p className="font-display font-black text-xs uppercase tracking-[0.5em] text-base-800/20 italic">
                {activeNavTab} Module Under Construction
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Global Toast */}
      {toast.visible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="fixed bottom-12 right-12 bg-base-900 border border-white/10 text-white px-10 py-5 rounded-[2rem] shadow-premium z-50 font-display font-black text-xs uppercase tracking-widest italic flex items-center gap-4"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-pulse shadow-glow" />
          {toast.message}
        </motion.div>
      )}
    </div>
  );
}

export default App;
