/* lib/log.js — tiny structured logger.
   Emits one JSON line per event so CloudWatch Logs Insights can query fields.
   Level via LOG_LEVEL env (debug|info|warn|error), default "info". */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

function emit(level, msg, fields, base) {
  if (LEVELS[level] < MIN) return;
  const line = { t: new Date().toISOString(), level, msg, ...base, ...fields };
  // warn/error → stderr so they're easy to filter; info/debug → stdout
  (LEVELS[level] >= LEVELS.warn ? console.error : console.log)(JSON.stringify(line));
}

function make(base = {}) {
  return {
    debug: (msg, fields) => emit("debug", msg, fields, base),
    info: (msg, fields) => emit("info", msg, fields, base),
    warn: (msg, fields) => emit("warn", msg, fields, base),
    error: (msg, fields) => emit("error", msg, fields, base),
    /** derive a logger that stamps fixed fields (e.g. reqId) onto every line */
    child: (extra) => make({ ...base, ...extra }),
  };
}

export const log = make();
