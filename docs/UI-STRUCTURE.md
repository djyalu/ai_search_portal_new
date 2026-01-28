# UI Structure & Design Tokens (Redesign)

## 1. Design Tokens (CSS Variables)

Defined in `client/src/index.css`:

```css
:root {
  /* Colors */
  --color-base-900: #1a1a1a;    /* Ink Black */
  --color-base-800: #2d2a28;    /* Deep Charcoal */
  --color-base-100: #f5f2ed;    /* Warm Linen */
  --color-base-50:  #fffdf9;    /* Pure Pearl */
  
  --color-accent-teal:  #00f5d4; /* Electric Teal */
  --color-accent-amber: #ffbe0b; /* Amber Gold */
  --color-accent-coral: #ff006e; /* Vivid Coral */
  
  /* Layout */
  --sidebar-width: 260px;
  --header-height: 64px;
  
  /* Shadows */
  --shadow-premium: 0 10px 30px -10px rgba(0,0,0,0.15);
  --shadow-glow: 0 0 20px rgba(0, 245, 212, 0.3);
}
```

## 2. Component Hierarchy

- **AppLayout (Container)**
  - `Sidebar`: Fixed left navigation (New, Compare, History, Settings)
  - `MainShell`: Scrollable content area
    - `Header`: Active session title, status, export buttons
    - `Workspace`: Dynamic route-based content
      - `Phase 1: AnalysisDashboard` (Replacing old main view)
        - `PromptInputArea`: Top sticky input
        - `AgentControlPanel`: Floating chip list
        - `LiveStreamGrid`: Grid of agent cards (Perplexity, GPT, etc.)
        - `InsightPanel`: Right drawer with Analysis logs (Socket.io)
      - `Phase 2: ResultComparisonView`
        - `ConsensusWidget`: Summary & Difference analysis
        - `SplitPane`: Multi-agent text comparison
      - `Phase 3: HistoryBrowser`
        - `HistoryList`: Card-based list
        - `HistoryInspector`: Slide-in detail view

## 3. Implementation Plan (Phased)

### Stage 1: Foundation (Design System)
- Update `index.css` with tokens.
- Configure `tailwind.config.js` for custom colors and fonts (Space Grotesk, IBM Plex Sans KR).

### Stage 2: Layout Shell
- Implement `Sidebar` and `AppLayout`.
- Update `App.jsx` to wrap content in `AppLayout`.

### Stage 3: Feature Refinement
- Redesign `PromptInput` and `StreamingCard` components.
- Implement the "InsightPanel" (replacing the old timeline sidebar).

### Stage 4: UX Polish
- Add staggering animations with Framer Motion.
- Implement glassmorphism/premium card effects.
