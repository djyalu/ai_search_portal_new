import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { chromium } from 'playwright';
import { runExhaustiveAnalysis, saveToNotion } from './playwright_handler.js';
import HistoryDB from './history_db.js';

dotenv.config();

const app = express();
const LOG_PATH = path.join(process.cwd(), 'server.log');

function log(...args) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFile(LOG_PATH, `${new Date().toISOString()} ` + line + '\n', (err) => { if (err) {/* ignore */} });
    console.log(...args);
}
const httpServer = createServer(app);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const CLIENT_ORIGINS = CLIENT_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (CLIENT_ORIGINS.includes(origin)) return true;
    // allow any localhost / 127.0.0.1 dev ports
    if (/^https?:\/\/localhost:\d+$/.test(origin)) return true;
    if (/^https?:\/\/127\.0\.0\.1:\d+$/.test(origin)) return true;
    return false;
};

const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            if (isAllowedOrigin(origin)) return callback(null, true);
            return callback(new Error(`CORS blocked origin: ${origin}`), false);
        },
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked origin: ${origin}`), false);
    }
}));
app.use(express.json({ limit: '3mb' }));

// REST API Routes
app.get('/api/history', (req, res) => {
    try {
        const history = HistoryDB.getAll();
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.delete('/api/history/:id', (req, res) => {
    try {
        HistoryDB.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete history' });
    }
});

app.post('/api/notion/save', async (req, res) => {
    const { prompt, summary, results } = req.body;
    try {
        const response = await saveToNotion(prompt, summary, results);
        res.json({ success: true, url: response.url });
    } catch (error) {
        log('ERROR', error);
        res.status(500).json({ error: error.message || 'Failed to save to Notion' });
    }
});

const sanitizeFilename = (name = '') => {
    const base = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
    return base.length > 0 ? base : 'report.pdf';
};

app.post('/api/export/pdf', async (req, res) => {
    const { html, filename } = req.body || {};
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'html is required' });
    }
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
        const buffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', bottom: '20mm', left: '16mm', right: '16mm' }
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename || 'report.pdf')}"`);
        res.send(buffer);
    } catch (error) {
        log('ERROR', error);
        res.status(500).json({ error: error.message || 'Failed to export PDF' });
    } finally {
        try { if (browser) await browser.close(); } catch (_) {}
    }
});

io.on('connection', (socket) => {
    log('Client connected:', socket.id);

    socket.on('start-analysis', async (payload) => {
        const { prompt, enabledAgents } = typeof payload === 'string' ? { prompt: payload } : (payload || {});
        if (!prompt || !prompt.trim()) {
            socket.emit('analysis-error', { message: '질문을 입력해주세요.' });
            return;
        }
        log(`Starting analysis for: ${prompt}`);
            try {
                const results = await runExhaustiveAnalysis(prompt, (step) => {
                    socket.emit('progress', step);
                }, { enabledAgents });

                // 히스토리 저장
                HistoryDB.save(prompt, results.results, results.summary);

                socket.emit('completed', results);
            } catch (error) {
                log('ERROR', error);
                // use a namespaced event to avoid colliding with socket.io internal 'error'
                socket.emit('analysis-error', { message: `Analysis failed: ${error.message}` });
            }
    });

    socket.on('disconnect', () => {
        log('Client disconnected');
    });
});

httpServer.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`);
});
