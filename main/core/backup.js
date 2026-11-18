/**
 * 备份模块
 * 提供数据导出/导入、本地备份记录管理、WebDAV 云备份功能。
 * 支持的数据类型：settings / sources / history / favorites
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { app, dialog } = require('electron');
const files = require('../utils/files');
const settings = require('./settings');
const logger = require('../utils/log');

/** 数据类型 → 存储 key 映射 */
const DATA_TYPE_KEYS = {
  settings: 'videoApp.settings',
  sources: 'videoApp.sources',
  history: 'videoApp.history',
  favorites: 'videoApp.favorites',
};

/** 备份目录（本地） */
const BACKUP_DIR = path.join(files.STORAGE_DIR, 'videoApp', 'backups');
/** 本地备份清单文件 */
const MANIFEST_KEY = 'videoApp.backupManifest';

/**
 * 收集指定数据类型的存储内容
 * @param {string[]} dataTypes - 需要收集的数据类型数组
 * @returns {Promise<Object>} 以数据类型为 key 的数据对象
 */
async function collectData(dataTypes) {
  const data = {};
  for (const type of dataTypes) {
    const storageKey = DATA_TYPE_KEYS[type];
    if (!storageKey) continue;
    try {
      data[type] = await files.read(storageKey, null);
    } catch (error) {
      logger.warn(`[备份] 读取 ${type} 数据失败: ${error.message}`);
      data[type] = null;
    }
  }
  return data;
}

/**
 * 构建备份文件内容
 * @param {string[]} dataTypes - 需要包含的数据类型
 * @returns {Promise<Object>} 备份对象
 */
async function buildBackupPayload(dataTypes) {
  const validTypes = dataTypes.filter((t) => DATA_TYPE_KEYS[t]);
  const data = await collectData(validTypes);
  return {
    version: '1.0',
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    dataTypes: validTypes,
    data,
  };
}

/**
 * 将备份数据恢复到存储
 * @param {Object} payload - 备份对象
 * @param {string[]} dataTypes - 仅恢复这些类型（为空则恢复 payload 中所有类型）
 * @returns {Promise<string[]>} 实际恢复的数据类型列表
 */
async function restoreFromPayload(payload, dataTypes) {
  if (!payload || !payload.data) throw new Error('无效的备份文件格式');
  const typesToRestore = (dataTypes && dataTypes.length > 0)
    ? dataTypes.filter((t) => DATA_TYPE_KEYS[t] && payload.data[t] !== undefined)
    : Object.keys(payload.data).filter((t) => DATA_TYPE_KEYS[t]);
  const restored = [];
  for (const type of typesToRestore) {
    const storageKey = DATA_TYPE_KEYS[type];
    try {
      await files.write(storageKey, payload.data[type]);
      restored.push(type);
    } catch (error) {
      logger.error(`[备份] 恢复 ${type} 失败: ${error.message}`);
    }
  }
  // 恢复设置后通知设置变更，触发网络配置等监听器刷新
  if (restored.includes('settings')) {
    try { settings.emit('settingsChanged', { key: 'network', value: null, oldValue: null }); } catch { /* 忽略 */ }
  }
  return restored;
}

/**
 * 生成备份文件名
 * @param {string[]} dataTypes - 数据类型
 * @returns {string} 文件名，如 backup_20260717_120000_settings_history.json
 */
function generateFileName(dataTypes) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const typePart = dataTypes.length > 0 ? dataTypes.join('-') : 'all';
  return `backup_${ts}_${typePart}.json`;
}

/**
 * 确保备份目录存在
 * @returns {Promise<void>}
 */
async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/**
 * 读取本地备份清单
 * @returns {Promise<Array>} 备份记录列表
 */
async function readManifest() {
  return (await files.read(MANIFEST_KEY, [])) || [];
}

/**
 * 写入本地备份清单
 * @param {Array} manifest - 备份记录列表
 * @returns {Promise<void>}
 */
async function writeManifest(manifest) {
  await files.write(MANIFEST_KEY, manifest);
}

/**
 * 导出数据到用户选择的文件
 * @param {string[]} dataTypes - 需要导出的数据类型
 * @returns {Promise<{success: boolean, data?: {filePath: string}, error?: string}>}
 */
async function exportToFile(dataTypes) {
  try {
    if (!Array.isArray(dataTypes) || dataTypes.length === 0) {
      return { success: false, error: '请至少选择一种数据类型' };
    }
    const payload = await buildBackupPayload(dataTypes);
    const fileName = generateFileName(dataTypes);
    const result = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: fileName,
      filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消' };
    }
    await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    logger.info(`[备份] 已导出到文件: ${result.filePath}`);
    return { success: true, data: { filePath: result.filePath } };
  } catch (error) {
    logger.error(`[备份] 导出失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 从用户选择的文件导入数据
 * @param {string[]} dataTypes - 需要恢复的数据类型（为空则恢复全部）
 * @returns {Promise<{success: boolean, data?: {restored: string[]}, error?: string}>}
 */
async function importFromFile(dataTypes) {
  try {
    const result = await dialog.showOpenDialog({
      title: '导入备份',
      filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '用户取消' };
    }
    const raw = await fs.readFile(result.filePaths[0], 'utf8');
    const payload = JSON.parse(raw);
    const restored = await restoreFromPayload(payload, dataTypes || []);
    logger.info(`[备份] 已从文件导入，恢复类型: ${restored.join(', ')}`);
    return { success: true, data: { restored } };
  } catch (error) {
    logger.error(`[备份] 导入失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 创建本地备份记录
 * @param {string[]} dataTypes - 需要备份的数据类型
 * @returns {Promise<{success: boolean, data?: {id: string, fileName: string}, error?: string}>}
 */
async function createLocalBackup(dataTypes) {
  try {
    if (!Array.isArray(dataTypes) || dataTypes.length === 0) {
      return { success: false, error: '请至少选择一种数据类型' };
    }
    await ensureBackupDir();
    const payload = await buildBackupPayload(dataTypes);
    const fileName = generateFileName(dataTypes);
    const filePath = path.join(BACKUP_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    const stat = await fs.stat(filePath);
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const manifest = await readManifest();
    manifest.unshift({
      id,
      fileName,
      dataTypes,
      createdAt: payload.createdAt,
      size: stat.size,
      source: 'local',
    });
    await writeManifest(manifest);
    logger.info(`[备份] 本地备份已创建: ${fileName}`);
    return { success: true, data: { id, fileName } };
  } catch (error) {
    logger.error(`[备份] 创建本地备份失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 获取本地备份记录列表
 * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
 */
async function getLocalBackups() {
  try {
    const manifest = await readManifest();
    return { success: true, data: manifest };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 删除本地备份记录
 * @param {string} id - 备份记录 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteLocalBackup(id) {
  try {
    const manifest = await readManifest();
    const record = manifest.find((r) => r.id === id);
    if (!record) return { success: false, error: '备份记录不存在' };
    const filePath = path.join(BACKUP_DIR, record.fileName);
    try { await fs.unlink(filePath); } catch { /* 文件可能已不存在 */ }
    const updated = manifest.filter((r) => r.id !== id);
    await writeManifest(updated);
    logger.info(`[备份] 已删除本地备份: ${record.fileName}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 下载（另存）本地备份到用户选择的位置
 * @param {string} id - 备份记录 ID
 * @returns {Promise<{success: boolean, data?: {filePath: string}, error?: string}>}
 */
async function downloadLocalBackup(id) {
  try {
    const manifest = await readManifest();
    const record = manifest.find((r) => r.id === id);
    if (!record) return { success: false, error: '备份记录不存在' };
    const srcPath = path.join(BACKUP_DIR, record.fileName);
    const result = await dialog.showSaveDialog({
      title: '下载备份',
      defaultPath: record.fileName,
      filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: '用户取消' };
    await fs.copyFile(srcPath, result.filePath);
    return { success: true, data: { filePath: result.filePath } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/* ==================== WebDAV 云备份 ==================== */

/**
 * 获取 WebDAV 配置
 * @returns {Promise<Object>} WebDAV 配置对象
 */
async function getWebDAVConfig() {
  return (await settings.getSetting('backup.webdav', {
    enabled: false,
    url: '',
    username: '',
    password: '',
    basePath: '/videoApp-backups/',
  })) || {};
}

/**
 * 保存 WebDAV 配置
 * @param {Object} config - WebDAV 配置
 * @returns {Promise<boolean>}
 */
async function setWebDAVConfig(config) {
  return await settings.setSetting('backup.webdav', config);
}

/**
 * 构建 WebDAV 客户端 axios 实例
 * @param {Object} config - WebDAV 配置
 * @returns {Object} axios 实例
 */
function createWebDAVClient(config) {
  const baseURL = (config.url || '').replace(/\/+$/, '');
  if (!baseURL) throw new Error('WebDAV 地址未配置');
  const basePath = config.basePath || '/';
  const fullBase = baseURL + (basePath.startsWith('/') ? basePath : '/' + basePath);
  const auth = (config.username || config.password)
    ? { username: config.username || '', password: config.password || '' }
    : undefined;
  return axios.create({
    baseURL: fullBase,
    timeout: 30000,
    auth,
    headers: { 'User-Agent': 'videoApp/1.0' },
  });
}

/**
 * 测试 WebDAV 连接
 * @param {Object} config - WebDAV 配置（若不传则从设置读取）
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testWebDAV(config) {
  try {
    const cfg = config || await getWebDAVConfig();
    const client = createWebDAVClient(cfg);
    // PROPFIND 深度 0 测试根目录可访问性
    await client.request('PROPFIND', '', `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:"><prop><displayname/></prop></propfind>`, {
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
    });
    return { success: true };
  } catch (error) {
    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    logger.warn(`[备份] WebDAV 测试失败: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * 确保 WebDAV 远程备份目录存在
 * @param {Object} client - axios 实例
 * @returns {Promise<void>}
 */
async function ensureWebDAVDir(client) {
  try {
    await client.request('MKCOL', '');
  } catch (error) {
    // 405/409 通常表示目录已存在，忽略
    if (error.response && ![405, 409, 301].includes(error.response.status)) {
      logger.warn(`[备份] WebDAV 创建目录失败: ${error.message}`);
    }
  }
}

/**
 * 上传备份到 WebDAV
 * @param {string[]} dataTypes - 需要备份的数据类型
 * @returns {Promise<{success: boolean, data?: {fileName: string}, error?: string}>}
 */
async function uploadToWebDAV(dataTypes) {
  try {
    if (!Array.isArray(dataTypes) || dataTypes.length === 0) {
      return { success: false, error: '请至少选择一种数据类型' };
    }
    const cfg = await getWebDAVConfig();
    if (!cfg.enabled || !cfg.url) {
      return { success: false, error: 'WebDAV 未启用或地址未配置' };
    }
    const client = createWebDAVClient(cfg);
    await ensureWebDAVDir(client);
    const payload = await buildBackupPayload(dataTypes);
    const fileName = generateFileName(dataTypes);
    await client.put(fileName, JSON.stringify(payload, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
    logger.info(`[备份] WebDAV 上传成功: ${fileName}`);
    return { success: true, data: { fileName } };
  } catch (error) {
    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    logger.error(`[备份] WebDAV 上传失败: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * 列出 WebDAV 上的备份文件
 * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
 */
async function listWebDAVBackups() {
  try {
    const cfg = await getWebDAVConfig();
    if (!cfg.url) return { success: false, error: 'WebDAV 地址未配置' };
    const client = createWebDAVClient(cfg);
    const response = await client.request('PROPFIND', '', `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <displayname/>
    <getcontentlength/>
    <getlastmodified/>
    <resourcetype/>
  </prop>
</propfind>`, {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    });
    const items = parseWebDAVPropfind(response.data);
    // 排除根目录本身，仅返回 .json 文件
    const backups = items.filter(
      (item) => !item.isCollection && item.name.endsWith('.json')
    ).map((item) => ({
      id: `webdav_${item.name}`,
      fileName: item.name,
      size: item.size || 0,
      lastModified: item.lastModified || '',
      source: 'webdav',
    }));
    return { success: true, data: backups };
  } catch (error) {
    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    return { success: false, error: msg };
  }
}

/**
 * 解析 WebDAV PROPFIND 响应
 * @param {string} xmlBody - XML 响应体
 * @returns {Array} 解析后的文件列表
 */
function parseWebDAVPropfind(xmlBody) {
  if (typeof xmlBody !== 'string') return [];
  const items = [];
  // 简单正则解析各 response 节点
  const responseRegex = /<response[^>]*>([\s\S]*?)<\/response>/gi;
  let match;
  while ((match = responseRegex.exec(xmlBody)) !== null) {
    const block = match[1];
    const hrefMatch = block.match(/<href[^>]*>([^<]*)<\/href>/i);
    const name = hrefMatch ? decodeURIComponent(hrefMatch[1].split('/').pop() || '') : '';
    const isCollection = /<collection\s*\/>/i.test(block);
    const sizeMatch = block.match(/<getcontentlength[^>]*>([^<]*)<\/getcontentlength>/i);
    const modifiedMatch = block.match(/<getlastmodified[^>]*>([^<]*)<\/getlastmodified>/i);
    items.push({
      name,
      isCollection,
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
      lastModified: modifiedMatch ? modifiedMatch[1] : '',
    });
  }
  return items;
}

/**
 * 从 WebDAV 下载备份并恢复
 * @param {string} fileName - WebDAV 上的文件名
 * @param {string[]} dataTypes - 需要恢复的数据类型（为空则恢复全部）
 * @returns {Promise<{success: boolean, data?: {restored: string[]}, error?: string}>}
 */
async function downloadFromWebDAV(fileName, dataTypes) {
  try {
    const cfg = await getWebDAVConfig();
    if (!cfg.url) return { success: false, error: 'WebDAV 地址未配置' };
    const client = createWebDAVClient(cfg);
    const response = await client.get(fileName, { responseType: 'text' });
    const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    const restored = await restoreFromPayload(payload, dataTypes || []);
    logger.info(`[备份] WebDAV 恢复成功: ${fileName}, 类型: ${restored.join(', ')}`);
    return { success: true, data: { restored } };
  } catch (error) {
    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    return { success: false, error: msg };
  }
}

/**
 * 删除 WebDAV 上的备份文件
 * @param {string} fileName - WebDAV 上的文件名
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteFromWebDAV(fileName) {
  try {
    const cfg = await getWebDAVConfig();
    if (!cfg.url) return { success: false, error: 'WebDAV 地址未配置' };
    const client = createWebDAVClient(cfg);
    await client.delete(fileName);
    logger.info(`[备份] WebDAV 已删除: ${fileName}`);
    return { success: true };
  } catch (error) {
    const msg = error.response
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.message;
    return { success: false, error: msg };
  }
}

module.exports = {
  DATA_TYPE_KEYS,
  exportToFile,
  importFromFile,
  createLocalBackup,
  getLocalBackups,
  deleteLocalBackup,
  downloadLocalBackup,
  getWebDAVConfig,
  setWebDAVConfig,
  testWebDAV,
  uploadToWebDAV,
  listWebDAVBackups,
  downloadFromWebDAV,
  deleteFromWebDAV,
};
