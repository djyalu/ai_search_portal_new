const express = require('express');
const bodyParser = require('body-parser');
const aggregator = require('./ralph_aggregator');

const app = express();
app.use(bodyParser.json());

app.post('/aggregate', async (req, res) => {
  const prompt = req.body && req.body.prompt ? req.body.prompt : '';
  const simulate = req.body && (req.body.simulate !== undefined) ? !!req.body.simulate : true;
  const modelNames = req.body && req.body.modelNames ? req.body.modelNames : undefined;
  try {
    const modelResponses = await aggregator.callAllModels(prompt, { simulate, modelNames });
    // modelResponses -> [{model, raw}, ...]
    const mapped = modelResponses.map(r => ({ model: r.model, raw: r.raw }));
    const aggregated = aggregator.aggregateResponses(mapped, { majorityThreshold: 0.5 });
    res.json({ ok: true, prompt, aggregated, perModel: mapped });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const port = process.env.RALPH_PORT || 4000;
app.listen(port, () => console.log(`Ralph demo server listening on http://localhost:${port}`));

module.exports = app;
