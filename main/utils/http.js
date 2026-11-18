/**
 * HTTP 请求工具
 */
const axios = require('axios');
const crypto = require('crypto');
const logger = require('./log');

// 更真实的浏览器请求头
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Sec-Ch-Ua': '"Not A;Brand";v="99", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Connection': 'keep-alive'
};

/** 缓存的全局网络配置（UA + 代理），由 settings 模块变更时刷新 */
let globalNetworkConfig = { userAgent: '', proxy: null };

/**
 * 初始化或刷新全局网络配置（UA + 代理）
 * 由 main 进程启动时调用一次，并在 settings 变更时调用
 * @param {Object} [config] - 网络配置；不传则从 settings 读取
 * @returns {Promise<void>}
 */
async function refreshNetworkConfig(config) {
  try {
    if (!config) {
      const settings = require('../core/settings');
      const network = (await settings.getSetting('network', {})) || {};
      config = network;
    }
    const ua = (config.userAgent || '').trim();
    const proxy = config.proxy;
    let proxyConfig = null;
    if (proxy && proxy.enabled && proxy.host && proxy.port) {
      proxyConfig = { host: proxy.host, port: proxy.port };
      if (proxy.username) {
        proxyConfig.auth = { username: proxy.username, password: proxy.password || '' };
      }
    }
    globalNetworkConfig = { userAgent: ua, proxy: proxyConfig };
    logger.info(`[网络] 全局配置已刷新：UA=${ua ? '已设置' : '默认'}，代理=${proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : '未启用'}`);
  } catch (error) {
    logger.warn(`[网络] 刷新全局配置失败: ${error.message}`);
  }
}

/**
 * 获取当前用户代理（已设置则返回用户 UA，否则返回默认）
 * @returns {string} User-Agent 字符串
 */
function getUserAgent() {
  return globalNetworkConfig.userAgent || DEFAULT_HEADERS['User-Agent'];
}

/**
 * 获取当前代理配置（未启用返回 false，启用返回 axios proxy 对象）
 * @returns {Object|boolean} axios proxy 配置
 */
function getProxyConfig() {
  return globalNetworkConfig.proxy || false;
}

/**
 * 构建合并了全局 UA 的请求头
 * @param {Object} [extraHeaders] - 额外的请求头
 * @returns {Object} 合并后的请求头
 */
function buildHeaders(extraHeaders) {
  const headers = { ...DEFAULT_HEADERS };
  if (globalNetworkConfig.userAgent) {
    headers['User-Agent'] = globalNetworkConfig.userAgent;
  }
  return { ...headers, ...(extraHeaders || {}) };
}

// 随机延迟函数，模拟人类行为（仅在显式传 simulateHuman: true 时启用）
function randomDelay(min = 100, max = 500) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/** 退避上限（毫秒），避免重试退避累积过长 */
const MAX_BACKOFF_DELAY = 3000;

/**
 * 判断错误是否可重试（网络错误、5xx、超时）
 * @param {Error & {code?: string, response?: {status?: number}}} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  if (!error) return false;
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') return true;
  if (error.message && error.message.includes('timeout')) return true;
  const status = error.response && error.response.status;
  if (status !== undefined) {
    if (status >= 500 && status < 600) return true;
    if (status === 429) return true;
    return false; // 4xx（除 429）不可重试
  }
  return true; // 无 response 的网络错误默认可重试
}

// 通用重试机制（带退避上限 + 抖动 + 错误分类）
async function requestWithRetry(requestFn, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      // 不可重试错误（如 4xx）直接抛出，避免无谓等待
      if (!isRetryableError(error)) {
        throw error;
      }
      logger.warn(`请求失败，重试 ${i + 1}/${maxRetries}: ${error.message}`);

      if (i < maxRetries - 1) {
        // 退避加上限 + 抖动（0.5 ~ 1.0 倍），避免雪崩
        const base = delay * Math.pow(2, i);
        const capped = Math.min(base, MAX_BACKOFF_DELAY);
        const jitter = capped * (0.5 + Math.random() * 0.5);
        logger.debug(`等待 ${Math.round(jitter)}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, jitter));
      }
    }
  }

  throw lastError;
}

async function get(url, options = {}) {
  // 创建请求函数
  const makeRequest = async () => {
    // 仅在显式传 simulateHuman: true 时启用随机延迟（默认关闭，避免拖慢批量请求）
    if (options.simulateHuman === true) {
      await randomDelay();
    }

    const config = {
      method: 'get',
      url,
      headers: buildHeaders(options.headers),
      timeout: options.timeout || 10000,
      responseType: options.responseType || 'json',
      proxy: getProxyConfig()
    };

    // 如果提供了referer，添加到请求头
    if (options.referer) {
      config.headers.Referer = options.referer;
    }

    const response = await axios(config);

    // 根据选项决定返回格式
    if (options.fullResponse === true) {
      // 返回一个包含响应数据和元信息的对象
      return {
        data: response.data,
        status: response.status,
        headers: response.headers
      };
    } else {
      // 默认行为：直接返回响应数据（向后兼容）
      return response.data;
    }
  };

  try {
    return await makeRequest();
  } catch (error) {
    logger.error(`HTTP GET 请求错误: ${error.message}`);
    if (error.response) {
      logger.error(`错误响应状态: ${error.response.status}`);

      if (error.response.status === 403 && options.retryOn403 !== false) {
        // 403 切换简化头时关闭延迟（simulateHuman 已默认关闭），并支持有限次重试
        return getWithSimpleHeaders(url, { ...options, simulateHuman: false });
      }
    }

    if (options.enableRetry !== false) {
      return requestWithRetry(makeRequest, options.maxRetries || 3, options.retryDelay || 1000);
    }

    throw error;
  }
}

// 使用简化请求头的重试方法（403 场景：关闭延迟 + 最多重试 2 次）
async function getWithSimpleHeaders(url, options = {}) {
  const maxSimpleRetries = options.maxSimpleRetries !== undefined ? options.maxSimpleRetries : 2;
  let lastError;

  for (let i = 0; i <= maxSimpleRetries; i++) {
    try {
      const simpleHeaders = {
        'User-Agent': getUserAgent()
      };

      const config = {
        method: 'get',
        url,
        headers: {
          ...simpleHeaders,
          ...(options.headers || {})
        },
        timeout: options.timeout || 15000,
        responseType: options.responseType || 'json',
        proxy: getProxyConfig()
      };

      logger.debug(`HTTP GET 简化请求头重试 ${i + 1}/${maxSimpleRetries + 1}: ${url}`);
      const response = await axios(config);

      if (options.fullResponse === true) {
        return {
          data: response.data,
          status: response.status,
          headers: response.headers
        };
      } else {
        return response.data;
      }
    } catch (error) {
      lastError = error;
      // 4xx 错误（除 429）不再重试
      if (!isRetryableError(error)) {
        logger.error(`简化请求头重试遇到不可重试错误: ${error.message}`);
        throw error;
      }
      if (i < maxSimpleRetries) {
        const base = 1000 * Math.pow(2, i);
        const capped = Math.min(base, MAX_BACKOFF_DELAY);
        const jitter = capped * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, jitter));
      }
    }
  }

  logger.error(`简化请求头重试失败: ${lastError.message}`);
  throw lastError;
}

async function post(url, data, options = {}) {
  try {
    const config = {
      method: 'post',
      url,
      data,
      headers: {
        'Content-Type': 'application/json',
        ...buildHeaders(options.headers)
      },
      timeout: options.timeout || 10000,
      proxy: getProxyConfig()
    };

    const response = await axios(config);

    // 根据选项决定返回格式
    if (options.fullResponse === true) {
      // 返回一个包含响应数据和元信息的对象
      return {
        data: response.data,
        status: response.status,
        headers: response.headers
      };
    } else {
      // 默认行为：直接返回响应数据（向后兼容）
      return response.data;
    }
  } catch (error) {
    throw error;
  }
}

// 生成签名
function generateSignature(data, secret, algorithm = 'md5') {
  if (algorithm === 'md5') {
    return crypto.createHash('md5').update(data + secret).digest('hex');
  } else if (algorithm === 'sha1') {
    return crypto.createHash('sha1').update(data + secret).digest('hex');
  } else if (algorithm === 'sha256') {
    return crypto.createHash('sha256').update(data + secret).digest('hex');
  } else {
    throw new Error(`不支持的签名算法: ${algorithm}`);
  }
}

module.exports = {
  get,
  post,
  generateSignature,
  requestWithRetry,
  refreshNetworkConfig,
  getUserAgent,
  getProxyConfig,
  buildHeaders,
  isRetryableError
};