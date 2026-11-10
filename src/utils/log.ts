import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { format } from "node:util";

const DEBUG = process.env.TODO_DEBUG === "1";

const CONFIG_DIR =
  process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode");
const LOG_FILE =
  process.env.TODO_LOG_FILE ??
  join(CONFIG_DIR, "plugins", "todolist", "logs", "todo.log");

type Level = "DEBUG" | "ERROR" | "INFO" | "WARN";

let dirReady = false;

const write = (level: Level, args: readonly unknown[]): void => {
  console.log(`[${level}]`, ...args);

  try {
    if (!dirReady) {
      mkdirSync(dirname(LOG_FILE), { recursive: true });
      dirReady = true;
    }
    const line = `${new Date().toISOString()} [todo] [${level}] ${format(...args)}\n`;
    appendFileSync(LOG_FILE, line, "utf8");
  } catch (error) {
    console.error(`[todo] failed to write log file ${LOG_FILE}:`, error);
  }
};

export const log = {
  debug: (...args: readonly unknown[]): void => {
    if (DEBUG) write("DEBUG", args);
  },
  error: (...args: readonly unknown[]): void => write("ERROR", args),
  info: (...args: readonly unknown[]): void => write("INFO", args),
  warn: (...args: readonly unknown[]): void => write("WARN", args),
};
