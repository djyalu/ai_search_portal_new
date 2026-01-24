/**
 * ralph_aggregator.js
 * Small, dependency-free implementation of response standardization,
 * confidence scoring, weighted voting, and simple mediator fallback.
 */

function normalizeText(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function standardizeRaw(raw, modelName) {
  if (!raw) return { model: modelName, answer: '', confidence: 0.5, reasoning: '', raw };
  if (typeof raw === 'string') {
    try {
      const firstLine = raw.split(/\r?\n/)[0].trim();
      const obj = JSON.parse(firstLine);
      return { model: modelName, answer: String(obj.answer || obj.text || raw), confidence: Number(obj.confidence ?? 0.5), reasoning: obj.reasoning || '', raw };
    } catch (e) {
      return { model: modelName, answer: raw, confidence: 0.5, reasoning: '', raw };
    }
  }
  const answer = raw.answer || raw.text || '';
  const confidence = (raw.confidence == null) ? 0.5 : Number(raw.confidence);
  const reasoning = raw.reasoning || raw.reason || '';
  return { model: modelName, answer: String(answer), confidence: isNaN(confidence) ? 0.5 : Math.max(0, Math.min(1, confidence)), reasoning, raw };
}

function scoreConfidence(item, opts = {}) {
  const modelWeight = (opts.modelWeights && opts.modelWeights[item.model]) || 1;
  const base = (item.confidence == null) ? 0.5 : item.confidence;
  return base * modelWeight;
}

function aggregateResponses(items, opts = {}) {
  const normalizedMap = new Map();
  const perModel = [];
  let totalWeight = 0;
  for (const it of items) {
    const std = standardizeRaw(it.raw || it, it.model || it.name || 'model');
    const norm = normalizeText(std.answer);
    const w = scoreConfidence(std, opts);
    totalWeight += w;
    const entry = { model: std.model, answer: std.answer, norm, confidence: std.confidence, weight: w, reasoning: std.reasoning, raw: std.raw };
    perModel.push(entry);
    if (!normalizedMap.has(norm)) normalizedMap.set(norm, { weight: 0, examples: [] });
    const g = normalizedMap.get(norm);
    g.weight += w;
    g.examples.push(entry);
  }
  let topNorm = null;
  let topWeight = 0;
  for (const [norm, g] of normalizedMap.entries()) {
    if (g.weight > topWeight) { topWeight = g.weight; topNorm = norm; }
  }
  const result = { method: 'weighted_vote', totalWeight, topWeight, perModel, choices: [] };
  for (const [norm, g] of normalizedMap.entries()) {
    result.choices.push({ norm, weight: g.weight, examples: g.examples.map(e => ({ model: e.model, answer: e.answer, confidence: e.confidence })) });
  }
  if (totalWeight === 0) {
    return { finalAnswer: '', reason: 'no-weight', detail: result };
  }
  if (topWeight >= totalWeight * (opts.majorityThreshold || 0.5)) {
    const rep = normalizedMap.get(topNorm).examples[0].answer;
    return { finalAnswer: rep, method: 'weighted_vote', confidence: Number((topWeight / totalWeight).toFixed(3)), detail: result };
  }
  const topChoices = Array.from(normalizedMap.entries()).sort((a, b) => b[1].weight - a[1].weight).slice(0, 3);
  const synth = synthesizeFromChoices(topChoices.map(([norm, g]) => g.examples[0].answer));
  return { finalAnswer: synth, method: 'synthesizer', confidence: Number((topWeight / totalWeight).toFixed(3)), detail: result };
}

function synthesizeFromChoices(answers) {
  if (answers.length === 0) return '';
  if (answers.length === 1) return answers[0];
  const uniq = [];
  for (const a of answers) {
    const t = a.trim();
    if (!uniq.includes(t)) uniq.push(t);
  }
  if (uniq.length === 1) return uniq[0];
  const combined = uniq.join(' / ');
  return `${combined} (disagreement among models; see details)`;
}

async function callAllModels(prompt, opts = {}) {
  const models = opts.modelNames || ['gpt-A', 'gpt-B', 'gpt-C', 'gpt-D'];
  if (opts.simulate === false && opts.callImpl) {
    const promises = models.map(m => opts.callImpl(m, prompt).then(raw => ({ model: m, raw })));
    const res = await Promise.all(promises);
    return res.map(r => ({ model: r.model, raw: r.raw }));
  }
  const res = [];
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const confidence = 0.4 + Math.random() * 0.5;
    const answerVariants = opts.simAnswers || [
      `Simulated answer for: ${prompt}`,
      `Alternative take on: ${prompt}`,
      `Different perspective: ${prompt}`,
      `Another view: ${prompt}`
    ];
    const answer = answerVariants[i % answerVariants.length];
    res.push({ model: m, raw: { answer, confidence: Number(confidence.toFixed(2)), reasoning: 'simulated' } });
  }
  await new Promise(r => setTimeout(r, 50));
  return res;
}

module.exports = { standardizeRaw, normalizeText, scoreConfidence, aggregateResponses, callAllModels };
