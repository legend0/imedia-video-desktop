/**
 * 日志工具模块
 *
 * 分级明确：ERROR(0) / WARN(1) / INFO(2) / DEBUG(3)
 * 环境隔离：开发/测试环境默认 DEBUG，生产环境默认 INFO
 * 运行时动态调整：通过 setLevel() 热更新，无需重启
 *
 * 使用规范：
 *   ERROR(0) — 需人工介入的错误，系统无法自动恢复
 *   WARN(1)  — 潜在问题，但系统可自动降级/重试
 *   INFO(2)  — 低频关键动作：启停、配置变更、重要业务里程碑
 *   DEBUG(3) — 高频动作：每请求入参出参、循环内状态、定期任务
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_DIR = path.join(app.getPath('userData'), 'logs');

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const { isDev } = require('./env');
let currentLogLevel = isDev ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

const LOG_FILES = {
  error: path.join(LOG_DIR, 'error.log'),
  warn: path.join(LOG_DIR, 'warn.log'),
  info: path.join(LOG_DIR, 'info.log'),
  debug: path.join(LOG_DIR, 'debug.log')
};

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (error) {
  if (error.code !== 'EEXIST') {
    process.stderr.write(`[日志] 创建日志目录失败: ${error.message}\n`);
  }
}

function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

const logBuffer = {
  error: [],
  warn: [],
  info: [],
  debug: []
};

let flushTimer = null;
const FLUSH_INTERVAL = 1000;

function writeLog(level, message) {
  try {
    const bufferKey = level.toLowerCase();
    if (logBuffer[bufferKey]) {
      logBuffer[bufferKey].push(message);

      if (!flushTimer) {
        flushTimer = setTimeout(flushLogs, FLUSH_INTERVAL);
      }
    }
  } catch (error) {
    process.stderr.write(`[日志] 写入日志缓冲失败: ${error.message}\n`);
  }
}

function flushLogs() {
  flushTimer = null;
  try {
    for (const level in logBuffer) {
      if (logBuffer[level].length > 0) {
        const messages = logBuffer[level];
        logBuffer[level] = [];

        const logFile = LOG_FILES[level];
        const formattedMessages = messages.map(msg => formatMessage(level.toUpperCase(), msg)).join('\n') + '\n';

        fs.appendFileSync(logFile, formattedMessages, 'utf8');
      }
    }
  } catch (error) {
    process.stderr.write(`[日志] 批量写入日志失败: ${error.message}\n`);
  }
}

function error(message) {
  if (currentLogLevel >= LOG_LEVELS.ERROR) {
    const formattedMessage = formatMessage('ERROR', message);
    process.stderr.write(formattedMessage + '\n');
    writeLog('ERROR', message);
  }
}

function warn(message) {
  if (currentLogLevel >= LOG_LEVELS.WARN) {
    const formattedMessage = formatMessage('WARN', message);
    process.stderr.write(formattedMessage + '\n');
    writeLog('WARN', message);
  }
}

function info(message) {
  if (currentLogLevel >= LOG_LEVELS.INFO) {
    const formattedMessage = formatMessage('INFO', message);
    process.stdout.write(formattedMessage + '\n');
    writeLog('INFO', message);
  }
}

function debug(message) {
  if (currentLogLevel >= LOG_LEVELS.DEBUG) {
    const formattedMessage = formatMessage('DEBUG', message);
    process.stdout.write(formattedMessage + '\n');
    writeLog('DEBUG', message);
  }
}

/**
 * 设置日志级别（运行时动态调整）
 * @param {string|number} level - 级别名称(ERROR/WARN/INFO/DEBUG)或数值
 */
function setLevel(level) {
  if (typeof level === 'string' && LOG_LEVELS.hasOwnProperty(level)) {
    currentLogLevel = LOG_LEVELS[level];
  } else if (typeof level === 'number' && level >= 0 && level <= 3) {
    currentLogLevel = level;
  }
}

/**
 * 获取当前日志级别
 * @returns {number} 当前日志级别数值
 */
function getLevel() {
  return currentLogLevel;
}

/**
 * 获取当前日志级别名称
 * @returns {string} 当前日志级别名称
 */
function getLevelName() {
  for (const [name, value] of Object.entries(LOG_LEVELS)) {
    if (value === currentLogLevel) return name;
  }
  return 'UNKNOWN';
}

async function cleanOldLogs(days = 7) {
  try {
    const files = await fs.promises.readdir(LOG_DIR);
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stats = await fs.promises.stat(filePath);

      if (stats.mtime.getTime() < cutoffTime) {
        await fs.promises.unlink(filePath);
      }
    }
  } catch (error) {
    error(`清理旧日志失败: ${error.message}`);
  }
}

process.on('exit', () => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    for (const level in logBuffer) {
      if (logBuffer[level].length > 0) {
        const messages = logBuffer[level];
        logBuffer[level] = [];

        const logFile = LOG_FILES[level];
        const formattedMessages = messages.map(msg => formatMessage(level.toUpperCase(), msg)).join('\n') + '\n';

        fs.appendFileSync(logFile, formattedMessages, 'utf8');
      }
    }
  } catch {
  }
});

module.exports = {
  error,
  warn,
  info,
  debug,
  setLevel,
  getLevel,
  getLevelName,
  cleanOldLogs,
  flushLogs,
  LOG_LEVELS
};
