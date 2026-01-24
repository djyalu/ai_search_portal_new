# Ralph Aggregation Demo

Quick start (Windows PowerShell):

1. Open a terminal and go to the server folder:

   cd "f:\projects\AI Search Portal\server"

2. Install Express (if not already):

   npm install express

3. Run the demo server:

   node ralph_demo.js

4. In another PowerShell session run the sample request:

   .\test_aggregate.ps1

Notes
- The demo uses simulated model responses by default. To wire real models, modify `ralph_aggregator.callAllModels` to call your APIs or pass a `callImpl` option that performs HTTP requests.
- Key files:
  - [server/ralph_design.md](server/ralph_design.md)
  - [server/ralph_aggregator.js](server/ralph_aggregator.js)
  - [server/ralph_demo.js](server/ralph_demo.js)
  - [server/test_aggregate.ps1](server/test_aggregate.ps1)

Integration tips
- Keep raw per-model outputs stored for audit and to compute historical weights.
- Start with simulation, then add one real model at a time and tune `majorityThreshold` and `modelWeights`.
