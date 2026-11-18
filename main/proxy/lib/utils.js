/**
 * @file 工具函数集合：哈希、URL 解析、日志、字节解析、ID 生成等
 */

const crypto = require('node:crypto');
const path = require('node:path');

/**
 * 日志级别
 * @typedef {'trace'|'debug'|'info'|'warn'|'error'} LogLevel
 */

/** 日志级别优先级 */
const LEVEL_PRIORITY = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

/** 当前全局日志级别 */
let currentLevel = process.env.LOG_LEVEL || 'info';

/**
 * 创建带前缀的日志器
 * @param {string} tag 模块标签
 * @returns {{trace:Function,debug:Function,info:Function,warn:Function,error:Function}}
 */
function createLogger(tag) {
    const prefix = `[proxy:${tag}]`;
    const should = (level) => LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
    return {
        trace: (...a) => should('trace') && console.log(prefix, ...a),
        debug: (...a) => should('debug') && console.debug(prefix, ...a),
        info: (...a) => should('info') && console.log(prefix, ...a),
        warn: (...a) => should('warn') && console.warn(prefix, ...a),
        error: (...a) => should('error') && console.error(prefix, ...a),
    };
}

/**
 * 设置全局日志级别
 * @param {LogLevel} level
 */
function setLogLevel(level) {
    if (LEVEL_PRIORITY[level] !== undefined) currentLevel = level;
}

/**
 * 计算字符串的短哈希（用于缓存键与 sessionId）
 * @param {string} input
 * @returns {string} 12 位十六进制哈希
 */
function shortHash(input) {
    return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/**
 * 生成会话 ID
 * @returns {string} 形如 s_xxxxxxxx
 */
function generateSessionId() {
    return 's_' + crypto.randomBytes(6).toString('hex');
}

/**
 * 将人类可读的体积字符串解析为字节数
 * @example parseBytes('500MB') // 524288000
 * @param {string|number} input 如 "500MB"、"10GB"、1024
 * @returns {number} 字节数
 */
function parseBytes(input) {
    if (typeof input === 'number') return input;
    if (typeof input !== 'string') return 0;
    const m = input.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    const unit = (m[2] || 'B').toUpperCase();
    const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
    return Math.floor(num * mult);
}

/**
 * 将字节数格式化为人类可读字符串
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (!bytes) return '0B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + units[i];
}

/**
 * 相对 URL 解析（基于 baseURL 拼接）
 * @param {string} base 基准 URL
 * @param {string} rel 相对或绝对 URL
 * @returns {string} 绝对 URL
 */
function resolveUrl(base, rel) {
    if (!rel) return base;
    if (/^https?:\/\//i.test(rel)) return rel;
    try {
        return new URL(rel, base).toString();
    } catch {
        return rel;
    }
}

/**
 * 判断字符串是否以 http(s) 开头
 * @param {string} s
 * @returns {boolean}
 */
function isHttpUrl(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s);
}

/**
 * sleep
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * ISO 时间字符串（带 Z）
 * @param {number} [ts=Date.now()]
 * @returns {string}
 */
function toIso(ts = Date.now()) {
    return new Date(ts).toISOString();
}

/**
 * 安全地将任意字符串转为合法文件名
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

module.exports = {
    createLogger,
    setLogLevel,
    shortHash,
    generateSessionId,
    parseBytes,
    formatBytes,
    resolveUrl,
    isHttpUrl,
    sleep,
    toIso,
    sanitizeFileName,
};
