import React from 'react';
import {
    PlusCircle,
    BarChart3,
    History as HistoryIcon,
    Settings,
    Database,
    Share2,
    BrainCircuit
} from 'lucide-react';

const Sidebar = ({ activeTab, onTabChange }) => {
    const menuItems = [
        { id: 'new', label: 'New Analysis', icon: PlusCircle },
        { id: 'compare', label: 'Compare', icon: BarChart3 },
        { id: 'history', label: 'History', icon: HistoryIcon },
        { id: 'notion', label: 'Exports', icon: Database },
        { id: 'settings', label: 'Settings', icon: Settings },
    ];

    return (
        <aside className="w-[260px] h-screen fixed left-0 top-0 bg-base-50 border-r border-base-100 flex flex-col p-6 z-40">
            <div className="flex items-center gap-3 mb-12 px-2">
                <div className="bg-base-900 p-2.5 rounded-2xl shadow-premium">
                    <BrainCircuit className="w-7 h-7 text-teal-accent" />
                </div>
                <span className="font-display font-black text-xl tracking-tighter italic text-base-900">
                    SIGNAL<span className="text-teal-accent text-xs not-italic ml-1">LAB</span>
                </span>
            </div>

            <nav className="flex-1 space-y-2">
                {menuItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onTabChange(item.id)}
                        className={`w-full sidebar-nav-item ${activeTab === item.id ? 'active' : ''}`}
                    >
                        <item.icon className="w-5 h-5" />
                        <span className="font-semibold tracking-tight">{item.label}</span>
                    </button>
                ))}
            </nav>

            <div className="mt-auto space-y-4">
                <div className="p-4 bg-teal-accent/5 rounded-2xl border border-teal-accent/10">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#6b635c] mb-2">Agency Status</p>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-teal-accent animate-pulse" />
                        <span className="text-xs font-bold text-base-900">4 Active Nodes</span>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 opacity-50 text-[10px] font-bold">
                    <span>v2.2.0</span>
                    <button className="hover:text-base-900 flex items-center gap-1">
                        <Share2 className="w-3 h-3" />
                        Share
                    </button>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
