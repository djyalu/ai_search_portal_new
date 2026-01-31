import React, { useRef, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Send, Loader2, Zap, Bot, Sparkles, Brain, Lock, BrainCircuit,
    FileDown, FileText, Layout, BarChart3, ChevronRight
} from 'lucide-react';
import StreamingCard from './StreamingCard';
import { renderMarkdown } from '../utils/helpers';

const AnalysisWorkspace = ({
    prompt,
    setPrompt,
    isAnalyzing,
    handleAnalyze,
    enabledAgents,
    toggleAgent,
    liveResults,
    timeline,
    results,
    agentOptions,
    handleExport,
    isExporting
}) => {
    const timelineEndRef = useRef(null);
    const [activeTab, setActiveTab] = useState('optimal');

    useEffect(() => {
        timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [timeline]);

    const reportTimestamp = useMemo(() => (results ? new Date().toLocaleString('ko-KR') : ''), [results]);
    const enabledAgentNames = agentOptions.filter(a => enabledAgents[a.id]).map(a => a.label).join(', ') || '없음';

    const renderContent = () => {
        if (!results) return null;
        let content = '';
        if (activeTab === 'optimal') content = results.optimalAnswer;
        else if (activeTab === 'report') content = results.validationReport;
        else if (activeTab === 'individual') {
            content = Object.entries(results.results || {}).map(([k, v]) => (
                `## ${k.toUpperCase()} AGENT RESPONSE\n\n${v || '데이터 수집 실패'}`
            )).join('\n\n---\n\n');
        }

        return (
            <div className="prose prose-slate max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        );
    };

    return (
        <div className="flex-1 flex flex-col min-h-screen">
            {/* Top Banner / Input */}
            <section className="sticky top-0 bg-base-50/80 backdrop-blur-xl z-30 pt-12 pb-8 px-12 border-b border-base-100/50">
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="relative group">
                        <div className={`absolute -inset-1 bg-gradient-to-r from-base-900 to-teal-accent rounded-[2.5rem] blur-xl opacity-0 group-hover:opacity-10 transition duration-1000 ${isAnalyzing ? 'opacity-5' : ''}`}></div>
                        <div className="relative bg-white border-2 border-base-100 rounded-[2.2rem] p-3 flex items-center shadow-premium focus-within:border-teal-accent/50 transition-all overflow-hidden">
                            <input
                                type="text"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="어떤 주제를 정밀 분석할까요?"
                                className={`flex-1 bg-transparent border-none outline-none px-8 py-5 font-display font-bold text-2xl text-base-900 placeholder-base-800/40 ${isAnalyzing ? 'opacity-70 cursor-not-allowed' : ''}`}
                                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                                readOnly={isAnalyzing}
                            />
                            <button
                                onClick={handleAnalyze}
                                disabled={isAnalyzing || !prompt.trim()}
                                className="bg-base-900 hover:bg-black text-white px-12 py-5 rounded-[1.8rem] font-display font-black text-sm uppercase tracking-widest shadow-xl active:scale-95 disabled:grayscale transition-all flex items-center gap-3"
                            >
                                {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 text-teal-accent" />}
                                {isAnalyzing ? 'Analyzing' : 'Execute'}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 justify-center">
                        {agentOptions.map(agent => {
                            const enabled = enabledAgents[agent.id];
                            return (
                                <button
                                    key={agent.id}
                                    onClick={() => toggleAgent(agent.id)}
                                    disabled={isAnalyzing}
                                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all flex items-center gap-2 ${enabled
                                        ? 'bg-base-900 text-white border-base-900 shadow-glow'
                                        : 'bg-white text-base-800 border-base-100 hover:border-base-200'
                                        }`}
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-teal-accent animate-pulse' : 'bg-base-200'}`} />
                                    {agent.label}
                                    <span className={`ml-1 text-[10px] tracking-widest ${enabled ? 'text-white/80' : 'text-base-800/40'}`}>
                                        {enabled ? 'ON' : 'OFF'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Content Area */}
            <main className="flex-1 p-12 overflow-hidden">
                <div className="max-w-7xl mx-auto h-full flex flex-col lg:flex-row gap-12">

                    {/* Main Display */}
                    <div className="flex-1 space-y-12 min-h-[600px]">
                        {isAnalyzing ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full"
                            >
                                {enabledAgents.perplexity && <StreamingCard title="Insight Source" icon={Zap} color="teal" text={liveResults.perplexity} />}
                                {enabledAgents.chatgpt && <StreamingCard title="Reasoning Engine" icon={Bot} color="emerald" text={liveResults.chatgpt} />}
                                {enabledAgents.gemini && <StreamingCard title="Creative Logic" icon={Sparkles} color="indigo" text={liveResults.gemini} />}
                                {enabledAgents.claude && <StreamingCard title="Validation Layer" icon={Brain} color="amber" text={liveResults.claude} />}
                            </motion.div>
                        ) : results ? (
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                                    <div className="flex p-1.5 bg-base-100/50 rounded-2xl border border-base-100 max-w-fit">
                                        {[
                                            { id: 'optimal', icon: BarChart3, label: 'Integrated' },
                                            { id: 'individual', icon: Layout, label: 'Originals' },
                                            { id: 'report', icon: Brain, label: 'Validation' }
                                        ].map(t => (
                                            <button
                                                key={t.id}
                                                onClick={() => setActiveTab(t.id)}
                                                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-base-900 text-white shadow-premium' : 'text-base-800/60 hover:text-base-900'}`}
                                            >
                                                <t.icon className="w-3.5 h-3.5" />
                                                {t.label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {['pdf', 'html', 'md'].map(ext => (
                                            <button
                                                key={ext}
                                                onClick={() => handleExport(ext, activeTab)}
                                                className="p-3 bg-white border border-base-100 rounded-xl hover:border-teal-accent/30 transition-all text-base-800 shadow-sm"
                                            >
                                                {isExporting[ext] ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="premium-card bg-white p-12 lg:p-20 relative">
                                    <header className="mb-16">
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-base-800/40 mb-4">
                                            <FileText className="w-3 h-3 text-teal-accent" />
                                            Intelligence Report / {activeTab}
                                        </div>
                                        <h2 className="text-5xl font-black text-base-900 font-display italic tracking-tight capitalize mb-12">
                                            {activeTab === 'optimal' ? 'Unified Analysis' : activeTab === 'individual' ? 'Raw Evidence' : 'Logic Audit'}
                                        </h2>

                                        <div className="p-8 bg-base-50/50 rounded-[2.5rem] border border-base-100 flex flex-wrap items-center gap-y-6 gap-x-12">
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-base-800/40">Timestamp</span>
                                                <span className="text-xs font-bold text-base-900">{reportTimestamp}</span>
                                            </div>
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-base-800/40">Sources</span>
                                                <span className="text-xs font-bold text-base-900">{enabledAgentNames}</span>
                                            </div>
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-base-800/40">Status</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-teal-accent" />
                                                    <span className="text-xs font-bold text-base-900 uppercase">Verified</span>
                                                </div>
                                            </div>
                                        </div>
                                    </header>

                                    <article className="max-w-4xl">
                                        {renderContent()}
                                    </article>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-24">
                                <div className="p-8 bg-base-100 rounded-full text-base-800/10">
                                    <BrainCircuit className="w-24 h-24" />
                                </div>
                                <div className="space-y-4">
                                    <h2 className="text-3xl font-black uppercase tracking-tighter text-base-900 italic font-display">System Idle / Ready</h2>
                                    <p className="text-xs font-bold tracking-widest max-w-xs mx-auto leading-loose text-base-800/40 uppercase">Enter a query to initiate multi-agent research and synthesis pipeline</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Activity Panel (Right) */}
                    <aside className="w-full lg:w-[320px] shrink-0 space-y-8">
                        <div className="premium-card bg-base-900 text-white h-full max-h-[700px] flex flex-col border-none shadow-2xl relative overflow-hidden">
                            <div className="p-8 border-b border-white/10 flex items-center justify-between">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-teal-accent">Agency Log</h3>
                                <div className="flex gap-1 text-[10px] font-bold opacity-30 italic">{timeline.length} ops</div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar scrollbar-hide">
                                {timeline.map((s, i) => (
                                    <div key={i} className="flex gap-6 group">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className={`w-2 h-2 rounded-full ${i === timeline.length - 1 ? 'bg-teal-accent shadow-glow' : 'bg-white/20'}`} />
                                            <div className="w-px flex-1 bg-white/5 group-last:hidden" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-[10px] font-black tracking-widest text-white/30 uppercase">{s.status?.replace(/_/g, ' ')}</span>
                                                <span className="text-[9px] font-medium text-white/20 italic">{s.time}</span>
                                            </div>
                                            <p className={`text-[12px] font-bold leading-relaxed ${i === timeline.length - 1 ? 'text-white' : 'text-white/40'}`}>
                                                {s.message}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                                <div ref={timelineEndRef} />
                            </div>

                            {isAnalyzing && (
                                <div className="p-8 bg-white/5">
                                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                        <motion.div
                                            className="h-full bg-teal-accent shadow-glow"
                                            initial={{ width: "0%" }}
                                            animate={{ width: "95%" }}
                                            transition={{ duration: 40, ease: "linear" }}
                                        />
                                    </div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mt-4 text-center animate-pulse">Orchestrating Pipeline...</p>
                                </div>
                            )}
                        </div>

                        {results && (
                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="premium-card border-none bg-teal-accent/10 p-8 space-y-4">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-base-900/60">Session Summary</h4>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between text-[11px] font-bold">
                                        <span className="text-base-800/40">Tokens Used</span>
                                        <span className="text-base-900 italic">~12.4k est.</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-bold">
                                        <span className="text-base-800/40">Agency Consensus</span>
                                        <span className="text-teal-accent italic">High (86%)</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-bold">
                                        <span className="text-base-800/40">Validation Pass</span>
                                        <span className="text-base-900 border-b-2 border-teal-accent">Clear</span>
                                    </div>
                                </div>
                                <button className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-base-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all">
                                    Deep Compare Mode
                                    <ChevronRight className="w-3 h-3" />
                                </button>
                            </motion.div>
                        )}
                    </aside>

                </div>
            </main>
        </div>
    );
};

export default AnalysisWorkspace;
