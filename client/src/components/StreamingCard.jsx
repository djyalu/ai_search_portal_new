import React from 'react';

const StreamingCard = ({ title, icon: Icon, text, color }) => {
    const colorMap = {
        teal: { bg: 'bg-teal-500/5', text: 'text-teal-accent', border: 'border-teal-accent/20' },
        emerald: { bg: 'bg-emerald-500/5', text: 'text-emerald-400', border: 'border-emerald-400/20' },
        indigo: { bg: 'bg-indigo-500/5', text: 'text-indigo-400', border: 'border-indigo-400/20' },
        amber: { bg: 'bg-amber-500/5', text: 'text-amber-400', border: 'border-amber-400/20' }
    };

    const theme = colorMap[color] || colorMap.teal;

    return (
        <div className={`flex flex-col h-full premium-card bg-white hover:border-teal-accent/20 transition-all duration-500 group`}>
            <div className="flex items-center gap-4 mb-6">
                <div className={`p-2.5 rounded-xl ${theme.bg} ${theme.text}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-base-800/60">{title}</h4>
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-base-800/40 uppercase tracking-widest">Processing Live Stream</span>
                        {text && <div className="w-1 h-1 bg-teal-accent rounded-full animate-ping" />}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto text-[13px] font-medium leading-[1.8] text-base-900 custom-scrollbar scrollbar-hide whitespace-pre-wrap italic selection:bg-teal-accent/20">
                {text || (
                    <div className="flex flex-col gap-3 opacity-20">
                        <div className="h-3 bg-base-100 rounded-full w-3/4 animate-pulse" />
                        <div className="h-3 bg-base-100 rounded-full w-1/2 animate-pulse" />
                        <div className="h-3 bg-base-100 rounded-full w-2/3 animate-pulse" />
                    </div>
                )}
            </div>
        </div>
    );
};

export default StreamingCard;
