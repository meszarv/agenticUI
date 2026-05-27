import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// --- Constants -----------------------------------------------------------

const TRACE_FILE = path.join(
  process.env.LLM_TRACE_DIR || '/app/llm_data',
  'llm_traces.jsonl',
);

const DB_PATH = process.env.SQLITE_FILE || '/app/data/db.sqlite3';

// Time windows for grouping events into the same query
const SAME_QUERY_ID_WINDOW_MS = 30_000; // 30 s for events sharing a query_id
const UNKNOWN_GROUP_WINDOW_MS = 5_000; // 5 s for legacy events without query_id

// --- In-memory state for incremental import ------------------------------

let lastImportedByteOffset = 0;

// --- Types ---------------------------------------------------------------

interface RawTraceEvent {
  type?: string;
  timestamp?: string;
  query_id?: string;
  pipeline?: string;
  question?: string;
  model?: string;
  duration_ms?: number;
  tokens?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  system_prompt?: string;
  user_prompt?: string;
  response?: string;
  error?: string;
  source?: string;
}

interface GroupedQuery {
  query_id: string;
  question: string;
  source: string;
  status: string;
  total_duration_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  started_at: string;
  finished_at: string;
  steps: GroupedStep[];
}

interface GroupedStep {
  step_index: number;
  step_type: string;
  model: string;
  status: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request: string;
  response: string;
  error: string;
  started_at: string;
}

// --- Helpers -------------------------------------------------------------

function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/** Ensure trace tables exist (idempotent, for safety if migration hasn't run) */
function ensureTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_query (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_id VARCHAR(64),
      question TEXT,
      source VARCHAR(20) DEFAULT 'user',
      status VARCHAR(20) DEFAULT 'success',
      total_duration_ms INTEGER DEFAULT 0,
      total_prompt_tokens INTEGER DEFAULT 0,
      total_completion_tokens INTEGER DEFAULT 0,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS trace_step (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_query_id INTEGER REFERENCES trace_query(id) ON DELETE CASCADE,
      step_index INTEGER DEFAULT 0,
      step_type VARCHAR(40),
      model VARCHAR(60),
      status VARCHAR(20) DEFAULT 'success',
      duration_ms INTEGER DEFAULT 0,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      request TEXT,
      response TEXT,
      error TEXT,
      started_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_trace_query_started ON trace_query(started_at);
    CREATE INDEX IF NOT EXISTS idx_trace_query_status  ON trace_query(status);
    CREATE INDEX IF NOT EXISTS idx_trace_query_source  ON trace_query(source);
    CREATE INDEX IF NOT EXISTS idx_trace_step_type     ON trace_step(step_type);
    CREATE INDEX IF NOT EXISTS idx_trace_step_query    ON trace_step(trace_query_id);
  `);
}

// --- Grouping logic ------------------------------------------------------

function groupEvents(events: RawTraceEvent[]): GroupedQuery[] {
  // 1. Separate events with a real query_id vs "unknown" / missing
  const byQueryId: Record<string, RawTraceEvent[]> = {};
  const unknowns: RawTraceEvent[] = [];

  for (const evt of events) {
    if (evt.query_id && evt.query_id !== 'unknown') {
      if (!byQueryId[evt.query_id]) byQueryId[evt.query_id] = [];
      byQueryId[evt.query_id].push(evt);
    } else {
      unknowns.push(evt);
    }
  }

  const groups: GroupedQuery[] = [];

  // 2. Group named query_id events: split if time gap > SAME_QUERY_ID_WINDOW_MS
  for (const [qid, evts] of Object.entries(byQueryId)) {
    const sorted = evts.sort(
      (a, b) =>
        new Date(a.timestamp || 0).getTime() -
        new Date(b.timestamp || 0).getTime(),
    );
    let bucket: RawTraceEvent[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].timestamp || 0).getTime();
      const curr = new Date(sorted[i].timestamp || 0).getTime();
      if (curr - prev > SAME_QUERY_ID_WINDOW_MS) {
        groups.push(buildGroup(qid, bucket));
        bucket = [];
      }
      bucket.push(sorted[i]);
    }
    if (bucket.length) groups.push(buildGroup(qid, bucket));
  }

  // 3. Group unknowns by time proximity
  if (unknowns.length) {
    const sorted = unknowns.sort(
      (a, b) =>
        new Date(a.timestamp || 0).getTime() -
        new Date(b.timestamp || 0).getTime(),
    );
    let bucket: RawTraceEvent[] = [sorted[0]];
    let idx = 1;

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].timestamp || 0).getTime();
      const curr = new Date(sorted[i].timestamp || 0).getTime();
      if (curr - prev > UNKNOWN_GROUP_WINDOW_MS) {
        groups.push(buildGroup(`unknown-${idx++}`, bucket));
        bucket = [];
      }
      bucket.push(sorted[i]);
    }
    if (bucket.length) groups.push(buildGroup(`unknown-${idx}`, bucket));
  }

  return groups;
}

function buildGroup(queryId: string, events: RawTraceEvent[]): GroupedQuery {
  const question = events.find((e) => e.question)?.question || '';
  const source = events.find((e) => e.source)?.source || 'user';

  let totalDuration = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let hasError = false;
  let hasWarn = false;

  const steps: GroupedStep[] = events.map((evt, i) => {
    const dur = evt.duration_ms || 0;
    const pt = evt.tokens?.prompt_tokens || 0;
    const ct = evt.tokens?.completion_tokens || 0;
    const tt = evt.tokens?.total_tokens || pt + ct;
    totalDuration += dur;
    totalPrompt += pt;
    totalCompletion += ct;

    const stepStatus = evt.error ? 'error' : 'success';
    if (evt.error) hasError = true;

    // Build compact request string
    const requestParts: string[] = [];
    if (evt.system_prompt) requestParts.push(evt.system_prompt);
    if (evt.user_prompt) requestParts.push(evt.user_prompt);
    if (evt.question && !requestParts.length) requestParts.push(evt.question);

    return {
      step_index: i,
      step_type: evt.pipeline || evt.type || 'unknown',
      model: evt.model || '',
      status: stepStatus,
      duration_ms: dur,
      prompt_tokens: pt,
      completion_tokens: ct,
      total_tokens: tt,
      request: requestParts.join('\n---\n'),
      response: evt.response || '',
      error: evt.error || '',
      started_at: evt.timestamp || '',
    };
  });

  // Determine query-level status
  // 用户查询超过 30s 才告警，系统调用不做时间告警
  if (!hasError && source === 'user' && totalDuration > 30_000) hasWarn = true;
  const status = hasError ? 'error' : hasWarn ? 'warn' : 'success';

  const timestamps = events
    .map((e) => new Date(e.timestamp || 0).getTime())
    .filter((t) => t > 0);
  const startedAt = timestamps.length
    ? new Date(Math.min(...timestamps)).toISOString()
    : '';
  const finishedAt = timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : '';

  return {
    query_id: queryId,
    question,
    source,
    status,
    total_duration_ms: totalDuration,
    total_prompt_tokens: totalPrompt,
    total_completion_tokens: totalCompletion,
    started_at: startedAt,
    finished_at: finishedAt,
    steps,
  };
}

// --- Import new JSONL lines into SQLite ----------------------------------

function importNewLines(db: Database.Database) {
  if (!fs.existsSync(TRACE_FILE)) return;

  // 用文件大小判断是否有新内容（避免读取整个文件）
  const stat = fs.statSync(TRACE_FILE);
  if (stat.size <= lastImportedByteOffset) {
    // 文件可能被 rotation 截断了，重置
    if (stat.size < lastImportedByteOffset) {
      lastImportedByteOffset = 0;
    }
    return;
  }

  // 只读取新增部分（从上次偏移量开始）
  const fd = fs.openSync(TRACE_FILE, 'r');
  const newSize = stat.size - lastImportedByteOffset;
  const buffer = Buffer.alloc(Math.min(newSize, 10 * 1024 * 1024)); // 单次最多读 10MB
  fs.readSync(fd, buffer, 0, buffer.length, lastImportedByteOffset);
  fs.closeSync(fd);

  const newContent = buffer.toString('utf-8');
  const newLines = newContent.split('\n').filter(Boolean);

  const newEvents: RawTraceEvent[] = [];
  for (const line of newLines) {
    try {
      newEvents.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  lastImportedByteOffset = Math.min(
    lastImportedByteOffset + buffer.length,
    stat.size,
  );


  if (!newEvents.length) {
    return;
  }

  const groups = groupEvents(newEvents);

  const insertQuery = db.prepare(`
    INSERT INTO trace_query
      (query_id, question, source, status, total_duration_ms,
       total_prompt_tokens, total_completion_tokens, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertStep = db.prepare(`
    INSERT INTO trace_step
      (trace_query_id, step_index, step_type, model, status, duration_ms,
       prompt_tokens, completion_tokens, total_tokens, request, response, error, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importAll = db.transaction(() => {
    for (const g of groups) {
      const info = insertQuery.run(
        g.query_id,
        g.question,
        g.source,
        g.status,
        g.total_duration_ms,
        g.total_prompt_tokens,
        g.total_completion_tokens,
        g.started_at,
        g.finished_at,
      );
      const queryId = info.lastInsertRowid;

      for (const s of g.steps) {
        insertStep.run(
          queryId,
          s.step_index,
          s.step_type,
          s.model,
          s.status,
          s.duration_ms,
          s.prompt_tokens,
          s.completion_tokens,
          s.total_tokens,
          s.request,
          s.response,
          s.error,
          s.started_at,
        );
      }
    }
  });

  importAll();
}

// --- API Handler ---------------------------------------------------------

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let db: Database.Database | null = null;

  try {
    db = getDb();
    ensureTables(db);
    importNewLines(db);

    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const size = Math.max(
      1,
      Math.min(100, parseInt(req.query.size as string, 10) || 20),
    );
    const status = (req.query.status as string) || 'all';
    const source = (req.query.source as string) || 'all';
    const stepType = (req.query.step_type as string) || '';
    const sort = (req.query.sort as string) || 'timestamp';
    const order = (req.query.order as string) === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'all') {
      conditions.push('tq.status = ?');
      params.push(status);
    }
    if (source && source !== 'all') {
      conditions.push('tq.source = ?');
      params.push(source);
    }
    if (stepType) {
      conditions.push(
        'tq.id IN (SELECT DISTINCT trace_query_id FROM trace_step WHERE step_type = ?)',
      );
      params.push(stepType);
    }

    const whereClause = conditions.length
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // Sort mapping
    let orderBy: string;
    switch (sort) {
      case 'duration':
        orderBy = `tq.total_duration_ms ${order}`;
        break;
      case 'tokens':
        orderBy = `(tq.total_prompt_tokens + tq.total_completion_tokens) ${order}`;
        break;
      case 'timestamp':
      default:
        orderBy = `tq.started_at ${order}`;
        break;
    }

    // Count total matching rows
    const countStmt = db.prepare(
      `SELECT COUNT(*) AS cnt FROM trace_query tq ${whereClause}`,
    );
    const total = (countStmt.get(...params) as any)?.cnt || 0;

    // Fetch paginated queries
    const offset = (page - 1) * size;
    const queryStmt = db.prepare(
      `SELECT * FROM trace_query tq ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    );
    const queries = queryStmt.all(...params, size, offset) as any[];

    // Fetch steps for each query
    const stepStmt = db.prepare(
      `SELECT * FROM trace_step WHERE trace_query_id = ? ORDER BY step_index ASC`,
    );
    const result = queries.map((q) => {
      const steps = stepStmt.all(q.id) as any[];
      return {
        id: q.id,
        query_id: q.query_id,
        question: q.question,
        source: q.source,
        status: q.status,
        total_duration_ms: q.total_duration_ms,
        total_prompt_tokens: q.total_prompt_tokens,
        total_completion_tokens: q.total_completion_tokens,
        started_at: q.started_at,
        steps: steps.map((s) => ({
          step_type: s.step_type,
          model: s.model,
          status: s.status,
          duration_ms: s.duration_ms,
          prompt_tokens: s.prompt_tokens,
          completion_tokens: s.completion_tokens,
          total_tokens: s.total_tokens,
          request: s.request,
          response: s.response,
          error: s.error,
          started_at: s.started_at,
        })),
      };
    });

    // Build summary (unfiltered totals)
    const summaryStmt = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'warn' THEN 1 ELSE 0 END) AS warn,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
        SUM(total_prompt_tokens) AS totalPrompt,
        SUM(total_completion_tokens) AS totalCompletion,
        AVG(total_duration_ms) AS avgDuration
      FROM trace_query
    `);
    const s = summaryStmt.get() as any;

    const summary = {
      total: s?.total || 0,
      success: s?.success || 0,
      warn: s?.warn || 0,
      error: s?.error || 0,
      totalTokens: {
        prompt: s?.totalPrompt || 0,
        completion: s?.totalCompletion || 0,
        total: (s?.totalPrompt || 0) + (s?.totalCompletion || 0),
      },
      avgDuration: Math.round(s?.avgDuration || 0),
    };

    res.status(200).json({
      queries: result,
      total,
      page,
      size,
      summary,
    });
  } catch (err: any) {
    console.error('[traces] Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
