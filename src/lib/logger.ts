export enum LogLevel {
  error = 0,
  warn = 1,
  info = 2,
  debug = 3,
}

const levelFromString = (lvl: string | undefined): LogLevel => {
  const t = (lvl || '').toLowerCase();
  switch (t) {
    case 'error': return LogLevel.error;
    case 'warn': return LogLevel.warn;
    case 'info': return LogLevel.info;
    case 'debug': return LogLevel.debug;
    default: return LogLevel.info;
  }
};
let currentLevel: LogLevel = levelFromString(process.env.LOG_LEVEL);

function isServerStdoutAvailable(): boolean {
  // Check if we're in a Node.js environment (server-side)
  // If process exists and has stdout/stderr, we're on the server
  return (
    typeof process !== 'undefined' &&
    typeof process.stdout !== 'undefined' &&
    typeof process.stdout.write === 'function' &&
    typeof process.stderr !== 'undefined' &&
    typeof process.stderr.write === 'function'
  );
}

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function writeLine(level: 'error' | 'warn' | 'info' | 'debug', args: unknown[]): void {
  const prefix = `[${level.toUpperCase()}]`;
  const line = `${prefix} ${args.map(serializeArg).join(' ')}\n`;

  if (isServerStdoutAvailable()) {
    // Use stdout/stderr so logs survive Next's production console stripping.
    if (level === 'error' || level === 'warn') process.stderr.write(line);
    else process.stdout.write(line);
    return;
  }

  // Browser / fallback: use console (may be stripped in production client builds).
  switch (level) {
    case 'error':
      console.error(...args);
      break;
    case 'warn':
      console.warn(...args);
      break;
    case 'info':
      console.log(...args);
      break;
    case 'debug':
      if (typeof console.debug === 'function') console.debug(...args);
      else console.log(...args);
      break;
  }
}

export const logger = {
  setLevel: (level: string) => { currentLevel = levelToEnum(level); },
  error: (...args: unknown[]) => { if (currentLevel >= LogLevel.error) writeLine('error', args); },
  warn: (...args: unknown[]) => { if (currentLevel >= LogLevel.warn) writeLine('warn', args); },
  info: (...args: unknown[]) => { if (currentLevel >= LogLevel.info) writeLine('info', args); },
  debug: (...args: unknown[]) => { if (currentLevel >= LogLevel.debug) writeLine('debug', args); },
};

function levelToEnum(level: string): LogLevel {
  switch ((level || '').toLowerCase()) {
    case 'error': return LogLevel.error;
    case 'warn': return LogLevel.warn;
    case 'info': return LogLevel.info;
    case 'debug': return LogLevel.debug;
    default: return LogLevel.info;
  }
}

