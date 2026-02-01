export const ReportSchema = {
    meta: { title: '', date: '', agents: [], confidence: '' },
    executive_summary: { conclusions: [], risks: [], actions: [] },
    insights: [],
    consensus_matrix: [],
    causal_chain: { drivers: [], path: [], impact: [] },
    scenarios: [],
    risks: { gaps: [], assumptions: [], externals: [] },
    actions: { options: [], recommendation: '' },
    monitoring: [],
    appendix: { agent_status: {}, raw_snapshot: '' }
};
