export const STUDY_FOCUS_SQL = `
CREATE TABLE IF NOT EXISTS study_focus_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_focus_sessions (
  id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER,
  milliseconds REAL NOT NULL DEFAULT 0, status TEXT NOT NULL,
  subject_id TEXT, subject_name TEXT, completed_day TEXT
);
CREATE TABLE IF NOT EXISTS study_focus_intervals (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, milliseconds REAL NOT NULL CHECK (milliseconds > 0), day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_focus_intervals_day ON study_focus_intervals(day);
CREATE INDEX IF NOT EXISTS idx_study_focus_sessions_started ON study_focus_sessions(started_at);
`;
