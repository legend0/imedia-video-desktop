/**
 * 下载模块入口
 * 注册下载相关 IPC 处理程序，提供下载管理 API
 */
const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const taskManager = require('../downloaders/task-manager');
const downloader = require('../downloaders/downloader');
const storage = require('../downloaders/storage');
const settings = require('./settings');
const logger = require('../utils/log');
const { DOWNLOAD_DIR } = require('../utils/files');

/**
 * 初始化下载模块
 * 加载持久化任务、校验已完成任务文件存在性、恢复未完成任务、注册 IPC 处理程序
 * @returns {Promise<void>}
 */
async function init() {
  const initialTasks = await storage.loadTasks();
  taskManager.init(initialTasks);
  logger.info(`下载模块初始化完成，任务数量: ${initialTasks.length}`);

  // 校验已完成任务的输出文件是否仍然存在，缺失则修正状态为 missing
  await verifyCompletedTasks();

  // 从设置中加载并发配置
  await downloader.loadConcurrencySettings();

  resumePendingTasks();
  registerIpcHandlers();
}

/**
 * 启动时校验所有 completed 任务的输出文件是否存在
 * 文件缺失（被用户删除、保存目录被移动/重命名等）时，将状态修正为 missing，
 * 并写入 error 字段说明缺失原因，便于前端展示与重新下载
 * @returns {Promise<void>}
 */
async function verifyCompletedTasks() {
  const tasks = taskManager.getTasks();
  const completedTasks = tasks.filter(t => t.status === 'completed' && t.outputPath);
  if (completedTasks.length === 0) return;

  let missingCount = 0;
  for (const task of completedTasks) {
    try {
      const exists = await fs.pathExists(task.outputPath);
      if (!exists) {
        taskManager.updateTask(task.id, {
          status: 'missing',
          error: `输出文件不存在: ${task.outputPath}`
        });
        missingCount++;
        logger.warn(`[启动校验] 任务 ${task.id} 输出文件缺失，状态修正为 missing: ${task.outputPath}`);
      }
    } catch (error) {
      logger.error(`[启动校验] 检查任务 ${task.id} 文件存在性失败: ${error.message}`);
    }
  }
  if (missingCount > 0) {
    logger.info(`[启动校验] 共发现 ${missingCount} 个已完成任务的文件缺失，已修正状态`);
  }
}

/**
 * 恢复未完成的任务到下载队列
 */
function resumePendingTasks() {
  const pendingTasks = taskManager.getPendingTasks();
  if (pendingTasks.length > 0) {
    logger.info(`恢复未完成任务，数量: ${pendingTasks.length}`);
    pendingTasks.forEach(task => {
      task.status = 'waiting';
      downloader.enqueueTask(task);
    });
    storage.saveTasks(taskManager.getTasks());
  }
}

/**
 * 获取默认下载路径
 * @returns {Promise<string>} 默认下载路径
 */
async function getDefaultDownloadPath() {
  const downloadPath = await settings.getSetting('app.download');
  if (downloadPath) return downloadPath;
  return DOWNLOAD_DIR;
}

/**
 * 注册下载相关 IPC 处理程序
 */
function registerIpcHandlers() {
  ipcMain.handle('api.download.addTask', async (event, task) => {
    if (!task || typeof task !== 'object' || !task.url) {
      return { success: false, error: '无效的下载任务参数' };
    }
    try {
      const taskId = crypto.randomUUID();
      const defaultPath = await getDefaultDownloadPath();

      const newTask = {
        id: taskId,
        url: task.url,
        type: task.type || 'segment',
        savePath: task.savePath || defaultPath,
        fileName: task.fileName || `video_${Date.now()}.mp4`,
        thumbnail: task.thumbnail || '',
        videoId: task.videoId || '',
        keyInfo: task.keyInfo || null,
        sourceKey: task.sourceKey || '',
        description: task.description || '',
        quality: task.quality || '',
        videoData: task.videoData || null,
        status: 'waiting',
        totalSegments: 0,
        downloadedSegments: 0,
        progress: 0,
        speed: 0,
        remainingTime: 0,
        segments: [],
        tempDir: '',
        error: '',
        outputPath: '',
        finalSize: 0,
        downloadStats: {
          segmentTimes: [],
          segmentSizes: [],
          windowSize: 10,
          startTime: null,
          totalDownloadedSize: 0
        }
      };

      taskManager.addTask(newTask);
      event.sender.send('task-update', newTask);
      downloader.enqueueTask(newTask);

      return { success: true, data: { taskId } };
    } catch (error) {
      logger.error(`添加下载任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.addBatchTasks', async (event, taskList) => {
    if (!Array.isArray(taskList) || taskList.length === 0) {
      return { success: false, error: '无效的批量下载任务参数' };
    }
    try {
      const defaultPath = await getDefaultDownloadPath();
      const taskIds = [];
      const newTasks = [];

      taskList.forEach((task, index) => {
        const taskId = crypto.randomUUID();
        const newTask = {
          id: taskId,
          url: task.url,
          type: task.type || 'segment',
          savePath: task.savePath || defaultPath,
          fileName: task.fileName || `video_${Date.now()}_${index + 1}.mp4`,
          thumbnail: task.thumbnail || '',
          videoId: task.videoId || '',
          keyInfo: task.keyInfo || null,
          sourceKey: task.sourceKey || '',
          description: task.description || '',
          quality: task.quality || '',
          videoData: task.videoData || null,
          status: 'waiting',
          totalSegments: 0,
          downloadedSegments: 0,
          progress: 0,
          speed: 0,
          remainingTime: 0,
          segments: [],
          tempDir: '',
          error: '',
          outputPath: '',
          finalSize: 0,
          downloadStats: {
            segmentTimes: [],
            segmentSizes: [],
            windowSize: 10,
            startTime: null,
            totalDownloadedSize: 0
          }
        };

        taskManager.addTask(newTask);
        newTasks.push(newTask);
        taskIds.push(taskId);
        event.sender.send('task-update', newTask);
      });

      if (newTasks.length > 0) {
        downloader.enqueueTasks(newTasks);
      }

      return { success: true, data: { taskIds } };
    } catch (error) {
      logger.error(`批量添加下载任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.pauseTask', async (event, taskId) => {
    try {
      const task = taskManager.getTask(taskId);
      if (task) {
        taskManager.updateTask(taskId, { status: 'paused' });
        return { success: true, data: true };
      }
      return { success: false, error: '任务不存在' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.resumeTask', async (event, taskId) => {
    try {
      const task = taskManager.getTask(taskId);
      if (task) {
        taskManager.updateTask(taskId, { status: 'waiting' });
        downloader.enqueueTask(task);
        return { success: true, data: true };
      }
      return { success: false, error: '任务不存在' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.cancelTask', async (event, taskId, deleteFiles = false) => {
    try {
      const task = taskManager.removeTask(taskId);
      if (task) {
        await cleanupTaskFiles(task, deleteFiles);
        taskManager.notifyTaskListUpdated();
        return { success: true, data: true };
      }
      return { success: false, error: '任务不存在' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.retryTask', async (event, taskId) => {
    try {
      const task = taskManager.getTask(taskId);
      if (task) {
        taskManager.updateTask(taskId, {
          status: 'waiting',
          error: ''
        });
        downloader.enqueueTask(task);
        return { success: true, data: true };
      }
      return { success: false, error: '任务不存在' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.getTaskList', async () => {
    try {
      return { success: true, data: taskManager.getTasks() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.getTaskInfo', async (event, taskId) => {
    try {
      const task = taskManager.getTask(taskId);
      if (task) {
        return { success: true, data: task };
      }
      return { success: false, error: '任务不存在' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.checkFfmpeg', async () => {
    try {
      const ffmpeg = require('../downloaders/ffmpeg');
      const available = ffmpeg.checkFfmpeg();
      const ffmpegPath = ffmpeg.getFfmpegPath();
      return { success: true, data: { available, path: ffmpegPath } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.selectDownloadDir', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, data: result.filePaths[0] };
      }
      return { success: true, data: null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.openFile', async (event, filePath) => {
    try {
      await shell.openPath(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.download.openDir', async (event, dirPath) => {
    try {
      shell.showItemInFolder(dirPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

/**
 * 清理任务相关文件
 * 始终删除输出文件（mp4），deleteFiles 控制是否同时删除临时目录
 * @param {Object} task - 任务对象
 * @param {boolean} [deleteFiles=false] - 是否删除临时目录
 * @returns {Promise<void>}
 */
async function cleanupTaskFiles(task, deleteFiles = false) {
  try {
    if (task.outputPath && await fs.pathExists(task.outputPath)) {
      await fs.remove(task.outputPath);
      logger.info(`已删除输出文件: ${task.outputPath}`);
    }

    if (deleteFiles && task.tempDir && await fs.pathExists(task.tempDir)) {
      const taskDir = path.dirname(task.tempDir);
      await fs.remove(taskDir);
      logger.info(`已删除任务目录: ${taskDir}`);
    }
  } catch (error) {
    logger.error(`清理任务文件失败: ${error.message}`);
  }
}

module.exports = {
  init,
  registerIpcHandlers
};
