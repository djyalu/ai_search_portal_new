import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send, Loader2, Bot, Sparkles, Brain, Zap, Clock, ShieldCheck, Lock,
  FileText, FileDown, CheckCircle2, BarChart3, Info, History, Trash2, ExternalLink,
  Share2, ChevronRight, Layers, Layout, Maximize2
} from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const socket = io(API_BASE);
const DOMPURIFY_CONFIG = {
  ADD_TAGS: ['img', 'figure', 'figcaption'],
  ADD_ATTR: ['src', 'alt', 'title', 'width', 'height', 'loading']
};
const sanitizeHtml = (html) => DOMPurify.sanitize(html, DOMPURIFY_CONFIG);

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
  const [filterLogs, setFilterLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('optimal');
  const [theme] = useState('light');
  const [history, setHistory] = useState([]);
  const [activeSidebarTab, setActiveSidebarTab] = useState('live');
  const [isExporting, setIsExporting] = useState({ pdf: false, html: false, md: false });

  const timelineEndRef = useRef(null);
  const toastTimerRef = useRef(null);
  const filterTimersRef = useRef({});
  const idCounterRef = useRef(0);
  const enabledAgentsRef = useRef(enabledAgents);

  useEffect(() => {
    fetchHistory();

    const onProgress = (step) => {
      if (step.status === 'streaming') {
        const enabledList = Object.keys(enabledAgentsRef.current || {}).filter(k => enabledAgentsRef.current[k]);
        const allowed = ['validation', 'optimal', ...enabledList];
        if (allowed.includes(step.service)) {
          setLiveResults(prev => ({ ...prev, [step.service]: step.content }));
        } else {
          console.warn('Ignored streaming for unknown service:', step.service);
          addFilterLog(`스트리밍 무시됨: ${step.service}`, 4000);
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
      Object.values(filterTimersRef.current).forEach(t => clearTimeout(t));
      filterTimersRef.current = {};
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  useEffect(() => {
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.remove('dark');
  }, [theme]);

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
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ message, visible: true });
    toastTimerRef.current = setTimeout(() => {
      setToast({ message: '', visible: false });
      toastTimerRef.current = null;
    }, duration);
  };

  const addFilterLog = (text, duration = 4000) => {
    let id;
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') id = crypto.randomUUID();
      else throw new Error('no-crypto-uuid');
    } catch (e) {
      idCounterRef.current += 1;
      id = `id-${Date.now()}-${idCounterRef.current}`;
    }
    setFilterLogs(prev => [...prev, { id, text }]);
    const t = setTimeout(() => {
      setFilterLogs(prev => prev.filter(p => p.id !== id));
      delete filterTimersRef.current[id];
    }, duration);
    filterTimersRef.current[id] = t;
    return id;
  };

  const toggleAgent = (id) => {
    setEnabledAgents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const agentOptions = [
    { id: 'perplexity', label: 'Perplexity', on: 'bg-teal-700 text-white border-teal-700', off: 'bg-white text-teal-700 border-teal-200', dot: 'bg-teal-500' },
    { id: 'chatgpt', label: 'ChatGPT', on: 'bg-emerald-700 text-white border-emerald-700', off: 'bg-white text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    { id: 'gemini', label: 'Gemini', on: 'bg-amber-700 text-white border-amber-700', off: 'bg-white text-amber-700 border-amber-200', dot: 'bg-amber-500' },
    { id: 'claude', label: 'Claude', on: 'bg-violet-700 text-white border-violet-700', off: 'bg-white text-violet-700 border-violet-200', dot: 'bg-violet-500' }
  ];

  const enabledAgentNames = agentOptions.filter(a => enabledAgents[a.id]).map(a => a.label).join(', ') || '없음';
  const reportTimestamp = useMemo(() => (results ? new Date().toLocaleString('ko-KR') : ''), [results]);

  const slugify = (text) => String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-가-힣]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const renderMarkdown = (content) => {
    const renderer = new marked.Renderer();
    renderer.heading = (text, level) => {
      const id = slugify(text);
      return `<h${level} id="${id}">${text}</h${level}>`;
    };
    return sanitizeHtml(marked.parse(content || '', { renderer }));
  };

  const reportInsights = useMemo(() => {
    if (!results?.optimalAnswer) return { summary: '', bullets: [] };
    const tokens = marked.lexer(results.optimalAnswer || '');
    const firstParagraph = tokens.find(t => t.type === 'paragraph');
    const firstList = tokens.find(t => t.type === 'list');
    return {
      summary: firstParagraph?.text || '',
      bullets: (firstList?.items || []).slice(0, 3).map(i => i.text)
    };
  }, [results?.optimalAnswer]);

  const selectHistory = (item) => {
    if (isAnalyzing) {
      showToast('분석 중에는 히스토리 선택이 잠겨 있습니다.', 3000);
      return;
    }
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

  const deleteHistory = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('기록을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/history/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast('기록이 삭제되었습니다.');
        fetchHistory();
      }
    } catch (err) { console.error(err); }
  };

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getActiveExport = () => {
    if (!results) return { label: 'report', content: '' };
    if (activeTab === 'report') {
      return { label: 'validation', content: results.validationReport || '' };
    }
    if (activeTab === 'individual') {
      const parts = Object.entries(results.results || {}).map(([k, v]) => (
        `## ${k} AGENT RESPONSE\n\n${v || '데이터 수집 실패'}`
      ));
      return { label: 'agents', content: parts.join('\n\n') };
    }
    return { label: 'report', content: results.optimalAnswer || '' };
  };

  const buildExportBaseName = (label) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    return `multi-agent-${label || 'report'}-${stamp}`;
  };

  const buildExportHtml = (markdown) => {
    const rawHtml = marked.parse(markdown || '');
    const html = sanitizeHtml(rawHtml);
    const metaRows = [
      `생성 시각: ${escapeHtml(reportTimestamp || '')}`,
      `활성 에이전트: ${escapeHtml(enabledAgentNames || '')}`,
      prompt ? `질문: ${escapeHtml(prompt)}` : null
    ].filter(Boolean);
    return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Multi Agent Analysis</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: "IBM Plex Sans KR", "Noto Sans KR", "Apple SD Gothic Neo", "Segoe UI", sans-serif; background: #fffdf9; color: #1f2a44; }
      main { max-width: 980px; margin: 0 auto; padding: 48px 36px 64px; }
      .meta { background: #f4eee6; border: 1px solid #e6e0d8; border-radius: 18px; padding: 18px 20px; margin-bottom: 28px; }
      .meta .brand { font-weight: 900; letter-spacing: 0.08em; font-size: 12px; text-transform: uppercase; color: #6b635c; margin-bottom: 8px; }
      .meta .row { font-size: 12px; color: #6b635c; margin: 4px 0; }
      h1, h2, h3 { font-weight: 900; letter-spacing: -0.03em; color: #1f2a44; margin-bottom: 0.5em; }
      h1 { font-size: 28px; margin-bottom: 1em; }
      h2 { font-size: 20px; border-bottom: 1px solid #e6e0d8; padding-bottom: 8px; margin-top: 48px; }
      h3 { font-size: 16px; margin-top: 32px; }
      p { line-height: 1.8; font-weight: 500; color: #1f2a44; font-size: 14px; margin: 1em 0; }
      strong { color: #b48a3c; font-weight: 900; }
      hr { border: 0; height: 1px; background: #e6e0d8; margin: 48px 0; }
      table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px; border: 1px solid #e6e0d8; border-radius: 12px; overflow: hidden; }
      th, td { border: 1px solid #e6e0d8; padding: 12px 14px; vertical-align: top; }
      th { background: #f4eee6; text-align: left; font-weight: 900; color: #1f2a44; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
      td { color: #1f2a44; font-weight: 500; line-height: 1.6; }
      tr:nth-child(even) { background: #fcfbf9; }
      code { background: #f4eee6; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
      pre { background: #f4eee6; padding: 16px; border-radius: 14px; overflow-x: auto; font-size: 13px; }
      .meta .brand { font-weight: 900; letter-spacing: 0.08em; font-size: 12px; text-transform: uppercase; color: #b48a3c; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <main>
      <section class="meta">
        <div class="brand">Multi Agent Analysis</div>
        ${metaRows.map(row => `<div class="row">${row}</div>`).join('')}
      </section>
      <article>${html}</article>
    </main>
  </body>
</html>`;
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

  const handleExport = async (type) => {
    if (!results) return;
    const { label, content } = getActiveExport();
    if (!content || !content.trim()) {
      showToast('내보낼 내용이 없습니다.', 3000);
      return;
    }
    const base = buildExportBaseName(label);
    setIsExporting(prev => ({ ...prev, [type]: true }));
    try {
      if (type === 'md') {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        downloadBlob(blob, `${base}.md`);
      } else if (type === 'html') {
        const html = buildExportHtml(content);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        downloadBlob(blob, `${base}.html`);
      } else if (type === 'pdf') {
        const html = buildExportHtml(content);
        const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/export/pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, filename: `${base}.pdf` })
        });
        if (!res.ok) throw new Error('PDF export failed');
        const blob = await res.blob();
        downloadBlob(blob, `${base}.pdf`);
      }
    } catch (err) {
      console.error(err);
      showToast('내보내기 중 오류가 발생했습니다.', 3000);
    } finally {
      setIsExporting(prev => ({ ...prev, [type]: false }));
    }
  };

  const handleAnalyze = () => {
    if (!prompt.trim() || isAnalyzing) return;
    const hasEnabled = Object.values(enabledAgents).some(Boolean);
    if (!hasEnabled) {
      showToast('분석 전에 최소 1개 에이전트를 켜주세요.', 3000);
      return;
    }
    setIsAnalyzing(true);
    setResults(null);
    setTimeline([]);
    setLiveResults({ perplexity: '', chatgpt: '', gemini: '', claude: '', validation: '', optimal: '' });
    setActiveSidebarTab('live');
    setActiveTab('optimal');
    socket.emit('start-analysis', { prompt, enabledAgents });
  };

  const MarkdownContent = ({ content }) => {
    const rawHtml = marked.parse(content || '');
    const html = sanitizeHtml(rawHtml);
    return <div className="prose max-w-none 
              prose-headings:text-[#1f2a44] prose-headings:font-black 
              prose-p:leading-normal prose-p:font-medium text-[#1f2a44] pt-8 border-t border-[#e6e0d8]/50"
      dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const ReportMeta = ({ title, timestamp, agents, summary }) => (
    <div className="report-meta-block mb-10 p-8 bg-[#f4eee6]/30 border border-[#e6e0d8] rounded-[2rem]">
      <h2 className="text-[26px] font-black text-[#1f2a44] mb-4">{title}</h2>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-[#8a8178] font-bold uppercase tracking-wider mb-6 border-b border-[#e6e0d8] pb-6">
        <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-[#b48a3c]" /> <span>생성: {timestamp}</span></div>
        <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-[#b48a3c]" /> <span>에이전트: {agents}</span></div>
      </div>
      {summary && (
        <div className="flex gap-4 items-start">
          <div className="mt-1.5 w-2.5 h-2.5 rounded-full bg-[#b48a3c] shrink-0 shadow-[0_0_8px_rgba(180,138,60,0.4)]" />
          <p className="text-[14px] font-bold text-[#1f2a44] leading-normal italic">{summary}</p>
        </div>
      )}
    </div>
  );

  const ProcessIndicator = ({ phase, label, active, completed }) => (
    <div className={`flex flex-col items-center gap-3 transition-all duration-700 ${active || completed ? 'opacity-100 scale-100' : 'opacity-30 scale-90'}`}>
      <div
        style={{ borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px' }}
        className={`w-12 h-12 flex items-center justify-center border-2 text-lg font-black italic transition-all duration-500 shadow-xl ${completed ? 'bg-white text-[#1a1a1a] border-white' :
          active ? 'bg-transparent border-white text-white animate-pulse' :
            'bg-transparent border-white/20 text-white/40'
          }`}
      >
        {phase}
      </div>
      <span className={`text-[9px] font-black uppercase tracking-widest ${active || completed ? 'text-white' : 'text-white/30'}`}>{label}</span>
    </div>
  );

  const StreamingCard = ({ title, icon: Icon, text, color, status }) => (
    <div className={`bg-[#fffdf9] border-2 rounded-[2.5rem] p-6 h-full flex flex-col shadow-xl overflow-hidden group transition-all duration-500 ${status === 'error' ? 'border-red-200 bg-red-50/10' :
      status === 'active' ? 'border-[#b48a3c] shadow-[#b48a3c]/10' : 'border-[#e6e0d8]'
      }`}>
      <div className="flex items-center gap-3 mb-4">
        {(() => {
          const colorMap = {
            sky: { bg: 'bg-sky-500/10', text: 'text-sky-500' },
            emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
            indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-500' },
            amber: { bg: 'bg-amber-500/10', text: 'text-amber-500' }
          };
          const classes = colorMap[color] || { bg: 'bg-slate-100', text: 'text-slate-500' };
          return <div className={`p-2 rounded-xl ${classes.bg}`}><Icon className={`w-5 h-5 ${classes.text}`} /></div>;
        })()}
        <div className="flex flex-col">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#1f2a44]">{title}</span>
          <span className={`text-[8px] font-bold uppercase tracking-tight ${status === 'active' ? 'text-emerald-600 animate-pulse' :
            status === 'error' ? 'text-red-500' : 'text-[#8a8178]'
            }`}>
            {status === 'active' ? '● 분석 중' : status === 'error' ? '● 에러' : '● 대기 중'}
          </span>
        </div>
        {status === 'active' && (
          <div className="ml-auto">
            <Loader2 className="w-4 h-4 text-[#b48a3c] animate-spin" />
          </div>
        )}
      </div>
      <div className={`flex-1 overflow-y-auto text-[11px] font-medium leading-[1.5] custom-scrollbar scrollbar-hide whitespace-pre-wrap italic ${status === 'error' ? 'text-red-600' : 'text-[#1f2a44]'
        }`}>
        {text || (status === 'active' ? "데이터 스트리밍 중..." : "분석 대기 중...")}
      </div>
    </div>
  );

  const ExportButton = ({ type, label, icon: Icon }) => (
    <button
      onClick={() => handleExport(type)}
      disabled={isExporting[type] || !results}
      className={`px-4 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest shadow-lg flex items-center gap-2.5 transition-all ${isExporting[type] ? 'bg-[#b48a3c] text-white' : 'bg-[#f4eee6] text-[#1f2a44] hover:bg-[#ebe2d8] hover:translate-y-[-1px]'
        } ${!results ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {isExporting[type] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="portal-shell selection:bg-[#b48a3c]/30 selection:text-white">
      <div className="portal-frame">
        {/* Superior Black Header */}
        <div className="black-header-card">
          <header className="flex flex-col xl:flex-row items-center justify-between gap-8">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-10">
              <div className="relative">
                <div className="absolute inset-0 bg-white/5 blur-[80px] rounded-full"></div>
                <div className="relative group transition-transform duration-700 hover:scale-110">
                  <img
                    src="/logo.png"
                    className="w-20 h-20 object-contain mix-blend-lighten opacity-90 group-hover:opacity-100 transition-all"
                    alt="Logo"
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <h1 className="text-3xl font-black tracking-tighter uppercase italic text-white leading-none">멀티 에이전트 분석</h1>
                <div className="flex items-center gap-3 mt-3">
                  <div className="h-[2px] w-6 bg-white/20" />
                  <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/40">Premium Intelligence Studio</span>
                </div>
              </div>
            </motion.div>

            {/* Search Box */}
            <div className="flex-1 max-w-xl w-full flex flex-col gap-3">
              <div className="search-input-container">
                <div className="flex items-center gap-3 flex-1 px-3">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="질문을 입력하세요..."
                    className={`flex-1 bg-transparent border-none outline-none py-3 font-bold text-base placeholder-white/20 text-white ${isAnalyzing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                    readOnly={isAnalyzing}
                  />
                  {isAnalyzing && (
                    <div className="flex items-center gap-2 text-white/30 pointer-events-none pr-3">
                      <Lock className="w-3.5 h-3.5" />
                      <span className="text-[8px] font-black uppercase tracking-widest">분석 중</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  style={{ borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px' }}
                  className="bg-white text-[#1a1a1a] px-8 py-3.5 border-2 border-white font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 disabled:grayscale"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 px-2">
                {agentOptions.map(agent => {
                  const enabled = enabledAgents[agent.id];
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      disabled={isAnalyzing}
                      style={{ borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px' }}
                      className={`px-3 py-1 text-[9px] font-black uppercase tracking-[0.1em] border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${enabled ? 'bg-white/10 border-white text-white shadow-lg' : 'bg-transparent border-white/20 text-white/20'}`}
                    >
                      <span>{agent.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notification/Filter logs */}
            <div className="fixed sm:absolute top-2 sm:top-6 right-2 sm:right-6 flex flex-col items-end gap-2 pointer-events-none z-50">
              {filterLogs.map(f => (
                <div key={f.id} className="bg-[#fff2d9] text-[#8a5b10] px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-xl border border-[#fee4b3] pointer-events-auto">{f.text}</div>
              ))}
              {toast.visible && (
                <div className="bg-[#b48a3c] text-white px-6 py-3 rounded-2xl shadow-2xl text-xs font-black uppercase tracking-widest pointer-events-auto animate-bounce">{toast.message}</div>
              )}
            </div>
          </header>

          {/* Integrated Process Flow */}
          <AnimatePresence>
            {isAnalyzing && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="process-bar-container overflow-hidden"
              >
                <div className="process-track" />
                <ProcessIndicator phase="A" label="분석" active={timeline.some(s => s.status === 'reasoning')} completed={timeline.some(s => s.status === 'agency_gathering')} />
                <ProcessIndicator phase="C" label="수집" active={timeline.some(s => s.status === 'agency_gathering')} completed={timeline.some(s => s.status === 'logic_validation')} />
                <ProcessIndicator phase="V" label="검증" active={timeline.some(s => s.status === 'logic_validation')} completed={timeline.some(s => s.status === 'polish_synthesis')} />
                <ProcessIndicator phase="S" label="정리" active={timeline.some(s => s.status === 'polish_synthesis')} completed={!!results} />
                <ProcessIndicator phase="M" label="관리" active={true} completed={!!results} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="portal-content-wrap">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Activity Sidebar */}
            <aside className="lg:col-span-3">
              <div className="bg-[#fffdf9] border-2 border-[#e6e0d8] rounded-[3rem] p-8 h-[680px] flex flex-col shadow-2xl relative overflow-hidden">
                <div className="flex bg-[#f4eee6] p-2 rounded-3xl mb-10">
                  <button onClick={() => setActiveSidebarTab('live')} className={`flex-1 py-4 rounded-[1.2rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'live' ? 'bg-[#fffdf9] text-[#1f2a44] shadow-xl' : 'text-[#8a8178]'}`}>실시간</button>
                  <button onClick={() => setActiveSidebarTab('history')} className={`flex-1 py-4 rounded-[1.2rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarTab === 'history' ? 'bg-[#fffdf9] text-[#1f2a44] shadow-xl' : 'text-[#8a8178]'}`}>기록</button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                  <AnimatePresence mode="wait">
                    {activeSidebarTab === 'live' ? (
                      <div className="space-y-10">
                        {timeline.map((s, i) => (
                          <div key={i} className="flex gap-6 group">
                            <div className={`w-1 rounded-full ${i === timeline.length - 1 ? 'bg-[#1f2a44] shadow-[0_0_10px_rgba(31,42,68,0.8)] scale-y-110' : 'bg-[#e6e0d8]'}`} />
                            <div className="py-1">
                              <span className="text-[10px] font-black text-[#1f2a44]/70 group-last:text-[#1f2a44]">{s.time}</span>
                              <p className={`text-[13px] font-bold mt-1 leading-relaxed ${i === timeline.length - 1 ? 'text-[#1f2a44]' : 'text-[#4b433d]'}`}>{s.message}</p>
                            </div>
                          </div>
                        ))}
                        <div ref={timelineEndRef} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {history.map(h => (
                          <div key={h.id} onClick={() => selectHistory(h)} className="p-6 bg-[#f5f2ed] border border-[#e6e0d8] rounded-3xl cursor-pointer hover:bg-[#e6e0d8] transition-all">
                            <p className="text-xs font-black line-clamp-2 mb-3 text-[#1f2a44]">{h.prompt}</p>
                            <div className="flex justify-between items-center text-[#4b433d] opacity-60"><span className="text-[9px] font-bold">{new Date(h.created_at).toLocaleDateString()}</span><Trash2 className="w-3.5 h-3.5 hover:text-red-500 transition-colors" onClick={(e) => deleteHistory(e, h.id)} /></div>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[680px]">
                  {enabledAgents.perplexity && (
                    <StreamingCard
                      title="검색 (Perplexity)"
                      icon={Zap}
                      color="sky"
                      text={liveResults.perplexity}
                      status={liveResults.perplexity.includes('에러') ? 'error' : liveResults.perplexity ? 'active' : 'active'}
                    />
                  )}
                  {enabledAgents.chatgpt && (
                    <StreamingCard
                      title="추론 (ChatGPT)"
                      icon={Bot}
                      color="emerald"
                      text={liveResults.chatgpt}
                      status={liveResults.chatgpt.includes('에러') ? 'error' : liveResults.chatgpt ? 'active' : 'active'}
                    />
                  )}
                  {enabledAgents.gemini && (
                    <StreamingCard
                      title="창의 (Gemini)"
                      icon={Sparkles}
                      color="indigo"
                      text={liveResults.gemini}
                      status={liveResults.gemini.includes('에러') || liveResults.gemini.includes('signed out') ? 'error' : liveResults.gemini ? 'active' : 'active'}
                    />
                  )}
                  {enabledAgents.claude && (
                    <StreamingCard
                      title="검증 (Claude)"
                      icon={Brain}
                      color="amber"
                      text={liveResults.claude}
                      status={liveResults.claude.includes('에러') ? 'error' : liveResults.claude ? 'active' : 'active'}
                    />
                  )}
                </div>
              )}

              {!isAnalyzing && results && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-12">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="flex p-2 bg-[#fffdf9] border-2 border-[#e6e0d8] rounded-[2.5rem] shadow-2xl">
                      {[{ id: 'optimal', icon: BarChart3, label: '종합 인텔리전스' }, { id: 'individual', icon: Layout, label: '에이전트 원본' }, { id: 'report', icon: Brain, label: '논리 검증 보고서' }].map(t => (
                        <button key={t.id} onClick={() => setActiveTab(t.id)} className={`relative px-10 py-5 rounded-[1.8rem] text-[12px] font-black uppercase tracking-widest transition-all z-10 ${activeTab === t.id ? 'text-white' : 'text-[#4b433d]'}`}>
                          {activeTab === t.id && <motion.div layoutId="premium-tab" className="absolute inset-0 bg-[#1f2a44] rounded-[1.8rem] -z-10 shadow-xl shadow-[#1f2a44]/30" />}
                          <div className="flex items-center gap-3"><t.icon className="w-3.5 h-3.5" />{t.label}</div>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center justify-end">
                      <ExportButton type="pdf" label="PDF" icon={FileText} />
                      <ExportButton type="html" label="HTML" icon={Layout} />
                      <ExportButton type="md" label="MARKDOWN" icon={FileDown} />
                    </div>
                  </div>

                  <div className="bg-[#fffdf9] border-2 border-[#e6e0d8] rounded-[4rem] p-16 shadow-2xl min-h-[600px] relative overflow-hidden">
                    {/* Trust Seal */}
                    <div className="absolute top-10 right-10 z-20 pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity">
                      <div className="flex flex-col items-center rotate-12 border-4 border-[#b48a3c] p-4 rounded-[2rem]">
                        <ShieldCheck className="w-12 h-12 text-[#b48a3c]" />
                        <span className="text-[10px] font-black text-[#b48a3c] tracking-tighter mt-1">INTELLIGENCE VERIFIED</span>
                      </div>
                    </div>

                    <div className="relative z-10">
                      <AnimatePresence mode="wait">
                        {activeTab === 'optimal' && (
                          <motion.div key="opt" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                            <ReportMeta
                              title="종합 인텔리전스 보고서"
                              timestamp={reportTimestamp}
                              agents={enabledAgentNames}
                              summary={reportInsights.summary}
                            />
                            <MarkdownContent content={results.optimalAnswer} />
                          </motion.div>
                        )}
                        {activeTab === 'individual' && (
                          <motion.div key="ind" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {Object.entries(results.results || {}).map(([k, v]) => (
                              <div key={k} className="p-10 bg-[#fffdf9] border border-[#e6e0d8] rounded-[2.5rem] shadow-sm">
                                <h3 className="text-[11px] font-black text-[#1f2a44] uppercase tracking-[0.2em] mb-6 border-b border-[#e6e0d8] pb-3 flex items-center justify-between">
                                  <span>{k.toUpperCase()} 에이전트 응답</span>
                                  <div className="w-2 h-2 rounded-full bg-[#b48a3c]" />
                                </h3>
                                <p className="text-[15px] leading-relaxed text-[#1f2a44] whitespace-pre-wrap font-medium">{v || "데이터 수집 실패"}</p>
                              </div>
                            ))}
                          </motion.div>
                        )}
                        {activeTab === 'report' && (
                          <motion.div key="rep" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                            <ReportMeta
                              title="논리 검증 보고서"
                              timestamp={reportTimestamp}
                              agents={enabledAgentNames}
                            />
                            <MarkdownContent content={results.validationReport} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              )}

              {!isAnalyzing && !results && (
                <div className="h-[650px] border-4 border-dashed border-[#e6e0d8] rounded-[5rem] flex flex-col items-center justify-center space-y-10 group overflow-hidden relative">
                  <div className="absolute inset-0 bg-[#b48a3c]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 blur-[100px]"></div>
                  <motion.div animate={{ y: [0, -20, 0] }} transition={{ duration: 6, repeat: Infinity }}><Bot className="w-48 h-48 opacity-40 group-hover:opacity-60 transition-all text-[#1f2a44]" /></motion.div>
                  <div className="text-center space-y-6">
                    <p className="text-[13px] font-black uppercase tracking-[0.8em] text-[#1f2a44]">멀티 에이전트 분석 대기 중</p>
                    <p className="text-sm font-bold text-[#4b433d] italic opacity-80">고정밀 분석 준비 완료 · 에이전트를 선택하고 질문을 시작하세요</p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div >
  );
}

export default App;
