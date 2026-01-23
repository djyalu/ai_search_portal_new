import { useState, useEffect, useRef } from 'react';
import {
  Send, Loader2, Bot, Sparkles, Brain, Zap, Clock, ShieldCheck,
  FileText, CheckCircle2, BarChart3, Info, History, Trash2, ExternalLink,
  Share2
} from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { marked } from 'marked';

const socket = io('http://localhost:3000');

function App() {
  const [prompt, setPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('optimal');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [history, setHistory] = useState([]);
  const [activeSidebarTab, setActiveSidebarTab] = useState('live'); // 'live' or 'history'
  const [isNotionSaving, setIsNotionSaving] = useState(false);

  const timelineEndRef = useRef(null);

  useEffect(() => {
    fetchHistory();

    const onProgress = (step) => {
      setTimeline((prev) => [...prev, { ...step, time: new Date().toLocaleTimeString() }]);
    };

    const onCompleted = (data) => {
      setResults(data);
      setIsAnalyzing(false);
      setTimeline((prev) => [...prev, { status: 'all_done', message: '에이전시 기반 상호검증 분석 완료!', time: new Date().toLocaleTimeString() }]);
      fetchHistory(); // Refresh history
    };

    const onError = (err) => {
      console.error('Socket Error:', err);
      // alert는 사용자 경험을 해칠 수 있으므로 콘솔 로그 위주로 남김
      setIsAnalyzing(false);
    };

    socket.on('progress', onProgress);
    socket.on('completed', onCompleted);
    socket.on('error', onError);

    return () => {
      socket.off('progress', onProgress);
      socket.off('completed', onCompleted);
      socket.off('error', onError);
    };
  }, []);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const deleteHistory = async (e, id) => {
    e.stopPropagation();
    if (!confirm('히스토리를 삭제하시겠습니까?')) return;
    try {
      await fetch(`http://localhost:3000/api/history/${id}`, { method: 'DELETE' });
      fetchHistory();
    } catch (err) {
      console.error('Failed to delete history:', err);
    }
  };

  const selectHistory = (item) => {
    setPrompt(item.prompt);
    setResults({
      results: item.results,
      summary: item.summary,
      optimalAnswer: item.summary,
      validationReport: "히스토리에서 불러온 데이터입니다.",
      heroImage: null
    });
    setActiveTab('optimal');
    setTimeline([]);
  };

  const handleSaveToNotion = async () => {
    if (!results) return;
    setIsNotionSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/notion/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          summary: results.summary || results.optimalAnswer,
          results: results.results
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('노션에 성공적으로 저장되었습니다!');
        window.open(data.url, '_blank');
      } else {
        alert('저장 실패: ' + data.error);
      }
    } catch (err) {
      alert('오류 발생: ' + err.message);
    } finally {
      setIsNotionSaving(false);
    }
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const handleAnalyze = () => {
    if (!prompt.trim() || isAnalyzing) return;

    setIsAnalyzing(true);
    setResults(null);
    setTimeline([]);
    setActiveSidebarTab('live');
    setActiveTab('optimal');
    socket.emit('start-analysis', prompt);
  };

  const ServiceSmallCard = ({ title, icon: Icon, text, color }) => (
    <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/50 rounded-[2rem] p-6 h-full overflow-hidden flex flex-col hover:border-indigo-500/30 transition-all duration-300 shadow-xl shadow-black/5 dark:shadow-none">
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-xl bg-${color}-500/10`}>
          <Icon className={`w-5 h-5 text-${color}-600 dark:text-${color}-400`} />
        </div>
        <span className="text-sm font-black tracking-tight text-slate-700 dark:text-slate-200 uppercase">{title}</span>
      </div>
      <div className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap flex-1 overflow-y-auto custom-scrollbar font-medium">
        {text}
      </div>
    </div>
  );

  const MarkdownContent = ({ content }) => {
    const html = marked.parse(content || '');
    return (
      <div
        className="prose prose-slate dark:prose-invert prose-indigo max-w-none 
                   prose-headings:text-indigo-600 dark:prose-headings:text-indigo-400 prose-headings:font-black 
                   prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-p:leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };

  return (
    <div className={`min-h-screen transition-all duration-700 ease-in-out ${theme === 'dark' ? 'bg-[#050507] text-slate-200' : 'bg-[#fcfdfe] text-slate-900'} font-sans selection:bg-indigo-500/30 overflow-x-hidden`}>
      <div className="max-w-7xl mx-auto p-4 md:p-10 space-y-12">

        <header className="flex flex-col xl:flex-row items-center justify-between gap-10">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-6">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-[2rem] blur-xl opacity-30 group-hover:opacity-60 transition duration-500"></div>
              <div className="relative bg-[#0a0a0c] p-0.5 rounded-[1.8rem] overflow-hidden border border-white/10 shadow-2xl">
                <img src="/favicon.png" alt="Logo" className="w-16 h-16 object-cover scale-110 group-hover:scale-125 transition-transform duration-700" />
              </div>
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tighter bg-gradient-to-r from-indigo-600 via-violet-500 to-purple-600 dark:from-indigo-400 dark:via-violet-400 dark:to-purple-400 bg-clip-text text-transparent">Multi-Agent Hub</h1>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span></div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-[0.3em] font-black opacity-70">Unified Intelligence Orchestrator</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex-1 max-w-3xl w-full flex items-center gap-5">
            <div className="flex-1 relative group">
              <div className={`absolute -inset-1 bg-gradient-to-r from-indigo-500 to-violet-600 rounded-[2rem] blur-2xl opacity-0 group-hover:opacity-20 transition duration-1000 ${isAnalyzing ? 'opacity-30' : ''}`}></div>
              <div className={`relative flex items-center bg-white dark:bg-[#0d0d10] rounded-[1.8rem] border-2 ${theme === 'dark' ? 'border-slate-800 focus-within:border-indigo-500/50' : 'border-slate-100 focus-within:border-indigo-400'} p-2.5 shadow-2xl transition-all duration-500 ring-1 ring-black/5`}>
                <div className="pl-5 text-indigo-500"><Sparkles className="w-6 h-6 animate-pulse" /></div>
                <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="분석할 대상을 입력하세요..." className="flex-1 bg-transparent border-none outline-none px-5 py-3 text-lg placeholder-slate-300 dark:placeholder-slate-800 text-slate-900 dark:text-slate-100 font-bold" onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()} disabled={isAnalyzing} />
                <button onClick={handleAnalyze} disabled={isAnalyzing} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white pl-8 pr-10 py-4 rounded-[1.4rem] font-black transition-all flex items-center gap-4 active:scale-95 disabled:grayscale disabled:opacity-50 shadow-xl shadow-indigo-600/30">
                  {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                  <span className="text-xs uppercase tracking-widest">{isAnalyzing ? 'Running' : 'Analyze'}</span>
                </button>
              </div>
            </div>
            <button onClick={toggleTheme} className={`p-5 rounded-[1.6rem] transition-all duration-500 shadow-2xl border-2 ${theme === 'dark' ? 'bg-[#0d0d10] border-slate-800 text-slate-400 hover:text-indigo-400' : 'bg-white border-slate-100 text-slate-500 hover:text-amber-500 shadow-black/5'}`}>
              {theme === 'dark' ? <Zap className="w-7 h-7" /> : <Clock className="w-7 h-7" />}
            </button>
          </motion.div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 pt-4">
          <aside className="lg:col-span-3">
            <div className={`bg-white dark:bg-[#0d0d10] border-2 ${theme === 'dark' ? 'border-slate-800/50' : 'border-slate-100'} rounded-[3rem] p-8 h-[800px] flex flex-col shadow-2xl relative overflow-hidden transition-all duration-700 shadow-black/5`}>
              <div className="flex bg-slate-50 dark:bg-black/20 p-1.5 rounded-[1.5rem] mb-8">
                <button onClick={() => setActiveSidebarTab('live')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-[1rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'live' ? 'bg-white dark:bg-[#1a1a1f] text-indigo-500 shadow-lg' : 'text-slate-400'}`}><Clock className="w-3.5 h-3.5" />Live</button>
                <button onClick={() => setActiveSidebarTab('history')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-[1rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'history' ? 'bg-white dark:bg-[#1a1a1f] text-indigo-500 shadow-lg' : 'text-slate-400'}`}><History className="w-3.5 h-3.5" />History</button>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <AnimatePresence mode="wait">
                  {activeSidebarTab === 'live' ? (
                    <motion.div key="live" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-10">
                      <div className="relative pl-3">
                        <div className="absolute left-[11.5px] top-4 bottom-0 w-1.5 bg-slate-100 dark:bg-slate-900 rounded-full"></div>
                        {timeline.map((step, idx) => (
                          <div key={idx} className="relative pl-12 pb-12 last:pb-2 group">
                            <div className={`absolute left-0 top-1 w-6 h-6 rounded-full border-4 transition-all duration-500 z-10 ${idx === timeline.length - 1 ? 'bg-indigo-500 border-white dark:border-[#0d0d10] shadow-[0_0_25px_rgba(99,102,241,1)] scale-125' : 'bg-slate-200 dark:bg-slate-800 border-white dark:border-[#0d0d10]'}`}></div>
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] font-black font-mono text-slate-400 tracking-widest uppercase">{step.time}</span>
                              <p className={`text-[13px] font-bold leading-relaxed ${idx === timeline.length - 1 ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500'}`}>{step.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div ref={timelineEndRef} />
                    </motion.div>
                  ) : (
                    <motion.div key="history" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
                      {history.map((item) => (
                        <div key={item.id} onClick={() => selectHistory(item)} className="bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-[1.5rem] p-5 cursor-pointer hover:border-indigo-500/30 transition-all hover:bg-indigo-50/10 group relative">
                          <p className="text-[12px] font-black text-slate-700 dark:text-slate-200 mb-2 line-clamp-2 pr-6">{item.prompt}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(item.created_at).toLocaleDateString()}</span>
                            <button onClick={(e) => deleteHistory(e, item.id)} className="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-rose-500 transition-all"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </aside>

          <main className="lg:col-span-9 space-y-12">
            {results && (
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex flex-wrap gap-4 p-2 bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/50 rounded-[2.2rem] shadow-xl">
                  {[{ id: 'optimal', icon: BarChart3, label: '최적 인텔리전스' }, { id: 'individual', icon: FileText, label: '개별 에이전트' }, { id: 'report', icon: Brain, label: '상호검증 분석' }].map((tab) => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`relative flex items-center gap-4 px-8 py-4 rounded-[1.6rem] text-[13px] font-black transition-all z-10 ${activeTab === tab.id ? 'text-white' : 'text-slate-400'}`}>
                      {activeTab === tab.id && <motion.div layoutId="premium-active-tab" className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 shadow-lg rounded-[1.6rem] -z-10" />}
                      <tab.icon className={`w-4.5 h-4.5 ${activeTab === tab.id ? 'scale-110' : ''}`} /><span className="tracking-tight uppercase">{tab.label}</span>
                    </button>
                  ))}
                </div>
                <button onClick={handleSaveToNotion} disabled={isNotionSaving} className="flex items-center gap-4 px-8 py-5 bg-[#000000] dark:bg-white text-white dark:text-black rounded-[1.8rem] font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50">
                  {isNotionSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  {isNotionSaving ? 'Saving...' : 'Save to Notion'}
                </button>
              </div>
            )}

            <div className="min-h-[750px] flex flex-col">
              <AnimatePresence mode="wait">
                {isAnalyzing && (
                  <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} className="flex flex-col items-center justify-center flex-1 space-y-20 py-40 bg-white dark:bg-[#0d0d10] rounded-[4rem] border-2 border-slate-100 dark:border-slate-800/50 shadow-2xl relative overflow-hidden">
                    <div className="relative w-64 h-64 bg-white dark:bg-[#050507] rounded-full border-4 border-indigo-500/30 flex items-center justify-center shadow-2xl overflow-hidden">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute inset-4 border-2 border-dashed border-indigo-500/20 rounded-full" />
                      <Bot className="w-24 h-24 text-indigo-500 animate-pulse" />
                    </div>
                    <div className="text-center space-y-8 max-w-2xl px-12 relative z-10"><h3 className="text-5xl font-black text-slate-800 dark:text-white tracking-tighter uppercase leading-tight">Orchestrating <span className="text-indigo-600 underline decoration-indigo-200 underline-offset-8">Intelligence</span></h3><p className="text-slate-400 dark:text-slate-500 text-lg font-bold">에이전트들이 병렬 모드에서 답변을 생성 중입니다.</p></div>
                  </motion.div>
                )}
                {!isAnalyzing && results && (
                  <motion.div key={activeTab} initial={{ opacity: 0, scale: 0.99, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.8 }} className="w-full flex-1">
                    {activeTab === 'optimal' && <div className="space-y-12"><div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/50 rounded-[4rem] p-16 shadow-2xl relative overflow-hidden transition-all duration-700"><div className="relative z-10"><MarkdownContent content={results.optimalAnswer} /></div></div></div>}
                    {activeTab === 'individual' && <div className="grid grid-cols-1 md:grid-cols-2 gap-10 h-full"><ServiceSmallCard title="Perplexity" icon={Zap} color="sky" text={results.results?.perplexity} /><ServiceSmallCard title="ChatGPT" icon={Bot} color="emerald" text={results.results?.chatgpt} /><ServiceSmallCard title="Gemini" icon={Sparkles} color="indigo" text={results.results?.gemini} /><ServiceSmallCard title="Claude" icon={Brain} color="amber" text={results.results?.claude} /></div>}
                    {activeTab === 'report' && <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/50 rounded-[4rem] p-20 space-y-16 shadow-2xl"><MarkdownContent content={results.validationReport} /></div>}
                  </motion.div>
                )}
                {!isAnalyzing && !results && <div className="flex flex-col items-center justify-center flex-1 py-32 border-4 border-dashed border-slate-100 dark:border-slate-900 rounded-[5rem] bg-white dark:bg-black/5 shadow-inner group relative overflow-hidden"><motion.div animate={{ y: [0, -20, 0] }} transition={{ duration: 6, repeat: Infinity }} className="relative z-10"><Bot className="w-32 h-32 opacity-[0.1] mb-8 text-slate-900 dark:text-white" /></motion.div><p className="text-xs font-black tracking-[0.5em] text-slate-300 uppercase">Neural Hub Idle</p></div>}
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&family=JetBrains+Mono:wght@500;800&display=swap');body { font-family: 'Montserrat', sans-serif; letter-spacing: -0.02em; }.font-mono { font-family: 'JetBrains Mono', monospace !important; }.custom-scrollbar::-webkit-scrollbar { width: 4px; }.custom-scrollbar::-webkit-scrollbar-thumb { background: ${theme === 'dark' ? '#1e1e24' : '#e2e8f0'}; border-radius: 20px; }.prose { font-size: 1.1rem; }.prose h2 { font-weight: 900; letter-spacing: -0.06em; margin-top: 3rem; border-left: 6px solid #4f46e5; padding-left: 1.5rem; }.prose p { margin-bottom: 2rem; line-height: 1.8; font-weight: 500; }.prose strong { color: #6366f1; font-weight: 800; }` }} />
    </div>
  );
}

export default App;
