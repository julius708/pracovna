/** Minimal structured logger: one JSON line per event, never secrets. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(
  opts: { level?: LogLevel; bindings?: Record<string, unknown>; sink?: (line: string) => void } = {},
): Logger {
  const level = opts.level ?? 'info';
  const bindings = opts.bindings ?? {};
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const emit = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...bindings, ...(data ?? {}) }));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (b) => createLogger({ level, bindings: { ...bindings, ...b }, sink }),
  };
}

export const silentLogger: Logger = createLogger({ sink: () => {} });
