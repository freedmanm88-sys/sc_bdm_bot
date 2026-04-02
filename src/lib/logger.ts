type Level = 'info' | 'warn' | 'error' | 'debug';

function fmt(level: Level, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (data !== undefined) {
    console[level === 'debug' ? 'log' : level](line, JSON.stringify(data, null, 2));
  } else {
    console[level === 'debug' ? 'log' : level](line);
  }
}

export const log = {
  info:  (msg: string, data?: unknown) => fmt('info', msg, data),
  warn:  (msg: string, data?: unknown) => fmt('warn', msg, data),
  error: (msg: string, data?: unknown) => fmt('error', msg, data),
  debug: (msg: string, data?: unknown) => fmt('debug', msg, data),
};
