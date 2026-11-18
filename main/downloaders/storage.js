/**
 * 下载任务持久化存储模块
 * 复用项目 utils/files 工具进行文件存储
 */
const { read, write } = require('../utils/files');
const logger = require('../utils/log');

const STORAGE_KEY = 'videoApp.downloadTasks';

/**
 * 加载任务列表
 * @returns {Promise<Object[]>} 任务列表
 */
async function loadTasks() {
  try {
    const tasks = await read(STORAGE_KEY, []);
    return Array.isArray(tasks) ? tasks : [];
  } catch (error) {
    logger.error(`加载下载任务失败: ${error.message}`);
    return [];
  }
}

/**
 * 保存任务列表
 * @param {Object[]} tasks - 任务列表
 * @returns {Promise<boolean>} 是否保存成功
 */
async function saveTasks(tasks) {
  try {
    return await write(STORAGE_KEY, tasks);
  } catch (error) {
    logger.error(`保存下载任务失败: ${error.message}`);
    return false;
  }
}

module.exports = {
  loadTasks,
  saveTasks
};
