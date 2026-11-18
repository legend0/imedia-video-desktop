/**
 * @file HTTP 拉取器：基于 node:http/https，支持流式下载与超时
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { createLogger } = require('./utils');

const log = createLogger('fetcher');

/** 默认请求头 */
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; M3U8BoostProxy/1.0)',
    'Accept': '*/*',
};

/**
 * @typedef {Object} FetchOptions
 * @property {number} [timeout=30000] 超时(ms)
 * @property {Object} [headers] 额外请求头
 * @property {string} [method='GET']
 * @property {number} [maxRedirects=5]
 */

/**
 * 发起请求并返回原始 ClientResponse 与重定向后的最终 URL
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @returns {Promise<{res:import('http').IncomingMessage, finalUrl:string}>}
 */
function request(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const lib = target.protocol === 'http:' ? http : https;
        const headers = { ...DEFAULT_HEADERS, ...(opts.headers || {}) };
        const req = lib.request(
            {
                method: opts.method || 'GET',
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || (target.protocol === 'http:' ? 80 : 443),
                path: target.pathname + target.search,
                headers,
            },
            (res) => resolve({ res, finalUrl: url })
        );
        req.on('error', reject);
        req.setTimeout(opts.timeout || 30000, () => {
            req.destroy(new Error('request timeout'));
        });
        req.end();
    });
}

/**
 * 处理重定向
 * @param {string} url
 * @param {FetchOptions} opts
 * @param {number} depth
 * @returns {Promise<{res:import('http').IncomingMessage, finalUrl:string}>}
 */
async function requestWithRedirect(url, opts, depth = 0) {
    const { res, finalUrl } = await request(url, opts);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (depth >= (opts.maxRedirects || 5)) {
            res.destroy();
            throw new Error(`too many redirects (>${opts.maxRedirects || 5})`);
        }
        const next = new URL(res.headers.location, url).toString();
        res.destroy();
        return requestWithRedirect(next, opts, depth + 1);
    }
    return { res, finalUrl };
}

/**
 * 拉取文本
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @returns {Promise<{text:string, finalUrl:string, contentType:string}>}
 */
async function fetchText(url, opts) {
    const { res, finalUrl } = await requestWithRedirect(url, opts || {});
    if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        throw new Error(`HTTP ${res.statusCode} for ${url}`);
    }
    const chunks = [];
    for await (const c of res) chunks.push(c);
    const buf = Buffer.concat(chunks);
    return {
        text: buf.toString('utf8'),
        finalUrl,
        contentType: res.headers['content-type'] || '',
    };
}

/**
 * 拉取完整 Buffer
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @returns {Promise<{buffer:Buffer, finalUrl:string, contentType:string, size:number}>}
 */
async function fetchBuffer(url, opts) {
    const { res, finalUrl } = await requestWithRedirect(url, opts || {});
    if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        throw new Error(`HTTP ${res.statusCode} for ${url}`);
    }
    const chunks = [];
    let size = 0;
    for await (const c of res) { chunks.push(c); size += c.length; }
    return {
        buffer: Buffer.concat(chunks),
        finalUrl,
        contentType: res.headers['content-type'] || '',
        size,
    };
}

module.exports = {
    fetchText,
    fetchBuffer,
    fetcherLog: log,
};
