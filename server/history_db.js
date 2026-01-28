import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, 'history.db');
const db = new Database(dbPath);

// 테이블 초기화
db.exec(`
  CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    results TEXT,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 인덱스: created_at 빠른 조회 및 정렬
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at);
`);

const HistoryDB = {
    save: (prompt, results, summary) => {
        const stmt = db.prepare('INSERT INTO search_history (prompt, results, summary) VALUES (?, ?, ?)');
        return stmt.run(prompt, JSON.stringify(results), summary);
    },

    getAll: () => {
        const stmt = db.prepare('SELECT * FROM search_history ORDER BY created_at DESC');
        return stmt.all().map(item => ({
            ...item,
            results: JSON.parse(item.results)
        }));
    },

    getById: (id) => {
        const stmt = db.prepare('SELECT * FROM search_history WHERE id = ?');
        const item = stmt.get(id);
        if (item) {
            item.results = JSON.parse(item.results);
        }
        return item;
    },

    delete: (id) => {
        const stmt = db.prepare('DELETE FROM search_history WHERE id = ?');
        return stmt.run(id);
    }
};

// 보관 정책: 날짜 기준 또는 최대 개수 유지
HistoryDB.cleanupOlderThan = (days) => {
    const stmt = db.prepare('DELETE FROM search_history WHERE created_at < datetime(?, "localtime")');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return stmt.run(cutoff);
};

HistoryDB.keepMaxCount = (maxCount) => {
    // delete oldest rows beyond maxCount
    const total = db.prepare('SELECT COUNT(*) as c FROM search_history').get().c;
    if (total <= maxCount) return { removed: 0 };
    const toRemove = total - maxCount;
    const ids = db.prepare('SELECT id FROM search_history ORDER BY created_at ASC LIMIT ?').all(toRemove).map(r => r.id);
    const del = db.prepare(`DELETE FROM search_history WHERE id IN (${ids.map(() => '?').join(',')})`);
    return del.run(...ids);
};

export default HistoryDB;
