/**
 * 文件存储工具
 * 传入两个参数：项目根目录名.存储文件名，存储数据
 * 存储数据内容到"项目根目录名.存储文件名.json"
 * 读取时传入"项目根目录名.存储文件名"即可
 * 
 * 优化版本特点：
 * 1. 懒加载目录创建
 * 2. 路径缓存避免重复计算
 * 3. 真正的异步API
 * 4. 并发写入锁机制
 * 5. 可配置的存储选项
 */

const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const { app } = require('electron');
const logger = require('./log');

const isPackaged = app.isPackaged
  || !process.execPath.includes('node_modules\\electron')
  && !process.execPath.includes('node_modules/electron');

const APP_ROOT = isPackaged
  ? path.dirname(app.getPath('exe'))
  : process.cwd();

const STORAGE_DIR = path.join(APP_ROOT, 'storage');
const LOG_DIR = path.join(APP_ROOT, 'storage', 'logs');
const DOWNLOAD_DIR = path.join(APP_ROOT, 'downloads');

// 缓存文件路径和目录创建状态
const filePathCache = new Map();
let isDirEnsured = false;

// 写入锁，防止并发写入同一文件
const writeLocks = new Map();

/**
 * 确保存储目录存在（懒加载）
 * @returns {Promise<void>}
 */
async function ensureStorageDir() {
  if (isDirEnsured) return;
  
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    isDirEnsured = true;
  } catch (error) {
    // 如果目录已存在，忽略错误
    if (error.code !== 'EEXIST') {
      throw error;
    }
    isDirEnsured = true;
  }
}

/**
 * 获取文件路径
 * @param {string} key - 项目根目录名.存储文件名
 * @returns {string} 文件路径
 */
function getFilePath(key) {
  if (filePathCache.has(key)) {
    return filePathCache.get(key);
  }
  
  // 验证key格式
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new Error('Invalid key: key must be a non-empty string');
  }
  
  // 清理key，移除非法字符，保留点作为分隔符
  const cleanKey = key
    .replace(/[<>:"/\\|?*]/g, '_')  // 替换Windows非法字符
    .replace(/^\.+|\.+$/g, '')      // 移除开头和结尾的点
    .replace(/\.{2,}/g, '.')        // 将多个点替换为单个点
    .trim();
  
  // 将点替换为路径分隔符，支持目录结构
  const relativePath = cleanKey.replace(/\./g, '/');
  const filePath = path.join(STORAGE_DIR, `${relativePath}.json`);
  
  filePathCache.set(key, filePath);
  return filePath;
}

/**
 * 获取写入锁
 * @param {string} filePath - 文件路径
 * @returns {Promise<Function>} 释放锁的函数
 */
async function acquireWriteLock(filePath) {
  while (writeLocks.has(filePath)) {
    // 等待其他写入操作完成
    await writeLocks.get(filePath);
  }
  
  let release;
  const lockPromise = new Promise(resolve => {
    release = () => {
      writeLocks.delete(filePath);
      resolve();
    };
  });
  
  writeLocks.set(filePath, lockPromise);
  return release;
}

/**
 * 智能JSON序列化
 * @param {*} data - 要序列化的数据
 * @returns {string} JSON字符串
 */
function stringifyData(data) {
  try {
    // 对于大数据，使用紧凑格式节省空间
    // 对于小数据，使用格式化便于阅读
    const dataSize = Buffer.byteLength(JSON.stringify(data));
    const shouldFormat = dataSize < 1024 * 10; // 小于10KB的数据进行格式化
    
    return shouldFormat 
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
  } catch (error) {
    throw new Error(`Failed to stringify data: ${error.message}`);
  }
}

/**
 * 写入数据到文件
 * @param {string} key - 项目根目录名.存储文件名
 * @param {*} data - 要存储的数据
 * @param {Object} [options] - 写入选项
 * @param {boolean} [options.pretty] - 强制格式化JSON
 * @returns {Promise<boolean>} 是否写入成功
 */
async function write(key, data, options = {}) {
  try {
    // 输入验证
    if (data === undefined) {
      throw new Error('Data cannot be undefined');
    }
    
    await ensureStorageDir();
    const filePath = getFilePath(key);
    
    // 确保目标目录存在
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // 获取写入锁
    const releaseLock = await acquireWriteLock(filePath);
    
    try {
      // 准备写入数据
      const jsonData = options.pretty 
        ? JSON.stringify(data, null, 2)
        : stringifyData(data);
      
      // 使用流式写入，适合大数据
      if (jsonData.length > 1024 * 1024) { // 大于1MB
        await new Promise((resolve, reject) => {
          const writeStream = createWriteStream(filePath, { flags: 'w' });
          writeStream.write(jsonData);
          writeStream.end();
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      } else {
        // 小文件直接写入
        await fs.writeFile(filePath, jsonData, 'utf8');
      }
      
      return true;
    } finally {
      // 释放锁
      releaseLock();
    }
  } catch (error) {
    logger.error(`写入文件失败 ${key}: ${error.message}`);
    
    // 清理无效缓存
    if (filePathCache.has(key)) {
      filePathCache.delete(key);
    }
    
    return false;
  }
}

/**
 * 从文件读取数据
 * @param {string} key - 项目根目录名.存储文件名
 * @param {*} [defaultValue] - 默认值，当文件不存在时返回
 * @returns {Promise<*>} 存储的数据或默认值
 */
async function read(key, defaultValue = undefined) {
  try {
    await ensureStorageDir();
    const filePath = getFilePath(key);
    
    // 检查文件是否存在
    try {
      await fs.access(filePath);
    } catch {
      return defaultValue;
    }
    
    // 读取文件内容
    const data = await fs.readFile(filePath, 'utf8');
    
    // 空文件处理
    if (!data.trim()) {
      return defaultValue;
    }
    
    return JSON.parse(data);
  } catch (error) {
    // 如果是JSON解析错误，尝试恢复或返回默认值
    if (error instanceof SyntaxError) {
      logger.warn(`JSON解析失败 ${key}: ${error.message}`);
      
      // 尝试修复常见的JSON格式问题
      try {
        const filePath = getFilePath(key);
        const rawData = await fs.readFile(filePath, 'utf8');
        const fixedData = rawData
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // 修复未加引号的key
          .replace(/,\s*}/g, '}') // 修复末尾多余的逗号
          .replace(/,\s*]/g, ']'); // 修复数组末尾多余的逗号
        
        return JSON.parse(fixedData);
      } catch {
        return defaultValue;
      }
    }
    
    logger.error(`读取文件失败 ${key}: ${error.message}`);
    
    // 清理无效缓存
    if (filePathCache.has(key)) {
      filePathCache.delete(key);
    }
    
    return defaultValue;
  }
}

/**
 * 检查文件是否存在
 * @param {string} key - 项目根目录名.存储文件名
 * @returns {Promise<boolean>} 文件是否存在
 */
async function exists(key) {
  try {
    await ensureStorageDir();
    const filePath = getFilePath(key);
    
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  } catch (error) {
    logger.error(`检查文件存在失败 ${key}: ${error.message}`);
    return false;
  }
}

/**
 * 删除存储的文件
 * @param {string} key - 项目根目录名.存储文件名
 * @returns {Promise<boolean>} 是否删除成功
 */
async function remove(key) {
  try {
    await ensureStorageDir();
    const filePath = getFilePath(key);
    
    await fs.unlink(filePath);
    
    // 清理缓存
    filePathCache.delete(key);
    
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`删除文件失败 ${key}: ${error.message}`);
    }
    return false;
  }
}

/**
 * 获取所有存储的key
 * @returns {Promise<string[]>} 所有存储的key列表
 */
async function getAllKeys() {
  try {
    await ensureStorageDir();
    
    const keys = [];
    
    async function scanDir(currentPath, prefix = '') {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          await scanDir(fullPath, `${prefix}${entry.name}.`);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          const keyName = path.basename(entry.name, '.json');
          keys.push(`${prefix}${keyName}`);
        }
      }
    }
    
    await scanDir(STORAGE_DIR);
    return keys;
  } catch (error) {
    logger.error(`获取所有key失败: ${error.message}`);
    return [];
  }
}

/**
 * 确保应用所有核心目录存在
 * 在应用启动时调用，提前创建 storage、logs、downloads 目录
 * @returns {Promise<void>}
 */
async function ensureAppDirs() {
  const dirs = [STORAGE_DIR, LOG_DIR, DOWNLOAD_DIR];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        logger.warn(`创建目录失败 ${dir}: ${error.message}`);
      }
    }
  }
  isDirEnsured = true;
}

module.exports = {
  write,
  read,
  exists,
  remove,
  getAllKeys,
  ensureAppDirs,
  APP_ROOT,
  STORAGE_DIR,
  LOG_DIR,
  DOWNLOAD_DIR
};