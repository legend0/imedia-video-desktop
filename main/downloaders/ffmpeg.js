/**
 * FFmpeg 转码模块
 * 使用项目内置的 ffmpeg.exe 进行分片合并转码
 */
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');
const taskManager = require('./task-manager');
const logger = require('../utils/log');

/**
 * 检测路径是否为真实的文件系统路径（非 asar 虚拟路径）
 * asar 内的文件 fs.existsSync 返回 true，但二进制文件无法被 spawn 执行
 * @param {string} filePath - 待检测的文件路径
 * @returns {boolean} 路径是否指向真实文件系统中的文件
 */
function isRealFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  // asar 包内的路径无法执行二进制文件，必须排除
  if (filePath.includes('app.asar') && !filePath.includes('app.asar.unpacked')) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * 构建 FFmpeg 候选路径列表
 * 注意：asar 打包后 __dirname 指向 asar 虚拟路径，fs.existsSync 会误判为存在
 * 必须优先使用 app.asar.unpacked 或 process.resourcePath 构建真实路径
 * @returns {string[]} 候选路径数组
 */
function buildFfmpegCandidates() {
  const exeDir = app.isReady() ? path.dirname(app.getPath('exe')) : '';
  const isPackaged = app.isPackaged;
  const candidates = [];

  if (isPackaged && exeDir) {
    // 打包模式：优先使用 process.resourcePath 构建 app.asar.unpacked 路径
    // process.resourcePath 在打包后指向 resources 目录
    const resourceDir = process.resourcesPath || path.join(exeDir, 'resources');
    candidates.push(
      // asar 打包 + asarUnpack：resources/app.asar.unpacked/main/ffmpeg/ffmpeg.exe
      path.join(resourceDir, 'app.asar.unpacked', 'main', 'ffmpeg', 'ffmpeg.exe'),
      // NSIS 安装包（非 asar 模式，asar 被解压为目录）：resources/app/main/ffmpeg/ffmpeg.exe
      path.join(resourceDir, 'app', 'main', 'ffmpeg', 'ffmpeg.exe'),
      // extraResources 模式：resources/ffmpeg/ffmpeg.exe
      path.join(resourceDir, 'ffmpeg', 'ffmpeg.exe'),
      // 便携版（exe 同级目录下）：main/ffmpeg/ffmpeg.exe
      path.join(exeDir, 'main', 'ffmpeg', 'ffmpeg.exe')
    );
  } else {
    // 开发模式：直接使用 __dirname 相对路径
    candidates.push(
      path.join(__dirname, '..', 'ffmpeg', 'ffmpeg.exe')
    );
  }

  return candidates;
}

/**
 * 延迟初始化 FFmpeg 路径（确保 app 已 ready 后再调用）
 * @returns {string} FFmpeg 可执行文件路径
 */
function resolveFfmpegPath() {
  const candidates = buildFfmpegCandidates();
  for (const candidate of candidates) {
    if (isRealFilePath(candidate)) {
      logger.info(`[转码] FFmpeg路径: ${candidate}`);
      return candidate;
    }
  }
  logger.warn(`[转码] 未找到FFmpeg，已尝试路径: ${candidates.join('; ')}`);
  return candidates[0] || '';
}

let FFMPEG_PATH = '';

/**
 * 获取 FFmpeg 路径（延迟初始化，首次调用时解析）
 * @returns {string} FFmpeg 路径
 */
function getFfmpegPath() {
  if (!FFMPEG_PATH) {
    FFMPEG_PATH = resolveFfmpegPath();
  }
  return FFMPEG_PATH;
}

/**
 * 检查FFmpeg是否可用
 * @returns {boolean} FFmpeg是否可用
 */
function checkFfmpeg() {
  return isRealFilePath(getFfmpegPath());
}

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
 * 转码分片为MP4
 * @param {string} taskId - 任务ID
 * @param {string} tempDir - 临时目录
 * @param {string} outputPath - 输出路径
 * @returns {Promise<void>}
 */
function transcodeSegments(taskId, tempDir, outputPath) {
  return new Promise((resolve, reject) => {
    if (isTaskPaused(taskId)) {
      reject(new Error('任务已被暂停'));
      return;
    }

    logger.info(`[转码] 开始转码任务: ${taskId}`);
    logger.info(`[转码] 临时目录: ${tempDir}`);
    logger.info(`[转码] 输出路径: ${outputPath}`);
    logger.info(`[转码] FFmpeg路径: ${getFfmpegPath()}`);
    logger.info(`[转码] FFmpeg可用: ${checkFfmpeg()}`);

    if (!checkFfmpeg()) {
      logger.warn('[转码] FFmpeg不可用，使用JS转码作为备选');
      return transcodeWithJs(taskId, tempDir, outputPath)
        .then(resolve)
        .catch(reject);
    }

    const outputDir = path.dirname(outputPath);
    logger.info(`[转码] 输出目录: ${outputDir}`);
    fs.ensureDirSync(outputDir);

    const segments = [];
    const files = fs.readdirSync(tempDir);
    logger.info(`[转码] 临时目录文件列表: ${files.join(', ')}`);
    files.forEach(file => {
      if (file.endsWith('.ts')) {
        segments.push(path.join(tempDir, file));
      }
    });

    segments.sort((a, b) => {
      const aIndex = parseInt(path.basename(a, '.ts'));
      const bIndex = parseInt(path.basename(b, '.ts'));
      return aIndex - bIndex;
    });

    if (segments.length === 0) {
      logger.error(`[转码] 临时目录中没有找到分片文件: ${tempDir}`);
      reject(new Error('临时目录中没有找到分片文件'));
      return;
    }

    logger.info(`[转码] 找到 ${segments.length} 个分片文件`);
    for (let i = 0; i < Math.min(segments.length, 5); i++) {
      try {
        const stat = fs.statSync(segments[i]);
        logger.info(`[转码] 分片 ${path.basename(segments[i])}: ${stat.size} 字节`);
      } catch (e) {
        logger.warn(`[转码] 分片 ${path.basename(segments[i])} 状态检查失败: ${e.message}`);
      }
    }
    if (segments.length > 5) {
      logger.info(`[转码] ... 共 ${segments.length} 个分片，仅显示前5个`);
    }

    const segmentListPath = path.join(tempDir, 'segments.txt');
    const segmentListContent = segments.map(segment => {
      const relativePath = path.relative(tempDir, segment).replace(/\\/g, '/');
      return `file '${relativePath}'`;
    }).join('\n');
    fs.writeFileSync(segmentListPath, segmentListContent);
    logger.info(`[转码] 分片列表已写入: ${segmentListPath}`);
    logger.info(`[转码] 分片列表内容:\n${segmentListContent}`);

    const command = ffmpeg()
      .setFfmpegPath(getFfmpegPath())
      .input(segmentListPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions('-c copy')
      .output(outputPath);

    command.on('start', (commandLine) => {
      logger.info(`[转码] FFmpeg命令: ${commandLine}`);
    });

    command.on('stderr', (stderrLine) => {
      logger.info(`[转码] FFmpeg输出: ${stderrLine}`);
    });

    command.on('progress', (progress) => {
      if (isTaskPaused(taskId)) {
        command.kill('SIGTERM');
        return;
      }

      logger.info(`[转码] 进度: ${progress.percent ? progress.percent.toFixed(1) : 0}%, 速度: ${progress.currentKbps || 0}kbps`);

      taskManager.updateTask(taskId, {
        transcodingProgress: progress.percent || 0
      });
    });

    command.on('error', (error, stdout, stderr) => {
      if (isTaskPaused(taskId)) {
        reject(new Error('任务已被暂停'));
        return;
      }
      logger.error(`[转码] FFmpeg转码失败: ${error.message}`);
      if (stderr) {
        logger.error(`[转码] FFmpeg stderr: ${stderr}`);
      }
      if (stdout) {
        logger.error(`[转码] FFmpeg stdout: ${stdout}`);
      }
      reject(new Error(`转码失败: ${error.message}`));
    });

    command.on('end', () => {
      if (isTaskPaused(taskId)) {
        reject(new Error('任务已被暂停'));
        return;
      }
      try {
        const outputStat = fs.statSync(outputPath);
        logger.info(`[转码] FFmpeg转码完成: ${taskId}, 输出文件大小: ${outputStat.size} 字节`);
        if (outputStat.size === 0) {
          logger.error(`[转码] 输出文件大小为0，转码可能失败: ${outputPath}`);
        }
      } catch (e) {
        logger.error(`[转码] 输出文件不存在: ${outputPath}, ${e.message}`);
      }
      resolve();
    });

    command.run();
  });
}

/**
 * 使用 mux.js 将TS分片remux为MP4（备选方案）
 * TS→fMP4 容器转换，不重编码，保留原始音视频数据
 * @param {string} taskId - 任务ID
 * @param {string} tempDir - 临时目录
 * @param {string} outputPath - 输出路径
 * @returns {Promise<void>}
 */
async function transcodeWithJs(taskId, tempDir, outputPath) {
  const muxjs = require('mux.js');

  logger.info(`[JS转码] 开始mux.js remux: ${taskId}`);
  logger.info(`[JS转码] 临时目录: ${tempDir}`);
  logger.info(`[JS转码] 输出路径: ${outputPath}`);

  const outputDir = path.dirname(outputPath);
  fs.ensureDirSync(outputDir);
  logger.info(`[JS转码] 输出目录: ${outputDir}`);

  const segments = [];
  const files = fs.readdirSync(tempDir);
  logger.info(`[JS转码] 临时目录文件列表: ${files.join(', ')}`);
  files.forEach(file => {
    if (file.endsWith('.ts')) {
      segments.push(path.join(tempDir, file));
    }
  });

  segments.sort((a, b) => {
    const aIndex = parseInt(path.basename(a, '.ts'));
    const bIndex = parseInt(path.basename(b, '.ts'));
    return aIndex - bIndex;
  });

  if (segments.length === 0) {
    logger.error(`[JS转码] 临时目录中没有找到分片文件: ${tempDir}`);
    throw new Error('临时目录中没有找到分片文件');
  }

  logger.info(`[JS转码] 找到 ${segments.length} 个分片文件`);

  const transmuxer = new muxjs.mp4.Transmuxer();
  const mp4Segments = [];
  let initSegment = null;

  transmuxer.on('data', (segment) => {
    if (segment.initSegment && !initSegment) {
      initSegment = segment.initSegment;
      logger.info(`[JS转码] 获取到initSegment, 大小: ${segment.initSegment.byteLength} 字节`);
    }
    mp4Segments.push(segment.data);
  });

  for (let i = 0; i < segments.length; i++) {
    if (isTaskPaused(taskId)) {
      throw new Error('任务已被暂停');
    }

    const segmentPath = segments[i];
    const segmentBuffer = fs.readFileSync(segmentPath);
    const uint8Array = new Uint8Array(segmentBuffer);

    transmuxer.push(uint8Array);
    transmuxer.flush();

    const progress = Math.round(((i + 1) / segments.length) * 100);
    taskManager.updateTask(taskId, {
      transcodingProgress: progress
    });

    if ((i + 1) % 50 === 0 || i === segments.length - 1) {
      logger.info(`[JS转码] remux进度: ${i + 1}/${segments.length} (${progress}%)`);
    }
  }

  if (!initSegment) {
    logger.error(`[JS转码] 未能获取initSegment，remux可能失败`);
    throw new Error('JS转码失败: 未能生成MP4初始化段');
  }

  if (mp4Segments.length === 0) {
    logger.error(`[JS转码] 未能获取媒体数据段，remux可能失败`);
    throw new Error('JS转码失败: 未能生成MP4媒体段');
  }

  const { createWriteStream } = require('fs');
  const writeStream = createWriteStream(outputPath);

  writeStream.write(Buffer.from(initSegment));

  let totalSize = initSegment.byteLength;
  for (const segData of mp4Segments) {
    writeStream.write(Buffer.from(segData));
    totalSize += segData.byteLength;
  }

  await new Promise((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on('error', (error) => reject(error));
  });

  try {
    const outputStat = fs.statSync(outputPath);
    logger.info(`[JS转码] remux完成: ${taskId}, 输出文件大小: ${outputStat.size} 字节 (${(outputStat.size / 1024 / 1024).toFixed(2)}MB)`);
    if (outputStat.size === 0) {
      logger.error(`[JS转码] 输出文件大小为0，remux可能失败: ${outputPath}`);
    }
  } catch (e) {
    logger.error(`[JS转码] 输出文件不存在: ${outputPath}, ${e.message}`);
    throw new Error(`JS转码输出文件不存在: ${e.message}`);
  }
}

/**
 * 使用FFmpeg直接下载并转码M3U8为MP4
 * 适用于加密M3U8场景，FFmpeg原生处理HLS协议和密钥解密
 * @param {string} taskId - 任务ID
 * @param {string} m3u8Url - M3U8文件URL
 * @param {string} outputPath - 输出路径
 * @param {Object} [options={}] - 选项
 * @param {string} [options.headers] - 自定义请求头（JSON字符串）
 * @returns {Promise<void>}
 */
function downloadWithFfmpeg(taskId, m3u8Url, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    if (isTaskPaused(taskId)) {
      reject(new Error('任务已被暂停'));
      return;
    }

    if (!checkFfmpeg()) {
      reject(new Error('FFmpeg不可用，无法下载加密M3U8'));
      return;
    }

    logger.info(`[FFmpeg下载] 开始任务: ${taskId}`);
    logger.info(`[FFmpeg下载] URL: ${m3u8Url}`);
    logger.info(`[FFmpeg下载] 输出路径: ${outputPath}`);
    logger.info(`[FFmpeg下载] FFmpeg路径: ${getFfmpegPath()}`);

    const outputDir = path.dirname(outputPath);
    logger.info(`[FFmpeg下载] 输出目录: ${outputDir}`);
    fs.ensureDirSync(outputDir);

    const command = ffmpeg()
      .setFfmpegPath(getFfmpegPath())
      .input(m3u8Url)
      .inputOptions([
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
        '-allowed_extensions', 'ALL'
      ]);

    if (options.headers) {
      command.inputOptions(['-headers', options.headers]);
      logger.info(`[FFmpeg下载] 自定义请求头: ${options.headers}`);
    }

    command
      .outputOptions('-c copy')
      .output(outputPath);

    const startTime = Date.now();

    command.on('start', (commandLine) => {
      logger.info(`[FFmpeg下载] FFmpeg命令: ${commandLine}`);
    });

    command.on('stderr', (stderrLine) => {
      logger.info(`[FFmpeg下载] FFmpeg输出: ${stderrLine}`);
    });

    command.on('progress', (progress) => {
      if (isTaskPaused(taskId)) {
        command.kill('SIGTERM');
        return;
      }

      const percent = progress.percent || 0;
      const currentTime = Date.now();
      const elapsed = (currentTime - startTime) / 1000;

      let speed = 0;
      if (progress.currentKbps) {
        speed = progress.currentKbps * 1024;
      }

      let remainingTime = 0;
      if (percent > 0 && percent < 100) {
        remainingTime = Math.round((elapsed / percent) * (100 - percent));
      }

      logger.info(`[FFmpeg下载] 进度: ${percent.toFixed(1)}%, 速度: ${(speed / 1024).toFixed(1)}KB/s, 剩余: ${remainingTime}s`);

      taskManager.updateTask(taskId, {
        progress: Math.min(Math.round(percent), 100),
        speed: speed,
        remainingTime: remainingTime
      });
    });

    command.on('error', (error, stdout, stderr) => {
      if (isTaskPaused(taskId)) {
        reject(new Error('任务已被暂停'));
        return;
      }
      logger.error(`[FFmpeg下载] 失败: ${error.message}`);
      if (stderr) {
        logger.error(`[FFmpeg下载] stderr: ${stderr}`);
      }
      if (stdout) {
        logger.error(`[FFmpeg下载] stdout: ${stdout}`);
      }
      reject(new Error(`FFmpeg下载失败: ${error.message}`));
    });

    command.on('end', () => {
      if (isTaskPaused(taskId)) {
        reject(new Error('任务已被暂停'));
        return;
      }
      try {
        const outputStat = fs.statSync(outputPath);
        logger.info(`[FFmpeg下载] 完成: ${taskId}, 输出文件大小: ${outputStat.size} 字节`);
        if (outputStat.size === 0) {
          logger.error(`[FFmpeg下载] 输出文件大小为0，下载可能失败: ${outputPath}`);
        }
      } catch (e) {
        logger.error(`[FFmpeg下载] 输出文件不存在: ${outputPath}, ${e.message}`);
      }
      resolve();
    });

    command.run();
  });
}

module.exports = {
  transcodeSegments,
  downloadWithFfmpeg,
  getFfmpegPath,
  checkFfmpeg
};
