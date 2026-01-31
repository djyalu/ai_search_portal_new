import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Calendar, Trash2, ChevronRight, Clock, Box } from 'lucide-react';

const History = ({ history, onSelect, onDelete }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredHistory = history.filter(h =>
        h.prompt.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex-1 p-12 lg:p-24 overflow-y-auto min-h-screen">
            <div className="max-w-5xl mx-auto space-y-12">
                <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div>
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-base-800/60 mb-3">
                            <Clock className="w-3.5 h-3.5 text-teal-accent" />
                            Intelligence Archive
                        </div>
                        <h2 className="text-5xl font-black text-base-900 font-display italic tracking-tighter">History</h2>
                    </div>

                    <div className="relative group min-w-[300px]">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-base-800/20 group-focus-within:text-teal-accent transition-colors" />
                        <input
                            type="text"
                            placeholder="Search reports..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white border-2 border-base-100 rounded-2xl py-4 pl-14 pr-6 font-bold text-sm text-base-900 outline-none focus:border-teal-accent/30 transition-all shadow-sm placeholder-base-800/40"
                        />
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <AnimatePresence mode="popLayout">
                        {filteredHistory.length > 0 ? filteredHistory.map((item, index) => (
                            <motion.div
                                key={item.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ delay: index * 0.05 }}
                                className="premium-card bg-white p-8 group cursor-pointer hover:border-teal-accent/40"
                                onClick={() => onSelect(item)}
                            >
                                <div className="flex justify-between items-start mb-6">
                                    <div className="p-2 bg-base-100 rounded-xl group-hover:bg-teal-accent/10 transition-colors">
                                        <Box className="w-5 h-5 text-base-800/40 group-hover:text-teal-accent" />
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                                        className="p-2 text-base-800/10 hover:text-coral-accent transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>

                                <p className="text-lg font-bold text-base-900 leading-tight mb-6 line-clamp-3 font-display">
                                    {item.prompt}
                                </p>

                                <div className="flex items-center justify-between pt-6 border-t border-base-100 mt-auto">
                                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-base-800/60">
                                        <Calendar className="w-3 h-3" />
                                        {new Date(item.created_at).toLocaleDateString()}
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-base-800/20 group-hover:text-teal-accent group-hover:translate-x-1 transition-all" />
                                </div>
                            </motion.div>
                        )) : (
                            <div className="col-span-full py-24 flex flex-col items-center justify-center opacity-60">
                                <Box className="w-16 h-16 mb-6 text-base-800/20" />
                                <p className="font-display font-black text-xl uppercase tracking-widest italic text-base-800/40">No Records Found</p>
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

export default History;
