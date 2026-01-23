import { useState, useEffect, useRef } from 'react';
import {
  Send, Loader2, Bot, Sparkles, Brain, Zap, Clock, ShieldCheck,
  FileText, CheckCircle2, BarChart3, Info, History, Trash2, ExternalLink,
  Share2, ChevronRight
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
      setTimeline((prev) => [...prev, { status: 'all_done', message: '에이전시 기반 상호검증 분석 완료!', time: new Date().toLocaleTimeString() }]);
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
      if (data.success) { alert('노션 저장 완료!'); window.open(data.url, '_blank'); }
    } catch (err) { alert(err.message); }
    setIsNotionSaving(false);
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
    return <div className="prose prose-slate dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const StreamingBox = ({ title, icon: Icon, text, color }) => (
    <div className={`bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/50 rounded-[2rem] p-6 h-full flex flex-col transition-all shadow-xl`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-xl bg-${color}-500/10`}><Icon className={`w-5 h-5 text-${color}-500`} /></div>
        <span className="text-xs font-black uppercase tracking-widest text-slate-500">{title}</span>
        {text && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-auto" />}
      </div>
      <div className="text-[12px] text-slate-500 dark:text-slate-400 overflow-y-auto custom-scrollbar font-medium whitespace-pre-wrap flex-1 scrollbar-hide">
        {text || <span className="opacity-20 italic">에이전트 대기 중...</span>}
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#050507] text-slate-200' : 'bg-[#fcfdfe] text-slate-900'} font-sans overflow-x-hidden`}>
      <div className="max-w-7xl mx-auto p-4 md:p-10 space-y-12">

        {/* Header */}
        <header className="flex flex-col xl:flex-row items-center justify-between gap-10">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-6">
            <div className="bg-indigo-600 p-4 rounded-3xl shadow-2xl shadow-indigo-600/40"><Bot className="w-8 h-8 text-white" /></div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter uppercase">AI Search Agency</h1>
              <p className="text-[10px] text-indigo-500 font-bold tracking-[0.4em] uppercase opacity-60">Parallel Intelligence Orchestrator</p>
            </div>
          </motion.div>

          <div className="flex-1 max-w-2xl w-full flex items-center gap-4">
            <div className="flex-1 bg-white dark:bg-[#0d0d10] rounded-[1.5rem] border-2 border-slate-100 dark:border-slate-800 p-2 flex items-center shadow-xl">
              <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="질문을 입력하세요..." className="flex-1 bg-transparent border-none outline-none px-4 py-2 font-bold" onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()} />
              <button onClick={handleAnalyze} disabled={isAnalyzing} className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase hover:bg-indigo-500 transition-all disabled:opacity-30">
                {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-4 bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800 rounded-2xl shadow-xl">
              {theme === 'dark' ? <Zap className="w-5 h-5 text-amber-500" /> : <Clock className="w-5 h-5 text-indigo-500" />}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left: Streaming Status */}
          <aside className="lg:col-span-3 space-y-6">
            <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800/50 rounded-[2.5rem] p-6 h-[750px] flex flex-col shadow-2xl">
              <div className="flex gap-2 mb-6 p-1 bg-slate-50 dark:bg-black/20 rounded-2xl">
                <button onClick={() => setActiveSidebarTab('live')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeSidebarTab === 'live' ? 'bg-white dark:bg-[#1a1a1f] text-indigo-500 shadow-md' : 'text-slate-400'}`}>Live</button>
                <button onClick={() => setActiveSidebarTab('history')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeSidebarTab === 'history' ? 'bg-white dark:bg-[#1a1a1f] text-indigo-500 shadow-md' : 'text-slate-400'}`}>History</button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
                {activeSidebarTab === 'live' ? (
                  <div className="space-y-6">
                    {timeline.map((s, i) => (
                      <div key={i} className="flex gap-4 group">
                        <div className="w-1 bg-indigo-500/20 rounded-full group-last:bg-indigo-500" />
                        <div className="py-1">
                          <p className="text-[11px] font-bold text-slate-400">{s.time}</p>
                          <p className={`text-[12px] font-bold ${i === timeline.length - 1 ? 'text-indigo-500' : 'text-slate-500'}`}>{s.message}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={timelineEndRef} />
                  </div>
                ) : (
                  history.map(h => (
                    <div key={h.id} onClick={() => selectHistory(h)} className="p-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl cursor-pointer hover:border-indigo-500/30 group">
                      <p className="text-xs font-bold line-clamp-2">{h.prompt}</p>
                      <div className="flex justify-between items-center mt-2 opacity-40">
                        <span className="text-[9px] font-black uppercase">{new Date(h.created_at).toLocaleDateString()}</span>
                        <Trash2 className="w-3 h-3 hover:text-rose-500" onClick={(e) => deleteHistory(e, h.id)} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          {/* Right: Main Content & Streaming Boxes */}
          <main className="lg:col-span-9 space-y-10">
            {isAnalyzing && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[400px]">
                <StreamingBox title="Perplexity" icon={Zap} color="sky" text={liveResults.perplexity} />
                <StreamingBox title="ChatGPT" icon={Bot} color="emerald" text={liveResults.chatgpt} />
                <StreamingBox title="Gemini" icon={Sparkles} color="indigo" text={liveResults.gemini} />
                <StreamingBox title="Claude" icon={Brain} color="amber" text={liveResults.claude} />
              </div>
            )}

            {!isAnalyzing && results && (
              <div className="space-y-10">
                <div className="flex bg-white dark:bg-[#0d0d10] p-2 rounded-3xl border-2 border-slate-100 dark:border-slate-800 shadow-xl w-fit">
                  {[{ id: 'optimal', label: '인텔리전스 요약' }, { id: 'individual', label: '에이전트 답변' }, { id: 'report', label: '검증 리포트' }].map(t => (
                    <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-8 py-4 rounded-2xl text-xs font-black uppercase transition-all ${activeTab === t.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}>{t.label}</button>
                  ))}
                  <button onClick={handleSaveToNotion} className="ml-4 px-6 py-4 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all">
                    {isNotionSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />} Save to Notion
                  </button>
                </div>

                <div className="bg-white dark:bg-[#0d0d10] border-2 border-slate-100 dark:border-slate-800 rounded-[3rem] p-12 shadow-2xl min-h-[500px]">
                  {activeTab === 'optimal' && <MarkdownContent content={results.optimalAnswer} />}
                  {activeTab === 'individual' && (
                    <div className="grid grid-cols-2 gap-6">
                      {Object.entries(results.results || {}).map(([k, v]) => (
                        <div key={k} className="p-6 bg-slate-50 dark:bg-white/5 rounded-3xl border border-slate-100 dark:border-white/5">
                          <h3 className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-4">{k}</h3>
                          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeTab === 'report' && <MarkdownContent content={results.validationReport} />}
                </div>
              </div>
            )}

            {!isAnalyzing && !results && (
              <div className="h-[600px] border-4 border-dashed border-slate-100 dark:border-slate-900 rounded-[4rem] flex flex-col items-center justify-center text-slate-200 dark:text-slate-800">
                <Bot className="w-32 h-32 opacity-10 mb-8" />
                <p className="text-xs font-black uppercase tracking-[0.5em] opacity-30">Ready for Analysis</p>
              </div>
            )}
          </main>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #4f46e5; border-radius: 20px; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .prose h2 { font-weight: 900; color: #4f46e5; margin-top: 2rem; border-left: 5px solid; padding-left: 1rem; }
        .prose p { margin-bottom: 1.5rem; line-height: 1.7; font-weight: 500; }
      `}} />
    </div>
  );
}

export default App;
