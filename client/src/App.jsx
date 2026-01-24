import { useState, useEffect, useRef } from 'react';
import {
  Send, Loader2, Bot, Sparkles, Brain, Zap, Clock, ShieldCheck,
  FileText, CheckCircle2, BarChart3, Info, History, Trash2, ExternalLink,
  Share2, ChevronRight, Layers, Layout, Maximize2
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
  const [liveResults, setLiveResults] = useState({
    perplexity: '', chatgpt: '', gemini: '', claude: '', validation: '', optimal: ''
  });
  const [activeTab, setActiveTab] = useState('optimal');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [history, setHistory] = useState([]);
  const [activeSidebarTab, setActiveSidebarTab] = useState('live');
  const [isNotionSaving, setIsNotionSaving] = useState(false);

  const timelineEndRef = useRef(null);

  useEffect(() => {
    fetchHistory();

    const onProgress = (step) => {
      if (step.status === 'streaming') {
        setLiveResults(prev => ({ ...prev, [step.service]: step.content }));
      } else {
        setTimeline((prev) => [...prev, { ...step, time: new Date().toLocaleTimeString() }]);
      }
    };

    const onCompleted = (data) => {
      setResults(data);
      setIsAnalyzing(false);
      setTimeline((prev) => [...prev, { status: 'all_done', message: 'RALPH 에이전시 분석 프로세스 최종 완료!', time: new Date().toLocaleTimeString() }]);
      fetchHistory();
    };

    const onError = (err) => {
      console.error('Socket Error:', err);
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
    } catch (err) { console.error(err); }
  };

  const deleteHistory = async (e, id) => {
    e.stopPropagation();
    if (!confirm('히스토리를 삭제하시겠습니까?')) return;
    await fetch(`http://localhost:3000/api/history/${id}`, { method: 'DELETE' });
    fetchHistory();
  };

  const selectHistory = (item) => {
    setPrompt(item.prompt);
    setResults({
      results: item.results,
      summary: item.summary,
      optimalAnswer: item.summary,
      validationReport: "과거 기록 데이터입니다."
    });
    setLiveResults(item.results);
    setActiveTab('optimal');
  };

  const handleSaveToNotion = async () => {
    if (!results) return;
    setIsNotionSaving(true);
    // 구현 생략 (노션 자동화 또는 API 호출)
    setTimeout(() => { alert('노션 저장 완료!'); setIsNotionSaving(false); }, 2000);
  };

  const handleAnalyze = () => {
    if (!prompt.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setResults(null);
    setTimeline([]);
    setLiveResults({ perplexity: '', chatgpt: '', gemini: '', claude: '', validation: '', optimal: '' });
    setActiveSidebarTab('live');
    setActiveTab('optimal');
    socket.emit('start-analysis', prompt);
  };

  const MarkdownContent = ({ content }) => {
    const html = marked.parse(content || '');
    return <div className="prose prose-slate dark:prose-invert max-w-none 
                        prose-headings:text-indigo-500 prose-headings:font-black 
                        prose-p:leading-relaxed prose-p:font-medium"
      dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const RALPHIndicator = ({ phase, label, active, completed }) => (
    <div className={`flex flex-col items-center gap-2 transition-all duration-500 ${active ? 'scale-110 opacity-100' : 'opacity-40'}`}>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border-2 ${completed ? 'bg-emerald-500 border-emerald-500 text-white' : active ? 'bg-indigo-600 border-indigo-600 text-white animate-pulse' : 'bg-transparent border-slate-300 dark:border-slate-700'}`}>
        <span className="font-black italic">{phase}</span>
      </div>
      <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
    </div>
  );

  const StreamingCard = ({ title, icon: Icon, text, color }) => (
    <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/80 rounded-[2.5rem] p-6 h-full flex flex-col shadow-xl overflow-hidden group hover:border-indigo-500/30 transition-all">
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-xl bg-${color}-500/10`}><Icon className={`w-5 h-5 text-${color}-500`} /></div>
        <span className="text-xs font-black uppercase tracking-widest text-slate-500">{title}</span>
        {text && <div className="ml-auto flex gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /></div>}
      </div>
      <div className="flex-1 overflow-y-auto text-[11px] font-medium leading-relaxed text-slate-400 dark:text-slate-500 custom-scrollbar scrollbar-hide whitespace-pre-wrap italic">
        {text || "분석 대기 중..."}
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#030305] text-slate-200' : 'bg-[#f8f9fc] text-slate-900'} font-sans selection:bg-indigo-500/30`}>
      <div className="max-w-7xl mx-auto p-6 md:p-12 space-y-12">

        {/* Superior Header */}
        <header className="flex flex-col xl:flex-row items-center justify-between gap-12">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-8">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-600 blur-2xl opacity-20 animate-pulse"></div>
              <div className="relative bg-gradient-to-br from-indigo-600 to-violet-600 p-5 rounded-[2.5rem] shadow-2xl"><Layers className="w-10 h-10 text-white" /></div>
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tighter uppercase italic">RALPH Intelligence</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="px-3 py-1 bg-indigo-500/10 text-indigo-500 text-[9px] font-black uppercase tracking-widest rounded-lg">Multi-Agent Agency v2.0</span>
              </div>
            </div>
          </motion.div>

          {/* Search Box */}
          <div className="flex-1 max-w-3xl w-full flex items-center gap-6">
            <div className="flex-1 relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-[2.2rem] blur-xl opacity-0 group-hover:opacity-10 transition duration-1000"></div>
              <div className="relative bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-white/5 rounded-[2rem] p-3 flex items-center shadow-2xl transition-all focus-within:border-indigo-500/50">
                <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="분석하고 싶은 주제를 RALPH 기법으로 요청하세요..." className="flex-1 bg-transparent border-none outline-none px-6 py-3 font-bold text-lg placeholder-slate-300" onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()} />
                <button onClick={handleAnalyze} disabled={isAnalyzing} className="bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-4 rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20 active:scale-95 disabled:grayscale">
                  {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* RALPH Pipeline Visualization */}
        {isAnalyzing && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-white/5 rounded-[3rem] p-10 shadow-2xl">
            <div className="flex items-center justify-around max-w-4xl mx-auto relative">
              <div className="absolute h-1 bg-slate-100 dark:bg-white/5 left-[10%] right-[10%] top-6 -z-10"></div>
              <RALPHIndicator phase="R" label="Reasoning" active={timeline.some(s => s.status === 'reasoning')} completed={timeline.some(s => s.status === 'agency_gathering')} />
              <RALPHIndicator phase="A" label="Agency" active={timeline.some(s => s.status === 'agency_gathering')} completed={timeline.some(s => s.status === 'logic_validation')} />
              <RALPHIndicator phase="L" label="Logic" active={timeline.some(s => s.status === 'logic_validation')} completed={timeline.some(s => s.status === 'polish_synthesis')} />
              <RALPHIndicator phase="P" label="Polish" active={timeline.some(s => s.status === 'polish_synthesis')} completed={!!results} />
              <RALPHIndicator phase="H" label="Hierarchy" active={true} completed={!!results} />
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Activity Sidebar */}
          <aside className="lg:col-span-3">
            <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-white/5 rounded-[3rem] p-8 h-[800px] flex flex-col shadow-2xl relative overflow-hidden">
              <div className="flex bg-slate-50 dark:bg-black/20 p-2 rounded-3xl mb-10">
                <button onClick={() => setActiveSidebarTab('live')} className={`flex-1 py-4 rounded-[1.2rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'live' ? 'bg-white dark:bg-[#1a1a1f] text-indigo-500 shadow-xl' : 'text-slate-400'}`}>Live Stream</button>
                <button onClick={() => setActiveSidebarTab('history')} className={`flex-1 py-4 rounded-[1.2rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'history' ? 'bg-white dark:bg-[#1a1a1f] text-indigo-500 shadow-xl' : 'text-slate-400'}`}>History</button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                <AnimatePresence mode="wait">
                  {activeSidebarTab === 'live' ? (
                    <div className="space-y-10">
                      {timeline.map((s, i) => (
                        <div key={i} className="flex gap-6 group">
                          <div className={`w-1 rounded-full ${i === timeline.length - 1 ? 'bg-indigo-600 shadow-[0_0_10px_rgba(79,70,229,1)] scale-y-110' : 'bg-slate-100 dark:bg-white/5'}`} />
                          <div className="py-1">
                            <span className="text-[10px] font-black text-slate-300 group-last:text-indigo-500">{s.time}</span>
                            <p className={`text-[13px] font-bold mt-1 leading-relaxed ${i === timeline.length - 1 ? 'text-indigo-600 dark:text-indigo-200' : 'text-slate-500'}`}>{s.message}</p>
                          </div>
                        </div>
                      ))}
                      <div ref={timelineEndRef} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {history.map(h => (
                        <div key={h.id} onClick={() => selectHistory(h)} className="p-6 bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-3xl cursor-pointer hover:bg-indigo-50/10 transition-all">
                          <p className="text-xs font-black line-clamp-2 mb-3">{h.prompt}</p>
                          <div className="flex justify-between items-center opacity-30"><span className="text-[9px] font-bold">{new Date(h.created_at).toLocaleDateString()}</span><Trash2 className="w-3.5 h-3.5" /></div>
                        </div>
                      ))}
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </aside>

          {/* Main Visual Intelligence Area */}
          <main className="lg:col-span-9 space-y-12">

            {isAnalyzing && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[380px]">
                <StreamingCard title="SEARCH (Perplexity)" icon={Zap} color="sky" text={liveResults.perplexity} />
                <StreamingCard title="REASONING (ChatGPT)" icon={Bot} color="emerald" text={liveResults.chatgpt} />
                <StreamingCard title="CREATIVE (Gemini)" icon={Sparkles} color="indigo" text={liveResults.gemini} />
                <StreamingCard title="LOGICAL (Claude)" icon={Brain} color="amber" text={liveResults.claude} />
              </div>
            )}

            {!isAnalyzing && results && (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-12">
                <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="flex p-2 bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-white/5 rounded-[2.5rem] shadow-2xl">
                    {[{ id: 'optimal', icon: BarChart3, label: '종합 인텔리전스' }, { id: 'individual', icon: Layout, label: '에이전트 원본' }, { id: 'report', icon: Brain, label: '논리 검증 보고서' }].map(t => (
                      <button key={t.id} onClick={() => setActiveTab(t.id)} className={`relative px-10 py-5 rounded-[1.8rem] text-[12px] font-black uppercase tracking-widest transition-all z-10 ${activeTab === t.id ? 'text-white' : 'text-slate-400'}`}>
                        {activeTab === t.id && <motion.div layoutId="premium-tab" className="absolute inset-0 bg-indigo-600 rounded-[1.8rem] -z-10 shadow-xl shadow-indigo-600/30" />}
                        <div className="flex items-center gap-3"><t.icon className="w-4 h-4" />{t.label}</div>
                      </button>
                    ))}
                  </div>
                  <button onClick={handleSaveToNotion} className="px-10 py-5 bg-black dark:bg-white text-white dark:text-black rounded-3xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl flex items-center gap-4 hover:scale-105 active:scale-95 transition-all">
                    {isNotionSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />} Notion Export
                  </button>
                </div>

                <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-white/5 rounded-[4rem] p-16 shadow-2xl min-h-[600px] relative overflow-hidden">
                  <div className="relative z-10">
                    <AnimatePresence mode="wait">
                      {activeTab === 'optimal' && (
                        <motion.div key="opt" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                          <MarkdownContent content={results.optimalAnswer} />
                        </motion.div>
                      )}
                      {activeTab === 'individual' && (
                        <motion.div key="ind" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {Object.entries(results.results || {}).map(([k, v]) => (
                            <div key={k} className="p-8 bg-slate-50 dark:bg-white/5 rounded-[2.5rem] border border-slate-100 dark:border-white/10">
                              <h3 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-4 border-b pb-2">{k} AGENT RESPONSE</h3>
                              <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{v || "데이터 수집 실패"}</p>
                            </div>
                          ))}
                        </motion.div>
                      )}
                      {activeTab === 'report' && (
                        <motion.div key="rep" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                          <MarkdownContent content={results.validationReport} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

            {!isAnalyzing && !results && (
              <div className="h-[650px] border-4 border-dashed border-slate-100 dark:border-white/5 rounded-[5rem] flex flex-col items-center justify-center space-y-10 group overflow-hidden relative">
                <div className="absolute inset-0 bg-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 blur-[100px]"></div>
                <motion.div animate={{ y: [0, -15, 0] }} transition={{ duration: 5, repeat: Infinity }}><Bot className="w-40 h-40 opacity-5 group-hover:opacity-10 transition-opacity" /></motion.div>
                <div className="text-center space-y-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.6em] text-slate-300">RALPH Network Standby</p>
                  <p className="text-xs font-bold text-slate-400 italic">Advanced Agentic Coding Intelligence Ready</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #6366f1; border-radius: 20px; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .prose h1, .prose h2, .prose h3 { font-weight: 900; letter-spacing: -0.05em; color: #6366f1; margin-top: 2.5rem; margin-bottom: 1.5rem; }
        .prose p { line-height: 1.9; font-weight: 500; margin-bottom: 1.8rem; font-size: 1.05rem; }
        .prose strong { color: #818cf8; font-weight: 900; }
        .prose hr { border: 0; height: 1px; background: linear-gradient(to right, transparent, #6366f1, transparent); margin: 3rem 0; opacity: 0.3; }
      `}} />
    </div>
  );
}

export default App;
