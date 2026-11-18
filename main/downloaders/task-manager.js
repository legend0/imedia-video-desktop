/**
 * 下载任务管理模块
 * 管理下载任务的生命周期、状态更新和持久化
 * 优化：Map 索引 O(1) 查找 + 持久化节流（2s 批量） + IPC 广播节流（100ms 合并进度）
 */
const { BrowserWindow } = require('electron');
const storage = require('./storage');
const logger = require('../utils/log');

/** @type {Array<Object>} 任务列表（保持顺序，便于序列化） */
let tasks = [];
/** @type {Map<string, Object>} 任务 ID 到任务对象的索引，O(1) 查找 */
const taskIndex = new Map();

/** 持久化节流：dirty 标记 + 2s 定时批量落盘 */
let persistDirty = false;
let persistTimer = null;
/** 进度类 IPC 广播节流：100ms 内合并同任务多次进度更新 */
const progressBroadcastTimers = new Map(); // taskId -> setTimeout handle
const PROGRESS_BROADCAST_DELAY = 100;
/** 进度更新与状态变更的判别字段（任一变化视为状态变更，立即广播） */
const STATUS_FIELDS = new Set(['status', 'error', 'outputPath', 'finalSize', 'totalSegments', 'tempDir', 'type', 'keyInfo', 'isEncrypted']);

/**
 * 同步 tasks 与 taskIndex（init / addTask / removeTask 时调用）
 */
function rebuildIndex() {
    taskIndex.clear();
    for (const t of tasks) {
        taskIndex.set(t.id, t);
    }
}

/**
 * 触发节流持久化：标记 dirty，2s 后批量落盘
 */
function schedulePersist() {
    persistDirty = true;
    if (persistTimer) return;
    persistTimer = setTimeout(async () => {
        persistTimer = null;
        if (!persistDirty) return;
        persistDirty = false;
        try {
            await storage.saveTasks(tasks);
        } catch (error) {
            logger.error(`任务持久化失败: ${error.message}`);
        }
    }, 2000);
}

/**
 * 立即持久化（用于 addTask / removeTask 等关键节点）
 */
async function persistNow() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    persistDirty = false;
    try {
        await storage.saveTasks(tasks);
    } catch (error) {
        logger.error(`任务持久化失败: ${error.message}`);
    }
}

/**
 * 向所有窗口广播单任务更新
 * @param {Object} task
 * @param {boolean} isStatusChange 是否为状态变更（true 立即广播，false 走节流）
 */
function broadcastTaskUpdate(task, isStatusChange) {
    if (isStatusChange) {
        // 状态变更：取消该任务挂起的进度广播，立即广播
        const pending = progressBroadcastTimers.get(task.id);
        if (pending) {
            clearTimeout(pending);
            progressBroadcastTimers.delete(task.id);
        }
        BrowserWindow.getAllWindows().forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send('task-update', task);
            }
        });
        return;
    }
    // 进度更新：100ms 节流合并
    if (progressBroadcastTimers.has(task.id)) return;
    const timer = setTimeout(() => {
        progressBroadcastTimers.delete(task.id);
        BrowserWindow.getAllWindows().forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send('task-update', task);
            }
        });
    }, PROGRESS_BROADCAST_DELAY);
    progressBroadcastTimers.set(task.id, timer);
}

/**
 * 判断 updates 是否包含状态变更字段
 * @param {Object} updates
 * @returns {boolean}
 */
function hasStatusChange(updates) {
    if (!updates || typeof updates !== 'object') return false;
    return Object.keys(updates).some(k => STATUS_FIELDS.has(k));
}

/**
 * 初始化任务管理器
 * @param {Object[]} initialTasks - 初始任务列表
 * @returns {void}
 */
function init(initialTasks) {
    tasks = initialTasks || [];
    rebuildIndex();
    logger.info(`任务管理器初始化完成，任务数量: ${tasks.length}`);
}

/**
 * 获取任务列表
 * @returns {Object[]} 任务列表
 */
function getTasks() {
    return tasks;
}

/**
 * 添加任务到列表（立即持久化 + 立即广播列表更新）
 * @param {Object} task - 任务对象
 * @returns {void}
 */
function addTask(task) {
    tasks.push(task);
    taskIndex.set(task.id, task);
    void persistNow();
    logger.info(`任务已添加: ${task.id}`);
}

/**
 * 更新任务信息并通知所有窗口
 * - 状态变更（status/error/outputPath 等）：立即持久化 + 立即广播
 * - 进度类更新：节流持久化（2s） + 节流广播（100ms）
 * @param {string} taskId - 任务ID
 * @param {Object} updates - 需要更新的字段
 * @returns {boolean} 是否更新成功
 */
function updateTask(taskId, updates) {
    const task = taskIndex.get(taskId);
    if (!task) {
        logger.warn(`更新任务失败，任务不存在: ${taskId}`);
        return false;
    }
    Object.assign(task, updates);
    const isStatusChange = hasStatusChange(updates);
    if (isStatusChange) {
        // 状态变更：立即落盘
        void persistNow();
    } else {
        // 进度更新：节流落盘
        schedulePersist();
    }
    broadcastTaskUpdate(task, isStatusChange);
    return true;
}

/**
 * 获取单个任务
 * @param {string} taskId - 任务ID
 * @returns {Object|null} 任务对象
 */
function getTask(taskId) {
    return taskIndex.get(taskId) || null;
}

/**
 * 删除任务（立即持久化 + 立即广播列表更新）
 * @param {string} taskId - 任务ID
 * @returns {Object|null} 被删除的任务对象
 */
function removeTask(taskId) {
    const taskIndexPos = tasks.findIndex(t => t.id === taskId);
    if (taskIndexPos !== -1) {
        const task = tasks[taskIndexPos];
        tasks.splice(taskIndexPos, 1);
        taskIndex.delete(taskId);
        // 清理挂起的进度广播
        const pending = progressBroadcastTimers.get(taskId);
        if (pending) {
            clearTimeout(pending);
            progressBroadcastTimers.delete(taskId);
        }
        void persistNow();
        logger.info(`任务已删除: ${taskId}`);
        return task;
    }
    return null;
}

/**
 * 获取等待中的任务
 * @returns {Object[]} 等待中的任务列表
 */
function getPendingTasks() {
    return tasks.filter(t => t.status === 'waiting' || t.status === 'downloading');
}

/**
 * 向所有窗口推送任务列表更新（仅在添加/删除任务时调用）
 * 进度更新走单任务广播，不调用此方法
 * @returns {void}
 */
function notifyTaskListUpdated() {
    BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
            window.webContents.send('task-list-updated', tasks);
        }
    });
}

module.exports = {
    init,
    getTasks,
    addTask,
    updateTask,
    getTask,
    removeTask,
    getPendingTasks,
    notifyTaskListUpdated
};
