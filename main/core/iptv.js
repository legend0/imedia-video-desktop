/**
 * 电视直播（IPTV）模块
 * 负责订阅地址管理、M3U 解析、频道缓存
 * 缓存策略：永久有效，仅在用户手动「订阅更新」时刷新
 */
const { read, write } = require('../utils/files');
const httpUtil = require('../utils/http');
const settings = require('./settings');
const logger = require('../utils/log');

/** 频道缓存存储键（storage/videoApp/iptvChannels.json） */
const CACHE_KEY = 'videoApp.iptvChannels';

/** 订阅地址设置键 */
const URL_SETTING_KEY = 'iptv.subscriptionUrl';

/** 默认订阅地址 */
const DEFAULT_SUBSCRIPTION_URL = '';

/**
 * 尝试对 Base64 编码的订阅地址解码
 * 仅当解码结果为合法 URL（http/https 开头）时认为原值是 Base64 编码
 * @param {string} str - 待检测的字符串
 * @returns {string} 解码后的真实 URL；若非 Base64 则返回原值
 */
function tryDecodeBase64Url(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!trimmed) return '';

  // 已是 http(s) URL，无需解码
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Base64 特征：仅含 A-Za-z0-9+/= 且长度合理（>20，避免误判短字符串）
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length < 20) return trimmed;

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    // 解码结果必须是 http(s) URL 才认定原值为 Base64
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * 规范化已解码的订阅地址用于拉取
 * 1. 补全协议；2. gitee/github blob 转 raw（blob 页面是 HTML，无法直接拿到 m3u8 文本）
 * @param {string} url - 已经过 Base64 解码的真实 URL
 * @returns {string} 可直接请求的 URL
 */
function normalizeForFetch(url) {
  if (!url) return '';

  let normalized = url;

  // 补全协议
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized;
  }

  // gitee / github blob 页面转为 raw 地址
  normalized = normalized.replace('/blob/', '/raw/');

  return normalized;
}

/**
 * 解析 #EXTINF 行的属性与频道名
 * 示例：#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV1" tvg-logo="http://x.png" group-title="央视",CCTV-1综合
 * @param {string} line - EXTINF 行内容
 * @returns {{ attrs: Object<string,string>, name: string }}
 */
function parseExtInf(line) {
  const result = { attrs: {}, name: '' };
  // 去掉 #EXTINF: 前缀（含可选的 duration）
  const rest = line.replace(/^#EXTINF:-?\d*/i, '');
  // 逗号分隔属性区与频道名
  const commaIdx = rest.lastIndexOf(',');
  const attrPart = commaIdx >= 0 ? rest.slice(0, commaIdx) : rest;
  result.name = commaIdx >= 0 ? rest.slice(commaIdx + 1).trim() : '';

  // 解析 key="value" 属性
  const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(attrPart)) !== null) {
    result.attrs[m[1].toLowerCase()] = m[2];
  }
  return result;
}

/**
 * 尝试对 Base64 编码的 M3U8 内容解码
 * 检测策略：若文本不以 #EXTM3U / #EXTINF 开头（即非明文 M3U8），
 * 且整体符合 Base64 字符集特征，则尝试解码；解码后若以 #EXTM3U / #EXTINF 开头则认定原内容为 Base64 编码
 * @param {string} text - 远程拉取的原始文本
 * @returns {string} 解码后的 M3U8 文本；若非 Base64 则返回原文本
 */
function tryDecodeBase64Content(text) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return text;

  // 已是明文 M3U8，无需解码
  if (trimmed.startsWith('#EXTM3U') || trimmed.startsWith('#EXTINF')) return text;

  // 移除换行符后检测 Base64 字符集（允许换行、回车、空格）
  const stripped = trimmed.replace(/[\r\n\s]/g, '');
  if (!stripped) return text;

  // Base64 字符集：A-Za-z0-9+/= ，且长度需足够（>20，避免短字符串误判）
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped) || stripped.length < 20) return text;

  try {
    const decoded = Buffer.from(stripped, 'base64').toString('utf-8');
    // 解码后必须以 #EXTM3U 或 #EXTINF 开头才认定原内容为 Base64 编码
    const decodedTrimmed = decoded.trim();
    if (decodedTrimmed.startsWith('#EXTM3U') || decodedTrimmed.startsWith('#EXTINF')) {
      return decoded;
    }
    return text;
  } catch {
    return text;
  }
}

/**
 * 解析 M3U/M3U8 播放列表文本，提取频道列表与分组
 * @param {string} text - M3U 原始文本
 * @returns {{ channels: Array<{name:string,url:string,group:string,logo:string,tvgId:string,tvgName:string}>, groups: string[] }}
 */
function parseM3U(text) {
  const channels = [];
  const groupSet = new Set();

  if (!text || typeof text !== 'string') {
    return { channels, groups: [] };
  }

  const lines = text.split(/\r?\n/);
  let pendingInfo = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      pendingInfo = parseExtInf(line);
    } else if (line.startsWith('#EXTM3U') || line.startsWith('#EXT-X-')) {
      // 头声明或其他指令行，跳过
      continue;
    } else if (line.startsWith('#')) {
      // 其他注释行，跳过
      continue;
    } else {
      // 非 # 开头视为播放地址
      if (pendingInfo) {
        const group = pendingInfo.attrs['group-title'] || '未分组';
        const channel = {
          name: pendingInfo.name || pendingInfo.attrs['tvg-name'] || '未知频道',
          url: line,
          group,
          logo: pendingInfo.attrs['tvg-logo'] || '',
          tvgId: pendingInfo.attrs['tvg-id'] || '',
          tvgName: pendingInfo.attrs['tvg-name'] || '',
        };
        channels.push(channel);
        groupSet.add(group);
        pendingInfo = null;
      } else {
        // 无 EXTINF 前导的裸 URL，仍收录为未分组频道
        channels.push({
          name: `频道 ${channels.length + 1}`,
          url: line,
          group: '未分组',
          logo: '',
          tvgId: '',
          tvgName: '',
        });
        groupSet.add('未分组');
      }
    }
  }

  const groups = Array.from(groupSet);
  return { channels, groups };
}

/**
 * 获取当前订阅地址（未设置时返回默认地址）
 * @returns {Promise<string>}
 */
async function getSubscriptionUrl() {
  const stored = await settings.getSetting(URL_SETTING_KEY);
  if (stored && typeof stored === 'string' && stored.trim()) return stored;
  return DEFAULT_SUBSCRIPTION_URL;
}

/**
 * 保存订阅地址
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function setSubscriptionUrl(url) {
  return await settings.setSetting(URL_SETTING_KEY, url);
}

/**
 * 读取缓存的频道数据（永久缓存，直至手动更新）
 * @returns {Promise<{channels:Array,groups:string[],updatedAt:number,url:string}|null>}
 */
async function getCachedData() {
  return await read(CACHE_KEY, null);
}

/**
 * 获取缓存的频道列表
 * @returns {Promise<Array>}
 */
async function getChannels() {
  const data = await getCachedData();
  return data && Array.isArray(data.channels) ? data.channels : [];
}

/**
 * 获取缓存的分组列表
 * @returns {Promise<string[]>}
 */
async function getGroups() {
  const data = await getCachedData();
  return data && Array.isArray(data.groups) ? data.groups : [];
}

/**
 * 订阅更新核心流程：
 * 1. 先检查订阅地址是否为 Base64 编码，若是则解码为真实 URL
 * 2. 规范化用于拉取的 URL（补全协议、gitee blob 转 raw）
 * 3. 远程拉取 M3U 数据
 * 4. 检查 M3U8 内容是否为 Base64 编码，若是则解码为明文 M3U8
 * 5. 解析频道与分组
 * 6. 持久化缓存（永久有效）— 保存解码后的真实 URL
 * 7. 持久化订阅地址 — 保存解码后的真实 URL
 * @param {string} rawUrl - 用户输入的订阅地址（可能为 Base64 编码）
 * @returns {Promise<{success:boolean, data?:{count:number,groups:number}, error?:string}>}
 */
async function updateSubscription(rawUrl) {
  try {
    const inputUrl = (rawUrl || '').trim();
    if (!inputUrl) {
      return { success: false, error: '订阅地址不能为空' };
    }

    // 1. 先检查是否为 Base64 编码，若是则解码为真实 URL
    const decodedUrl = tryDecodeBase64Url(inputUrl);
    if (decodedUrl !== inputUrl) {
      logger.info(`[IPTV] 检测到 Base64 编码地址，已解码: ${inputUrl} → ${decodedUrl}`);
    } else {
      logger.info(`[IPTV] 订阅地址非 Base64 编码，直接使用: ${decodedUrl}`);
    }

    // 2. 规范化用于拉取的 URL（补全协议、gitee blob 转 raw）
    const fetchUrl = normalizeForFetch(decodedUrl);

    logger.info(`[IPTV] 开始拉取订阅: ${fetchUrl}`);

    // 远程拉取（按文本解析，M3U 非 JSON）
    const text = await httpUtil.get(fetchUrl, {
      timeout: 20000,
      responseType: 'text',
      enableRetry: true,
      maxRetries: 2,
    });

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return { success: false, error: '订阅地址返回空数据，请检查地址是否有效' };
    }

    // 非 M3U 格式检测：若返回 HTML（如 gitee blob 页面未转 raw），提示无效
    const head = text.trim().slice(0, 200).toLowerCase();
    if (head.includes('<!doctype html') || head.includes('<html')) {
      return { success: false, error: '订阅地址返回的是网页而非 M3U8 数据，请使用 raw 原始地址' };
    }

    // 3. 检查 M3U8 内容是否为 Base64 编码，若是则解码为明文 M3U8
    const m3uText = tryDecodeBase64Content(text);
    if (m3uText !== text) {
      logger.info('[IPTV] 检测到 M3U8 内容为 Base64 编码，已解码为明文 M3U8');
    }

    const { channels, groups } = parseM3U(m3uText);

    if (channels.length === 0) {
      return { success: false, error: '当前订阅无可用频道' };
    }

    // 持久化缓存（永久有效，不设过期）— 保存解码后的真实 URL
    const cacheData = {
      channels,
      groups,
      updatedAt: Date.now(),
      url: decodedUrl,
    };
    await write(CACHE_KEY, cacheData);

    // 持久化订阅地址（保存解码后的真实 URL，避免下次仍显示 Base64 编码串）
    await setSubscriptionUrl(decodedUrl);

    logger.info(`[IPTV] 订阅更新成功：频道 ${channels.length} 个，分组 ${groups.length} 个`);

    return {
      success: true,
      data: { count: channels.length, groups: groups.length },
    };
  } catch (error) {
    logger.error(`[IPTV] 订阅更新失败: ${error.message}`);
    return { success: false, error: error.message || '订阅地址无效，请检查后重试' };
  }
}

module.exports = {
  getSubscriptionUrl,
  setSubscriptionUrl,
  updateSubscription,
  getChannels,
  getGroups,
  getCachedData,
  parseM3U,
  normalizeForFetch,
  tryDecodeBase64Url,
  tryDecodeBase64Content,
  DEFAULT_SUBSCRIPTION_URL,
};
