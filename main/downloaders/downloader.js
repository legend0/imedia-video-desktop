/**
 * 核心下载模块
 * 负责 M3U8 解析、分片下载、队列管理和转码合并
 */
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const async = require('async');
const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const { Parser } = require('m3u8-parser');
const taskManager = require('./task-manager');
const settings = require('../core/settings');
const logger = require('../utils/log');
const timeEstimator = require('./time-estimator');
const httpUtil = require('../utils/http');

let segmentQueue = null;

/** 当前任务并发数（init 时从设置读取） */
let taskConcurrency = 5;
/** 当前分片并发数（init 时从设置读取） */
let segmentConcurrency = 5;

/**
 * 根据 CPU 核心数自动计算并发数（最少 2，最多 8）
 * @returns {number} 自动并发数
 */
function getAutoConcurrency() {
  const cpus = os.cpus().length || 4;
  return Math.max(2, Math.min(8, cpus));
}

/**
 * 从设置中读取并发配置并更新队列
 */
async function loadConcurrencySettings() {
  try {
    const taskVal = await settings.getSetting('download.maxConcurrentTasks', 0);
    const segVal = await settings.getSetting('download.maxConcurrentSegments', 0);
    taskConcurrency = taskVal > 0 ? taskVal : getAutoConcurrency();
    segmentConcurrency = segVal > 0 ? segVal : getAutoConcurrency();
    downloadQueue.concurrency = taskConcurrency;
    logger.info(`下载并发配置：任务=${taskConcurrency}，分片=${segmentConcurrency}`);
  } catch (error) {
    logger.warn(`读取下载并发设置失败，使用默认值: ${error.message}`);
  }
}

/**
 * 手动解析 M3U8 内容中的 #EXT-X-KEY 标签
 * @param {string} content - M3U8 内容
 * @returns {object|null} 密钥信息对象
 */
function parseKeyFromContent(content) {
  const keyRegex = /#EXT-X-KEY:([^\n]+)/;
  const match = content.match(keyRegex);
  if (!match) return null;

  const keyLine = match[1];
  const keyInfo = {};

  // 解析 METHOD
  const methodMatch = keyLine.match(/METHOD=([^,]+)/);
  if (methodMatch) {
    keyInfo.method = methodMatch[1].trim();
  }

  // 解析 URI
  const uriMatch = keyLine.match(/URI="([^"]+)"/);
  if (uriMatch) {
    keyInfo.uri = uriMatch[1].trim();
  }

  // 解析 IV
  const ivMatch = keyLine.match(/IV=([^,]+)/);
  if (ivMatch) {
    keyInfo.iv = ivMatch[1].trim();
  }

  return (keyInfo.method && keyInfo.uri) ? keyInfo : null;
}

/**
 * 向渲染进程推送任务更新
 * @param {string} taskId - 任务ID
 */
function notifyTaskUpdate(taskId) {
  const updatedTask = taskManager.getTask(taskId);
  if (!updatedTask) return;
  // 与 task-manager.updateTask 保持一致：通知所有窗口
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('task-update', updatedTask);
    }
  });
}

const downloadQueue = async.queue((task, callback) => {
  processDownloadTask(task, callback);
}, 5);

/**
 * 检查任务是否被暂停
 * @param {string} taskId - 任务ID
 * @returns {boolean} 是否已暂停
 */
function isTaskPaused(taskId) {
  const task = taskManager.getTask(taskId);
  return task && task.status === 'paused';
}

/**
 * 检查任务状态，如果已暂停则抛出错误
 * @param {string} taskId - 任务ID
 */
function checkTaskStatus(taskId) {
  if (isTaskPaused(taskId)) {
    throw new Error('任务已被暂停');
  }
}

/**
 * 处理单个下载任务
 * 根据任务类型选择下载模式：
 * - type='ffmpeg' → FFmpeg直接下载转码
 * - type='segment'（默认）→ 分片下载后解密（如有加密）+ concat转码
 * @param {Object} task - 任务对象
 * @param {Function} callback - 队列回调
 */
async function processDownloadTask(task, callback) {
  logger.info(`[下载] 开始处理下载任务: ${task.id}`);
  logger.info(`[下载] URL: ${task.url}`);
  logger.info(`[下载] 类型: ${task.type || 'segment'}`);
  logger.info(`[下载] 保存路径: ${task.savePath}`);
  logger.info(`[下载] 文件名: ${task.fileName}`);

  try {
    checkTaskStatus(task.id);

    taskManager.updateTask(task.id, { status: 'downloading' });
    notifyTaskUpdate(task.id);

    const result = await parseM3U8(task.url);
    logger.info(`[下载] M3U8解析完成: 分片数=${result.segments.length}, 加密=${result.keyInfo ? '是' : '否'}`);

    if (task.type === 'ffmpeg') {
      await processFfmpegTask(task, result);
    } else {
      await processSegmentTask(task, result);
    }

    callback(null);

  } catch (error) {
    if (error.message === '任务已被暂停') {
      if (segmentQueue) {
        segmentQueue.kill();
      }
      callback(null);
      return;
    }

    logger.error(`[下载] 任务失败: ${task.id}, ${error.message}`);
    taskManager.updateTask(task.id, {
      status: 'failed',
      error: error.message
    });
    notifyTaskUpdate(task.id);
    callback(error);
  }
}

/**
 * 使用FFmpeg直接下载加密M3U8
 * FFmpeg原生处理HLS协议和密钥解密，无需手动下载分片和密钥
 * @param {Object} task - 任务对象
 * @param {Object} parseResult - M3U8解析结果
 * @param {string[]} parseResult.segments - 分片URL数组
 * @param {Object|null} parseResult.keyInfo - 密钥信息
 * @returns {Promise<void>}
 */
async function processFfmpegTask(task, parseResult) {
  checkTaskStatus(task.id);

  const taskDir = path.join(task.savePath, '.temp', task.id);
  logger.info(`[FFmpeg任务] 任务目录: ${taskDir}`);
  await fs.ensureDir(taskDir);

  taskManager.updateTask(task.id, {
    type: 'ffmpeg',
    tempDir: taskDir,
    keyInfo: parseResult.keyInfo,
    isEncrypted: true,
    totalSegments: 0,
    downloadedSegments: 0
  });
  notifyTaskUpdate(task.id);

  checkTaskStatus(task.id);

  const ffmpeg = require('./ffmpeg');
  const outputPath = path.join(task.savePath, `${sanitizeFileName(task.fileName)}.mp4`);
  logger.info(`[FFmpeg任务] 输出路径: ${outputPath}`);
  await ffmpeg.downloadWithFfmpeg(task.id, task.url, outputPath);

  checkTaskStatus(task.id);

  try {
    const stats = await fs.stat(outputPath);
    logger.info(`[FFmpeg任务] 完成: ${taskId}, 文件大小: ${stats.size} 字节`);
    taskManager.updateTask(task.id, {
      status: 'completed',
      outputPath: outputPath,
      finalSize: stats.size
    });
  } catch (error) {
    // 输出文件不存在属于异常情况（下载/转码失败/文件被外部删除等），
    // 不应标记为 completed，否则会误导用户认为下载完成可用
    logger.error(`[FFmpeg任务] 输出文件不存在，标记为失败: ${outputPath}, ${error.message}`);
    taskManager.updateTask(task.id, {
      status: 'failed',
      outputPath: outputPath,
      error: `输出文件不存在: ${error.message}`
    });
  }
  notifyTaskUpdate(task.id);

  setTimeout(async function() {
    try {
      await fs.remove(taskDir);
      logger.info(`[FFmpeg任务] 缓存目录已删除: ${taskDir}`);
    } catch (error) {
      logger.warn(`[FFmpeg任务] 删除缓存目录失败: ${error.message}`);
    }
  }, 2000);
}

/**
 * 使用分片下载方式处理M3U8（支持加密和非加密）
 * 加密M3U8：分片下载 → 下载密钥 → Node.js解密 → concat合并
 * 非加密M3U8：分片下载 → concat合并
 * @param {Object} task - 任务对象
 * @param {Object} parseResult - M3U8解析结果
 * @param {string[]} parseResult.segments - 分片URL数组
 * @param {Object|null} parseResult.keyInfo - 密钥信息
 * @returns {Promise<void>}
 */
async function processSegmentTask(task, parseResult) {
  checkTaskStatus(task.id);

  let taskDir, tempDir, listFilePath, segmentList;
  const { segments, keyInfo } = parseResult;
  const isEncrypted = keyInfo && keyInfo.uri && keyInfo.method;
  const taskDirPath = path.join(task.savePath, '.temp', task.id);
  const tempDirPath = path.join(taskDirPath, 'temp');
  const listFilePathPath = path.join(taskDirPath, 'list.json');

  logger.info(`[分片任务] 任务ID: ${task.id}`);
  logger.info(`[分片任务] 保存路径: ${task.savePath}`);
  logger.info(`[分片任务] 任务目录: ${taskDirPath}`);
  logger.info(`[分片任务] 临时目录: ${tempDirPath}`);
  logger.info(`[分片任务] 分片数: ${segments.length}, 加密: ${isEncrypted ? '是' : '否'}`);

  const taskDirExists = await fs.pathExists(taskDirPath);
  if (taskDirExists) {
    logger.info(`[分片任务] 检测到任务目录已存在，开始智能恢复: ${task.id}`);
    taskDir = taskDirPath;
    tempDir = tempDirPath;
    listFilePath = listFilePathPath;

    const listFileExists = await fs.pathExists(listFilePath);
    if (listFileExists) {
      try {
        const listData = await fs.readJson(listFilePath);
        segmentList = listData.segments || [];
        logger.info(`[分片任务] 从list.json恢复分片列表，数量: ${segmentList.length}`);

        let validationErrors = 0;
        for (let i = segmentList.length - 1; i >= 0; i--) {
          checkTaskStatus(task.id);
          const segment = segmentList[i];
          const segmentPath = path.join(tempDir, `${i}.ts`);
          const fileExists = await fs.pathExists(segmentPath);

          if (fileExists && !segment.downloaded) {
            segment.downloaded = true;
            validationErrors++;
          } else if (!fileExists && segment.downloaded) {
            segment.downloaded = false;
            validationErrors++;
          }
        }

        if (validationErrors > 0) {
          await saveSegmentList(listFilePath, segmentList, keyInfo);
        }
      } catch (error) {
        logger.error(`[分片任务] 读取list.json失败，重新创建分片列表: ${error.message}`);
        segmentList = await createOrLoadSegmentList(listFilePath, segments, task.url, task.id, keyInfo);
      }
    } else {
      segmentList = await createOrLoadSegmentList(listFilePath, segments, task.url, task.id, keyInfo);
    }
  } else {
    taskDir = taskDirPath;
    tempDir = tempDirPath;
    listFilePath = listFilePathPath;

    await fs.ensureDir(tempDir);
    logger.info(`[分片任务] 已创建临时目录: ${tempDir}`);
    segmentList = await createOrLoadSegmentList(listFilePath, segments, task.url, task.id, keyInfo);
  }

  if (isEncrypted) {
    logger.info(`[分片任务] 发现加密密钥: method=${keyInfo.method}, uri=${keyInfo.uri}`);
    try {
      const keyPath = path.join(tempDir, 'key.key');
      const keyExists = await fs.pathExists(keyPath);
      if (keyExists) {
        logger.info(`[分片任务] 密钥文件已存在，跳过下载: ${keyPath}`);
      } else {
        const downloadedKeyPath = await downloadKey(keyInfo, taskDir, tempDir, task.url);
        logger.info(`[分片任务] 密钥下载成功，保存到: ${downloadedKeyPath}`);
      }
      keyInfo.localPath = keyPath;
      await saveSegmentList(listFilePath, segmentList, keyInfo);
    } catch (error) {
      logger.error(`[分片任务] 密钥处理失败: ${error.message}`);
      throw error;
    }
  }

  taskManager.updateTask(task.id, {
    type: 'segment',
    totalSegments: segments.length,
    tempDir: tempDir,
    keyInfo: keyInfo,
    isEncrypted: isEncrypted ? true : false
  });
  notifyTaskUpdate(task.id);

  checkTaskStatus(task.id);
  logger.info(`[分片任务] 开始下载分片...`);
  await downloadSegments(task, segmentList, tempDir, listFilePath);

  checkTaskStatus(task.id);
  const allDownloaded = await checkAllDownloaded(segmentList, tempDir, listFilePath);
  if (!allDownloaded) {
    logger.error(`[分片任务] 部分分片下载失败`);
    throw new Error('部分分片下载失败');
  }
  logger.info(`[分片任务] 所有分片下载完成`);

  if (isEncrypted) {
    checkTaskStatus(task.id);
    logger.info(`[分片任务] 开始解密分片...`);
    await decryptSegments(task.id, tempDir, listFilePath);
    logger.info(`[分片任务] 分片解密完成`);
  }

  checkTaskStatus(task.id);
  // 历史此处曾有 2s 死等（推测为避免文件句柄占用），但分片已 await fs.writeFile 完成，无必要保留
  await new Promise(resolve => setImmediate(resolve));

  checkTaskStatus(task.id);
  taskManager.updateTask(task.id, {
    status: 'transcoding',
    progress: 100
  });
  notifyTaskUpdate(task.id);

  checkTaskStatus(task.id);
  const ffmpeg = require('./ffmpeg');
  const outputPath = path.join(task.savePath, `${sanitizeFileName(task.fileName)}.mp4`);
  logger.info(`[分片任务] 开始转码，输出路径: ${outputPath}`);
  logger.info(`[分片任务] 转码源目录: ${tempDir}`);
  await ffmpeg.transcodeSegments(task.id, tempDir, outputPath);

  checkTaskStatus(task.id);

  try {
    const stats = await fs.stat(outputPath);
    logger.info(`[分片任务] 转码完成，输出文件: ${outputPath}, 大小: ${stats.size} 字节`);
    if (stats.size === 0) {
      logger.error(`[分片任务] 输出文件大小为0，转码可能失败: ${outputPath}`);
    }
    taskManager.updateTask(task.id, {
      status: 'completed',
      outputPath: outputPath,
      finalSize: stats.size
    });
  } catch (error) {
    // 输出文件不存在属于异常情况（转码失败/文件被外部删除等），
    // 不应标记为 completed，否则会误导用户认为下载完成可用
    logger.error(`[分片任务] 输出文件不存在，标记为失败: ${outputPath}, ${error.message}`);
    taskManager.updateTask(task.id, {
      status: 'failed',
      outputPath: outputPath,
      error: `输出文件不存在: ${error.message}`
    });
  }
  notifyTaskUpdate(task.id);

  setTimeout(async function() {
    try {
      await fs.remove(taskDir);
      logger.info(`[分片任务] 缓存目录已删除: ${taskDir}`);
    } catch (error) {
      logger.warn(`[分片任务] 删除缓存目录失败: ${error.message}`);
    }
  }, 2000);
}

/**
 * 解密加密的TS分片
 * 使用Node.js crypto模块对每个分片执行AES-128-CBC解密
 * 优化：async.queue 并发解密（默认 4 并发），进度按完成数计算
 * 解密后覆盖原文件，后续concat合并无需处理加密
 * @param {string} taskId - 任务ID
 * @param {string} tempDir - 临时目录路径
 * @param {string} listFilePath - list.json文件路径
 * @returns {Promise<void>}
 */
async function decryptSegments(taskId, tempDir, listFilePath) {
  const decryptMarker = path.join(tempDir, '.decrypted');
  const markerExists = await fs.pathExists(decryptMarker);
  if (markerExists) {
    logger.info(`[解密] 分片已解密，跳过解密步骤`);
    return;
  }

  const listData = await fs.readJson(listFilePath);
  const keyInfo = listData.keyInfo;
  const segmentList = listData.segments;

  if (!keyInfo || !keyInfo.localPath) {
    logger.error(`[解密] 缺少密钥信息，无法解密分片`);
    throw new Error('缺少密钥信息，无法解密分片');
  }

  logger.info(`[解密] 密钥文件路径: ${keyInfo.localPath}`);
  const keyData = await fs.readFile(keyInfo.localPath);

  if (keyData.length !== 16) {
    logger.error(`[解密] 密钥长度异常: ${keyData.length}字节，期望16字节`);
    throw new Error(`密钥长度异常: ${keyData.length}字节，期望16字节`);
  }

  logger.info(`[解密] 密钥长度正确: ${keyData.length}字节`);

  /** 解密并发数（CPU 密集 + IO 混合，4 较平衡） */
  const DECRYPT_CONCURRENCY = 4;

  taskManager.updateTask(taskId, {
    status: 'decrypting',
    decryptingProgress: 0
  });
  notifyTaskUpdate(taskId);

  logger.info(`[解密] 开始解密分片，总数: ${segmentList.length}, 密钥方法: ${keyInfo.method}, 并发: ${DECRYPT_CONCURRENCY}`);

  let completedCount = 0;
  let lastProgressUpdate = 0;

  await new Promise((resolve, reject) => {
    const queue = async.queue(async (i) => {
      checkTaskStatus(taskId);

      const segmentPath = path.join(tempDir, `${i}.ts`);
      const segmentExists = await fs.pathExists(segmentPath);
      if (!segmentExists) {
        throw new Error(`分片文件不存在: ${segmentPath}`);
      }

      const encryptedData = await fs.readFile(segmentPath);

      // 分片长度必须是 AES 块大小（16 字节）的整数倍，否则无法解密
      if (encryptedData.length === 0 || encryptedData.length % 16 !== 0) {
        throw new Error(`分片 ${i} 长度异常: ${encryptedData.length} 字节，需为 16 的整数倍（可能下载不完整或损坏）`);
      }

      let iv;
      if (keyInfo.iv) {
        const ivHex = keyInfo.iv.replace(/^0x/i, '');
        iv = Buffer.from(ivHex, 'hex');
        // IV 必须是 16 字节，否则 createDecipheriv 会抛错
        if (iv.length !== 16) {
          throw new Error(`分片 ${i} IV 长度异常: ${iv.length} 字节（hex: ${ivHex}），期望 16 字节`);
        }
      } else {
        // HLS 规范：未指定 IV 时，使用分片序号作为 IV（高 12 字节为 0，低 4 字节为序号）
        iv = Buffer.alloc(16);
        iv.writeUInt32BE(i, 12);
      }

      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', keyData, iv);
        // HLS AES-128-CBC 不使用 PKCS7 padding（TS 分片本身是 16 字节整数倍），
        // 必须禁用 autoPadding，否则 final() 会抛 WRONG_FINAL_BLOCK_LENGTH / BAD_DECRYPT
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        await fs.writeFile(segmentPath, decrypted);
      } catch (err) {
        // 解密失败时记录详细诊断信息，便于定位问题
        logger.error(`[解密] 分片 ${i} 解密失败: ${err.message}`);
        logger.error(`[解密] 诊断: 加密数据长度=${encryptedData.length}, 密钥长度=${keyData.length}, IV长度=${iv.length}, method=${keyInfo.method}, iv来源=${keyInfo.iv ? 'm3u8指定' : '序号生成'}`);
        throw new Error(`分片 ${i} 解密失败: ${err.message}（数据${encryptedData.length}B/密钥${keyData.length}B/IV${iv.length}B）`);
      }

      completedCount++;
      // 进度更新节流：每完成 10 片或全部完成时更新一次
      const progress = Math.round((completedCount / segmentList.length) * 100);
      if (progress - lastProgressUpdate >= 10 || completedCount === segmentList.length) {
        lastProgressUpdate = progress;
        taskManager.updateTask(taskId, {
          decryptingProgress: progress
        });
      }
    }, DECRYPT_CONCURRENCY);

    // 入队所有分片索引
    for (let i = 0; i < segmentList.length; i++) {
      queue.push(i);
    }

    queue.drain(() => resolve());
    queue.error((error) => {
      if (error && error.message !== '任务已被暂停') {
        reject(error);
      }
    });
  });

  await fs.writeFile(decryptMarker, '');
  taskManager.updateTask(taskId, {
    decryptingProgress: 100
  });
  notifyTaskUpdate(taskId);

  logger.info(`[解密] 分片解密完成，共解密 ${segmentList.length} 个分片`);
}

/**
 * 解析M3U8文件，提取分片地址列表
 * @param {string} url - M3U8文件URL
 * @param {number} [retryCount=0] - 重试次数
 * @param {Object} [parentKeyInfo=null] - 上层传递的密钥信息
 * @returns {Promise<{segments: string[], keyInfo: Object|null}>} 分片URL数组和密钥信息
 */
async function parseM3U8(url, retryCount = 0, parentKeyInfo = null) {
  const maxRetries = 3;
  const cleanedUrl = url.replace(/([^:]\/\/)/g, '$1');

  try {
    const response = await axios.get(cleanedUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': httpUtil.getUserAgent(),
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': cleanedUrl.substring(0, cleanedUrl.lastIndexOf('/') + 1)
      },
      maxRedirects: 5,
      proxy: httpUtil.getProxyConfig()
    });
    const content = response.data;

    const parser = new Parser();
    parser.push(content);
    parser.end();

    const manifest = parser.manifest;
    
    // 详细调试信息
    logger.info(`[DEBUG] M3U8内容前500字符: ${content.substring(0, 500)}`);
    logger.info(`[DEBUG] manifest结构: keys=${manifest.keys ? manifest.keys.length : 'undefined'}, playlists=${manifest.playlists ? manifest.playlists.length : 'undefined'}, segments=${manifest.segments ? manifest.segments.length : 'undefined'}`);

    // 尝试从 manifest 获取密钥，如果失败则手动解析
    let currentKeyInfo = null;
    if (manifest.keys && manifest.keys.length > 0) {
      currentKeyInfo = manifest.keys[0];
      logger.info(`[DEBUG] 从manifest获取密钥: ${JSON.stringify(currentKeyInfo)}`);
    } else {
      // 手动解析 #EXT-X-KEY 标签
      currentKeyInfo = parseKeyFromContent(content);
      logger.info(`[DEBUG] 手动解析密钥: ${currentKeyInfo ? `method=${currentKeyInfo.method}, uri=${currentKeyInfo.uri}` : '无'}`);
    }
    
    logger.info(`[DEBUG] 解析M3U8: ${url}, 当前层密钥: ${currentKeyInfo ? `method=${currentKeyInfo.method}, uri=${currentKeyInfo.uri}` : '无'}`);

    if (manifest.playlists && manifest.playlists.length > 0) {
      const playlist = manifest.playlists[0];
      const playlistUrl = playlist.uri;

      let fullPlaylistUrl;
      if (playlistUrl.startsWith('http')) {
        fullPlaylistUrl = playlistUrl;
      } else if (playlistUrl.startsWith('/')) {
        const baseUrlParts = url.split('/');
        const baseDomain = baseUrlParts.slice(0, 3).join('/');
        fullPlaylistUrl = baseDomain + playlistUrl;
      } else {
        const baseUrlPath = url.substring(0, url.lastIndexOf('/') + 1);
        fullPlaylistUrl = baseUrlPath + playlistUrl;
      }

      fullPlaylistUrl = fullPlaylistUrl.replace(/([^:]\/\/)/g, '$1');

      // 传递当前层的密钥信息给下一层，优先使用当前层的密钥
      // 如果当前层有密钥，保存当前 m3u8 URL 作为密钥的基础 URL
      let keyToPass = null;
      if (currentKeyInfo) {
        keyToPass = {
          ...currentKeyInfo,
          baseUrl: url
        };
      } else if (parentKeyInfo) {
        keyToPass = parentKeyInfo;
      }
      return await parseM3U8(fullPlaylistUrl, 0, keyToPass);
    } else if (manifest.segments && manifest.segments.length > 0) {
      const segments = [];
      // 优先使用当前层的密钥，如果当前层没有则使用上层传递的密钥
      let keyInfo = null;
      if (currentKeyInfo) {
        keyInfo = {
          ...currentKeyInfo,
          baseUrl: url
        };
      } else if (parentKeyInfo) {
        keyInfo = parentKeyInfo;
      }

      for (const segment of manifest.segments) {
        let segmentUrl = segment.uri;

        if (!segmentUrl.startsWith('http')) {
          if (segmentUrl.startsWith('/')) {
            const baseUrlParts = url.split('/');
            const baseDomain = baseUrlParts.slice(0, 3).join('/');
            segmentUrl = baseDomain + segmentUrl;
          } else {
            const baseUrlPath = url.substring(0, url.lastIndexOf('/') + 1);
            segmentUrl = baseUrlPath + segmentUrl;
          }

          segmentUrl = segmentUrl.replace(/([^:]\/\/)/g, '$1');
        }

        segments.push(segmentUrl);
      }

      if (segments.length === 0) {
        throw new Error('未找到分片地址');
      }

      return { segments, keyInfo };
    } else {
      throw new Error('无效的M3U8文件格式');
    }
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout') || error.response?.status >= 500) {
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        logger.warn(`网络错误，将重试解析M3U8，重试次数: ${retryCount + 1}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return parseM3U8(url, retryCount + 1);
      }
    }

    throw new Error(`解析 M3U8 文件失败: ${error.message}`);
  }
}

/**
 * 创建或加载分片列表文件
 * @param {string} listFilePath - list.json 文件路径
 * @param {string[]} segments - 分片URL数组
 * @param {string} m3u8Url - M3U8文件URL
 * @param {string} taskId - 任务ID
 * @param {Object} [keyInfo=null] - 密钥信息
 * @returns {Promise<Object[]>} 分片列表
 */
async function createOrLoadSegmentList(listFilePath, segments, m3u8Url, taskId, keyInfo = null) {
  if (fs.existsSync(listFilePath)) {
    try {
      const existingList = await fs.readJson(listFilePath);
      if (existingList.m3u8Url === m3u8Url && existingList.segments.length === segments.length) {
        return existingList.segments;
      }
    } catch (error) {
      logger.warn(`读取list.json失败，重新创建: ${error.message}`);
    }
  }

  const segmentList = segments.map((url, index) => ({
    index,
    url,
    downloaded: false,
    fileName: `${index}.ts`,
    size: 0,
    retryCount: 0,
    taskId: taskId
  }));

  const listData = {
    m3u8Url,
    totalSegments: segments.length,
    createdAt: new Date().toISOString(),
    isEncrypted: keyInfo && keyInfo.uri && keyInfo.method ? true : false,
    keyInfo: keyInfo,
    segments: segmentList
  };

  await fs.writeJson(listFilePath, listData, { spaces: 2 });
  return segmentList;
}

/**
 * 下载加密密钥文件
 * @param {Object} keyInfo - 密钥信息
 * @param {string} taskDir - 任务目录
 * @param {string} tempDir - 临时目录路径
 * @param {string} m3u8Url - M3U8文件URL
 * @returns {Promise<string>} 密钥文件本地路径
 */
async function downloadKey(keyInfo, taskDir, tempDir, m3u8Url) {
  try {
    const keyUri = keyInfo.uri;
    // 使用发现密钥时的 m3u8 URL 作为基础 URL，如果没有则使用原始 m3u8 URL
    const baseUrl = keyInfo.baseUrl || m3u8Url;
    let keyUrl;
    
    if (keyUri.startsWith('http')) {
      keyUrl = keyUri;
    } else if (keyUri.startsWith('/')) {
      const baseUrlParts = baseUrl.split('/');
      const baseDomain = baseUrlParts.slice(0, 3).join('/');
      keyUrl = baseDomain + keyUri;
    } else {
      const baseUrlPath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      keyUrl = baseUrlPath + keyUri;
    }

    keyUrl = keyUrl.replace(/([^:]\/\/)/g, '$1');
    logger.info(`构建密钥下载地址: ${keyUrl}`);

    const response = await axios.get(keyUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': httpUtil.getUserAgent(),
        'Referer': baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1)
      },
      timeout: 30000,
      proxy: httpUtil.getProxyConfig()
    });

    // 将密钥文件保存到 temp 目录下
    const keyPath = path.join(tempDir, 'key.key');
    await fs.writeFile(keyPath, response.data);
    
    logger.info(`密钥文件已下载: ${keyPath}`);
    return keyPath;
  } catch (error) {
    logger.error(`下载密钥文件失败: ${error.message}`);
    throw new Error(`下载密钥文件失败: ${error.message}`);
  }
}

/**
 * 下载所有分片到临时目录
 * 引入多轮批次重试防御：单轮结束后若仍有失败分片，重置其重试计数并继续下一轮，
 * 最多进行 MAX_DOWNLOAD_ROUNDS 轮（首轮 + 重试轮），避免间歇性网络抖动直接导致任务失败。
 * @param {Object} task - 任务对象
 * @param {Object[]} segmentList - 分片列表
 * @param {string} tempDir - 临时目录路径
 * @param {string} listFilePath - list.json 文件路径
 * @returns {Promise<void>}
 */
async function downloadSegments(task, segmentList, tempDir, listFilePath) {
  /**
   * 总下载轮数（首轮 + 4 轮重试）
   * 与内层 maxRetries=1 配合，单分片总尝试次数上限 = 5 次（跨层级共享计数）
   */
  const MAX_DOWNLOAD_ROUNDS = 5;

  if (isTaskPaused(task.id)) {
    throw new Error('任务已被暂停');
  }

  /** list.json 节流写入器：避免每分片完成都全量读写 list.json */
  const listWriter = new ListFileThrottledWriter(listFilePath, segmentList);

  const totalSegments = segmentList.length;
  let downloadedCount = segmentList.filter(s => s.downloaded).length;
  let totalSize = 0;
  let downloadedSize = 0;
  const startTime = Date.now();

  if (!task.downloadStats) {
    task.downloadStats = {
      segmentTimes: [],
      segmentSizes: [],
      windowSize: 10,
      startTime: startTime,
      totalDownloadedSize: 0
    };
  } else if (!task.downloadStats.startTime) {
    task.downloadStats.startTime = startTime;
  }

  // 估算总大小
  let knownSizeSegments = 0;
  let knownSizeTotal = 0;
  for (const segment of segmentList) {
    if (segment.downloaded && segment.size > 0) {
      downloadedSize += segment.size;
      totalSize += segment.size;
      knownSizeSegments++;
      knownSizeTotal += segment.size;
    } else if (segment.size > 0) {
      totalSize += segment.size;
      knownSizeSegments++;
      knownSizeTotal += segment.size;
    }
  }
  const unknownSizeSegments = segmentList.length - knownSizeSegments;
  if (unknownSizeSegments > 0 && knownSizeSegments > 0) {
    const averageSegmentSize = knownSizeTotal / knownSizeSegments;
    totalSize += unknownSizeSegments * averageSegmentSize;
  } else if (segmentList.length > 0 && knownSizeSegments === 0) {
    const defaultSegmentSize = 256 * 1024;
    totalSize = segmentList.length * defaultSegmentSize;
  }
  if (task.downloadStats) {
    task.downloadStats.totalDownloadedSize = downloadedSize;
  }

  /**
   * 下载单批分片（一轮），返回仍失败的分片列表
   * @param {Object[]} pendingSegments - 本轮待下载分片
   * @returns {Promise<Object[]>} 仍失败的分片列表
   */
  function runDownloadRound(pendingSegments) {
    return new Promise((resolve) => {
      if (pendingSegments.length === 0) {
        resolve([]);
        return;
      }

      let roundHasError = false;
      const failedInRound = new Set();

      const roundQueue = async.queue(async function(segmentInfo, callback) {
        try {
          checkTaskStatus(task.id);
        } catch (error) {
          if (typeof callback === 'function') callback(null);
          return;
        }

        const { index, url } = segmentInfo;
        const segmentPath = path.join(tempDir, `${index}.ts`);
        let segmentSize = 0;
        let segmentTime = 0;

        // 已下载分片校验
        const segmentExists = await fs.pathExists(segmentPath);
        if (segmentExists && segmentInfo.downloaded && segmentInfo.size > 0) {
          try {
            const stats = await fs.stat(segmentPath);
            if (stats.size === segmentInfo.size) {
              downloadedCount++;
              downloadedSize += segmentInfo.size;
              const remainingSegments = totalSegments - downloadedCount;
              if (downloadedCount > 0) {
                const averageSegmentSize = downloadedSize / downloadedCount;
                totalSize = downloadedSize + (remainingSegments * averageSegmentSize);
              }
              timeEstimator.updateTaskProgress(task, downloadedCount, totalSegments, downloadedSize, totalSize, startTime, (updatedTask) => {
                taskManager.updateTask(updatedTask.id, {
                  downloadedSegments: updatedTask.downloadedSegments,
                  progress: updatedTask.progress,
                  speed: updatedTask.speed,
                  remainingTime: updatedTask.remainingTime,
                  downloadedSize: downloadedSize,
                  totalSize: totalSize
                });
                notifyTaskUpdate(updatedTask.id);
              });
              if (typeof callback === 'function') callback(null);
              return;
            }
          } catch (error) {
            logger.warn(`获取文件状态失败，重新下载: ${error.message}`);
          }
        }

        try {
          checkTaskStatus(task.id);
        } catch (error) {
          if (typeof callback === 'function') callback(null);
          return;
        }

        // 内层重试上限：1 次（外层 MAX_DOWNLOAD_ROUNDS=5 轮已含重试逻辑，总尝试上限 5 次）
        const maxRetries = 1;
        let currentRetry = 0;

        async function downloadWithRetry() {
          try {
            const segmentStartTime = Date.now();
            const cleanedSegmentUrl = url.replace(/([^:]\/\/)/g, '$1');
            const response = await axios.get(cleanedSegmentUrl, {
              responseType: 'arraybuffer',
              timeout: 30000,
              headers: {
                'User-Agent': httpUtil.getUserAgent(),
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Referer': cleanedSegmentUrl.substring(0, cleanedSegmentUrl.lastIndexOf('/') + 1)
              },
              maxRedirects: 5,
              proxy: httpUtil.getProxyConfig()
            });

            const buffer = Buffer.from(response.data);
            segmentSize = buffer.length;
            const segmentEndTime = Date.now();
            segmentTime = (segmentEndTime - segmentStartTime) / 1000;

            await fs.writeFile(segmentPath, buffer);

            downloadedCount++;
            downloadedSize += segmentSize;
            const remainingSegments = totalSegments - downloadedCount;
            if (downloadedCount > 0) {
              const averageSegmentSize = downloadedSize / downloadedCount;
              totalSize = downloadedSize + (remainingSegments * averageSegmentSize);
            }

            if (!task.downloadStats) {
              task.downloadStats = {
                segmentTimes: [],
                segmentSizes: [],
                windowSize: 10,
                startTime: startTime,
                totalDownloadedSize: 0
              };
            }
            if (!task.downloadStats.startTime) {
              task.downloadStats.startTime = startTime;
            }
            task.downloadStats.segmentTimes.push(segmentTime);
            task.downloadStats.segmentSizes.push(segmentSize);
            task.downloadStats.totalDownloadedSize = downloadedSize;
            if (task.downloadStats.segmentTimes.length > task.downloadStats.windowSize) {
              task.downloadStats.segmentTimes.shift();
              task.downloadStats.segmentSizes.shift();
            }

            segmentInfo.downloaded = true;
            segmentInfo.size = segmentSize;
            segmentInfo.retryCount = 0;
            failedInRound.delete(index);

            // 节流写入 list.json：标记脏数据，2s 或累计 10 次后落盘
            listWriter.markDirty();

            timeEstimator.updateTaskProgress(task, downloadedCount, totalSegments, downloadedSize, totalSize, startTime, (updatedTask) => {
              taskManager.updateTask(updatedTask.id, {
                downloadedSegments: updatedTask.downloadedSegments,
                progress: updatedTask.progress,
                speed: updatedTask.speed,
                remainingTime: updatedTask.remainingTime,
                downloadedSize: downloadedSize,
                totalSize: totalSize
              });
              notifyTaskUpdate(updatedTask.id);
            });

            if (typeof callback === 'function') callback(null);
          } catch (error) {
            // 仅对网络错误/5xx/超时重试，且受 maxRetries 限制（跨层级总尝试上限 5 次）
            if (httpUtil.isRetryableError(error) && currentRetry < maxRetries) {
              currentRetry++;
              const base = Math.pow(2, currentRetry) * 1000;
              const jitter = Math.min(base, 3000) * (0.5 + Math.random() * 0.5);
              logger.warn(`分片下载失败，将重试，重试次数: ${currentRetry}`);
              await new Promise(resolve => setTimeout(resolve, jitter));
              await downloadWithRetry();
            } else {
              logger.error(`分片下载失败: ${index}, ${error.message}`);
              segmentInfo.retryCount++;
              roundHasError = true;
              failedInRound.add(index);
              if (typeof callback === 'function') callback(null);
            }
          }
        }

        await downloadWithRetry();
      }, segmentConcurrency);

      pendingSegments.forEach(segment => {
        roundQueue.push(segment);
      });

      roundQueue.drain(() => {
        // 收集本轮仍失败的分片
        const failedSegments = segmentList.filter(s => !s.downloaded);
        if (roundHasError && failedSegments.length > 0) {
          logger.warn(`[下载] 本轮结束，仍有 ${failedSegments.length} 个分片未完成`);
        }
        resolve(failedSegments);
      });

      roundQueue.error((error) => {
        if (error && error.message !== '任务已被暂停') {
          roundHasError = true;
        }
      });

      segmentQueue = roundQueue;
    });
  }

  // 多轮下载执行
  let pending = segmentList.filter(s => !s.downloaded);
  try {
    for (let round = 0; round < MAX_DOWNLOAD_ROUNDS; round++) {
      if (pending.length === 0) break;
      try {
        checkTaskStatus(task.id);
      } catch (error) {
        throw error;
      }

      if (round > 0) {
        logger.info(`[下载] 开始第 ${round + 1} 轮重试，待下载分片数: ${pending.length}`);
        // 重置失败分片的重试计数，允许下一轮重新尝试
        pending.forEach(s => { s.retryCount = 0; });
      }

      pending = await runDownloadRound(pending);
    }

    // 最终校验
    const finalFailed = segmentList.filter(s => !s.downloaded);
    if (finalFailed.length > 0) {
      logger.error(`[下载] 经过 ${MAX_DOWNLOAD_ROUNDS} 轮重试后仍有 ${finalFailed.length}/${totalSegments} 个分片下载失败`);
      throw new Error(`部分分片下载失败（${finalFailed.length}/${totalSegments}）`);
    }
  } finally {
    // 强制 flush 节流写入器：正常完成、暂停、失败时都确保 list.json 落盘
    await listWriter.flush();
  }
}

/**
 * 保存分片列表到list.json
 * @param {string} listFilePath - list.json 文件路径
 * @param {Object[]} segmentList - 分片列表
 */
async function saveSegmentList(listFilePath, segmentList, keyInfo = null) {
  try {
    const listData = await fs.readJson(listFilePath);
    listData.segments = segmentList;
    listData.updatedAt = new Date().toISOString();
    if (keyInfo) {
      listData.keyInfo = keyInfo;
    }
    await fs.writeJson(listFilePath, listData, { spaces: 2 });
  } catch (error) {
    logger.error(`保存list.json失败: ${error.message}`);
  }
}

/**
 * list.json 节流写入器：避免每分片完成都全量读写 list.json
 * - 标记 dirty 后 2s 或 flush() 调用时落盘
 * - 内存维护最新 listData 与 segmentList，避免每次 readJson
 * - 任务完成/暂停/失败时务必调用 flush()
 */
class ListFileThrottledWriter {
  /**
   * @param {string} listFilePath
   * @param {Object[]} segmentList 引用，外部修改会反映到此处
   * @param {Object} [keyInfo]
   */
  constructor(listFilePath, segmentList, keyInfo = null) {
    this.listFilePath = listFilePath;
    this.segmentList = segmentList;
    this.keyInfo = keyInfo;
    this.listData = null;
    this.dirty = false;
    this.timer = null;
    this.flushing = false;
    /** 累计未落盘的变更计数，达到阈值也强制 flush */
    this.pendingChanges = 0;
  }

  /** 标记脏数据，启动 2s 定时器；累计 10 次变更也触发立即落盘 */
  markDirty() {
    this.dirty = true;
    this.pendingChanges++;
    if (this.timer) return;
    if (this.pendingChanges >= 10) {
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 2000);
  }

  /** 强制立即落盘 */
  async flush() {
    if (this.flushing) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.flushing = true;
    try {
      if (!this.listData) {
        this.listData = await fs.readJson(this.listFilePath);
      }
      this.listData.segments = this.segmentList;
      this.listData.updatedAt = new Date().toISOString();
      if (this.keyInfo) {
        this.listData.keyInfo = this.keyInfo;
      }
      await fs.writeJson(this.listFilePath, this.listData, { spaces: 2 });
      this.dirty = false;
      this.pendingChanges = 0;
    } catch (error) {
      logger.error(`节流保存list.json失败: ${error.message}`);
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * 检查是否所有分片都已下载完成
 * @param {Object[]} segmentList - 分片列表
 * @param {string} tempDir - 临时目录路径
 * @param {string} listFilePath - list.json 文件路径
 * @returns {Promise<boolean>} 是否全部下载完成
 */
async function checkAllDownloaded(segmentList, tempDir, listFilePath) {
  let allDownloaded = true;
  let hasInconsistencies = false;

  for (const segment of segmentList) {
    const segmentPath = path.join(tempDir, segment.fileName);
    const fileExists = await fs.pathExists(segmentPath);

    if (fileExists && !segment.downloaded) {
      segment.downloaded = true;
      hasInconsistencies = true;
    } else if (!fileExists && segment.downloaded) {
      segment.downloaded = false;
      allDownloaded = false;
      hasInconsistencies = true;
    } else if (!fileExists && !segment.downloaded) {
      allDownloaded = false;
    }
  }

  if (hasInconsistencies) {
    try {
      const listData = await fs.readJson(listFilePath);
      listData.segments = segmentList;
      listData.updatedAt = new Date().toISOString();
      await fs.writeJson(listFilePath, listData, { spaces: 2 });
    } catch (error) {
      logger.error(`更新list.json失败: ${error.message}`);
    }
  }

  return allDownloaded;
}

/**
 * 清理文件名，去除非法字符
 * @param {string} fileName - 原始文件名
 * @returns {string} 清理后的文件名
 */
function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * 将任务对象加入下载队列
 * @param {Object} task - 任务对象
 */
function enqueueTask(task) {
  downloadQueue.push(task);
}

/**
 * 将多个任务对象批量加入下载队列
 * @param {Object[]} taskList - 任务对象数组
 */
function enqueueTasks(taskList) {
  taskList.forEach(task => {
    downloadQueue.push(task);
  });
}

module.exports = {
  enqueueTask,
  enqueueTasks,
  parseM3U8,
  loadConcurrencySettings
};
