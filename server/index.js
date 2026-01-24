import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { runExhaustiveAnalysis, saveToNotion } from './playwright_handler.js';
import HistoryDB from './history_db.js';

dotenv.config();

const app = express();
const LOG_PATH = path.join(process.cwd(), 'server.log');

function log(...args) {
    try {
        const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ` + line + '\n');
    } catch (e) {
        // ignore logging errors
    }
    console.log(...args);
}
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

io.on('connection', (socket) => {
    log('Client connected:', socket.id);

    socket.on('start-analysis', async (prompt) => {
        if (app.locals.isAnalyzing) {
            socket.emit('error', '현재 다른 분석 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        log(`Starting analysis for: ${prompt}`);
        app.locals.isAnalyzing = true;

        try {
            const results = await runExhaustiveAnalysis(prompt, (step) => {
                socket.emit('progress', step);
            });

            // 히스토리 저장
            HistoryDB.save(prompt, results.results, results.summary);

            socket.emit('completed', results);
        } catch (error) {
            log('ERROR', error);
            socket.emit('error', `Analysis failed: ${error.message}`);
        } finally {
            app.locals.isAnalyzing = false;
        }
    });

    socket.on('disconnect', () => {
        log('Client disconnected');
    });
});

httpServer.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`);
});
