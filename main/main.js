const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { ensureAppDirs, APP_ROOT } = require('./utils/files');

// 命令行开关必须在 app.whenReady() 之前、文件顶部设置，确保生效
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

// 禁用 Electron 安全警告（CSP/webSecurity 等）
// 应用需要跨域加载视频资源，已通过 webSecurity:false + 自定义 CSP 处理
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 为Windows设置应用ID，确保任务栏图标正确显示
if (process.platform === 'win32') {
  app.setAppUserModelId('com.Imedia.video');
}

// 导入各模块
const sourceManager = require('./core/sourceManager');
const videoEngine = require('./core/videoEngine');
const settings = require('./core/settings');
const userMedia = require('./core/userMedia');
const cache = require('./core/cache');
const logger = require('./utils/log');
const PlayerWindowManager = require('./playerWindowManager');
const downloadModule = require('./core/downloader');
const mediaInfo = require('./core/mediaInfo');
const hotSearch = require('./core/hotSearch');
const backup = require('./core/backup');
const iptv = require('./core/iptv');
const httpUtil = require('./utils/http');
const proxy = require('./proxy');

// 全局变量
let mainWindow = null;
let tray = null;
let isQuitting = false;
let playerWindowManager = null;


const { isDev } = require('./utils/env');

/**
 * 在 Windows/Linux 上显示托盘气泡通知（抽取自 close/hide 重复逻辑）
 */
function showTrayBalloon() {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  if (!tray) return;
  tray.displayBalloon({
    icon: nativeImage.createFromPath(path.join(__dirname, '../view/icons/icon.png')),
    title: '影视岛',
    content: '应用已最小化到系统托盘'
  });
}

/**
 * 创建主窗口
 */
function createWindow() {
  logger.info('开始创建主窗口...');
  
  // 根据平台选择合适的图标
  let iconPath;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, '../view/icons/icon.ico');
  } else {
    iconPath = path.join(__dirname, '../view/icons/icon.png');
  }
  
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // 无边框
    icon: iconPath, // 设置窗口图标
    show: true, // 立即显示窗口
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // 禁用webSecurity以解决跨域问题
      allowRunningInsecureContent: true // 允许运行不安全内容
    }
  });

  logger.info('主窗口已创建，开始加载应用...');

  if (isDev) {
     //mainWindow.loadFile(path.join(__dirname, '../view/index.html'));
     mainWindow.loadURL('http://localhost:5173/');
    logger.debug('开发环境：打开开发者工具');
     mainWindow.webContents.openDevTools();
  } else {
    // 加载应用
    mainWindow.loadFile(path.join(__dirname, '../view/index.html'));
  }

  
  // 窗口关闭事件 - 隐藏到托盘而不是关闭
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      showTrayBalloon();
    }
  });
  

  // 窗口被销毁时清理引用和关联的播放器窗口
  mainWindow.on('closed', () => {
    mainWindow = null;
    // 销毁可能仍存在的播放器窗口，避免孤儿进程
    if (playerWindowManager) {
      playerWindowManager.destroy();
    }
  });

  // 窗口状态变化事件
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state-changed', { isMaximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state-changed', { isMaximized: false });
  });

  logger.info('主窗口创建完成');
  
  // 设置会话级别的CORS策略，解决跨域问题
  const session = mainWindow.webContents.session;
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // 移除可能存在的旧CSP头，避免重复
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy'];
    callback({
      responseHeaders: {
        ...headers,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With'],
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; img-src * data: blob:; media-src * data: blob:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src * data: blob:"
        ]
      }
    });
  });
  
  // 创建系统托盘
  createTray();
  
  return mainWindow;
}

/**
 * 创建系统托盘
 */
function createTray() {
  if (tray) return;
  
  // 创建托盘图标
  let iconPath;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, '../view/icons/icon.ico');
  } else {
    iconPath = path.join(__dirname, '../view/icons/icon.png');
  }
  
  tray = new Tray(nativeImage.createFromPath(iconPath));

  // 设置托盘提示
  tray.setToolTip('影视岛');

  // 设置托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '退出应用',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示主窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

/**
 * 注册IPC处理程序
 */
function registerIpcHandlers() {
  // 窗口控制API
  ipcMain.handle('api.window.minimize', () => {
    if (mainWindow) {
      mainWindow.minimize();
      return { success: true };
    }
    return { success: false, error: '主窗口未初始化' };
  });

  ipcMain.handle('api.window.maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        return { isMaximized: false };
      } else {
        mainWindow.maximize();
        return { isMaximized: true };
      }
    }
    return { success: false, error: '主窗口未初始化' };
  });

  ipcMain.handle('api.window.restore', () => {
    if (mainWindow) {
      mainWindow.restore();
      return { success: true };
    }
    return { success: false, error: '主窗口未初始化' };
  });

  ipcMain.handle('api.window.close', () => {
    if (mainWindow) {
      isQuitting = true;
      mainWindow.close();
      if (playerWindowManager) {
        playerWindowManager.destroy();
      }
      return { success: true };
    }
    return { success: false, error: '主窗口未初始化' };
  });

  ipcMain.handle('api.window.hide', () => {
    if (mainWindow) {
      mainWindow.hide();
      showTrayBalloon();
      return { success: true };
    }
    return { success: false, error: '主窗口未初始化' };
  });

  ipcMain.handle('api.window.show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      return { success: true };
    }
    return { success: false, error: '主窗口未初始化' };
  });

  ipcMain.handle('api.window.isMaximized', () => {
    if (mainWindow) {
      return mainWindow.isMaximized();
    }
    return false;
  });

  // 应用控制API
  ipcMain.handle('api.app.version', () => {
    return app.getVersion();
  });

  ipcMain.handle('api.app.quit', () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.handle('api.app.restart', () => {
    app.relaunch();
    app.exit();
  });

  // 对话框API
  ipcMain.handle('api.dialog.openFile', async (event, options) => {
    if (!mainWindow) return { success: false, error: '主窗口未初始化' };
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      return { success: false, error: '无效的对话框参数' };
    }
    return await dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle('api.dialog.saveFile', async (event, options) => {
    if (!mainWindow) return { success: false, error: '主窗口未初始化' };
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      return { success: false, error: '无效的对话框参数' };
    }
    return await dialog.showSaveDialog(mainWindow, options);
  });

  ipcMain.handle('api.dialog.showMessageBox', async (event, options) => {
    if (!mainWindow) return { success: false, error: '主窗口未初始化' };
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      return { success: false, error: '无效的对话框参数' };
    }
    return await dialog.showMessageBox(mainWindow, options);
  });

  // 设置API - 直接返回值，不包装
  ipcMain.handle('api.settings.get', async (event, key) => {
    return await settings.getSetting(key);
  });

  ipcMain.handle('api.settings.set', async (event, key, value) => {
    return await settings.setSetting(key, value);
  });

  ipcMain.handle('api.settings.getAll', async () => {
    return await settings.getAllSettings();
  });

  ipcMain.handle('api.settings.setAll', async (event, newSettings) => {
    return await settings.setSettings(newSettings);
  });

  ipcMain.handle('api.settings.reset', async () => {
    return await settings.resetAllSettings();
  });

  // 视频源管理API
  ipcMain.handle('api.sourceManager.getSources', async () => {
    return await sourceManager.getSourceList();
  });

  ipcMain.handle('api.sourceManager.addSource', async (event, key, source) => {
    return await sourceManager.addSource(key, source);
  });

  ipcMain.handle('api.sourceManager.updateSource', async (event, sourceKey, source) => {
    return await sourceManager.updateSource(sourceKey, source);
  });

  ipcMain.handle('api.sourceManager.removeSource', async (event, sourceKey) => {
    return await sourceManager.removeSource(sourceKey);
  });

  ipcMain.handle('api.sourceManager.getCurrentSource', async () => {
    return await sourceManager.getCurrentSource();
  });

  ipcMain.handle('api.sourceManager.setCurrentSource', async (event, sourceKey) => {
    return await sourceManager.switchSource(sourceKey);
  });

  ipcMain.handle('api.sourceManager.testSource', async (event, sourceKey) => {
    return await sourceManager.testSource(sourceKey);
  });

  ipcMain.handle('api.sourceManager.subscribe', async (event, url) => {
    return await sourceManager.subscribeSources(url);
  });

  // 视频引擎API
  ipcMain.handle('api.videoEngine.getCategories', async (event, options = {}) => {
    // 直接使用原始数据，不进行转换
    return await videoEngine.getCategories(options);
  });

  ipcMain.handle('api.videoEngine.getVideos', async (event, categoryId, options = {}) => {
    if (!categoryId || (typeof categoryId !== 'string' && typeof categoryId !== 'number')) {
      return { list: [], total: 0, page: 1 };
    }
    // 直接使用原始数据，不进行转换
    return await videoEngine.getVideos(categoryId, options);
  });

  ipcMain.handle('api.videoEngine.search', async (event, keyword, options = {}) => {
    if (!keyword || typeof keyword !== 'string') {
      return { list: [], total: 0, page: 1, keyword: '' };
    }
    return await videoEngine.searchVideos(keyword, options);
  });

  ipcMain.handle('api.videoEngine.getVideoDetail', async (event, videoId) => {
    if (!videoId || (typeof videoId !== 'string' && typeof videoId !== 'number')) {
      return null;
    }
    return await videoEngine.getVideoDetail(videoId);
  });

  ipcMain.handle('api.videoEngine.clearCache', async () => {
    return await videoEngine.clearVideoCache();
  });

  ipcMain.handle('api.videoEngine.mediainfo', async (event, movieName, options = {}) => {
    return await mediaInfo.queryMediaInfo(movieName, options);
  });

  ipcMain.handle('api.videoEngine.hotSearch', async () => {
    return await hotSearch.fetchHotSearch();
  });

  // 用户媒体API
  ipcMain.handle('api.userMedia.getFavorites', async () => {
    try {
      const favorites = await userMedia.FavoritesManager.getAll();
      return {
        success: true,
        data: favorites
      };
    } catch (error) {
      logger.error(`获取收藏列表失败: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('api.userMedia.addToFavorites', async (event, video) => {
    // 直接使用原始数据，不进行验证和转换
    return await userMedia.FavoritesManager.add(video);
  });

  ipcMain.handle('api.userMedia.removeFromFavorites', async (event, videoId, sourceKey = null) => {
    return await userMedia.FavoritesManager.remove(videoId, sourceKey);
  });

  ipcMain.handle('api.userMedia.isFavorite', async (event, videoId, sourceKey = null) => {
    return await userMedia.FavoritesManager.has(videoId, sourceKey);
  });

  ipcMain.handle('api.userMedia.getHistory', async (event, options = {}) => {
    return await userMedia.HistoryManager.getAll(options);
  });

  ipcMain.handle('api.userMedia.addToHistory', async (event, video) => {
    // 直接使用原始数据，不进行验证和转换
    return await userMedia.HistoryManager.add(video);
  });

  ipcMain.handle('api.userMedia.removeHistory', async (event, videoId, sourceKey = null) => {
    return await userMedia.HistoryManager.remove(videoId, sourceKey);
  });

  ipcMain.handle('api.userMedia.clearHistory', async () => {
    return await userMedia.HistoryManager.clear();
  });

  // Shell API
  ipcMain.handle('api.shell.openPath', async (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: '无效的文件路径' };
    }
    try {
      await shell.openPath(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api.shell.showItemInFolder', async (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: '无效的文件路径' };
    }
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 备份管理 API
  ipcMain.handle('api.backup.exportToFile', async (event, dataTypes) => {
    return await backup.exportToFile(dataTypes);
  });

  ipcMain.handle('api.backup.importFromFile', async (event, dataTypes) => {
    return await backup.importFromFile(dataTypes);
  });

  ipcMain.handle('api.backup.createLocal', async (event, dataTypes) => {
    return await backup.createLocalBackup(dataTypes);
  });

  ipcMain.handle('api.backup.getLocalList', async () => {
    return await backup.getLocalBackups();
  });

  ipcMain.handle('api.backup.deleteLocal', async (event, id) => {
    return await backup.deleteLocalBackup(id);
  });

  ipcMain.handle('api.backup.downloadLocal', async (event, id) => {
    return await backup.downloadLocalBackup(id);
  });

  ipcMain.handle('api.backup.getWebDAVConfig', async () => {
    return { success: true, data: await backup.getWebDAVConfig() };
  });

  ipcMain.handle('api.backup.setWebDAVConfig', async (event, config) => {
    return { success: await backup.setWebDAVConfig(config) };
  });

  ipcMain.handle('api.backup.testWebDAV', async (event, config) => {
    return await backup.testWebDAV(config);
  });

  ipcMain.handle('api.backup.uploadToWebDAV', async (event, dataTypes) => {
    return await backup.uploadToWebDAV(dataTypes);
  });

  ipcMain.handle('api.backup.listWebDAV', async () => {
    return await backup.listWebDAVBackups();
  });

  ipcMain.handle('api.backup.downloadFromWebDAV', async (event, fileName, dataTypes) => {
    return await backup.downloadFromWebDAV(fileName, dataTypes);
  });

  ipcMain.handle('api.backup.deleteFromWebDAV', async (event, fileName) => {
    return await backup.deleteFromWebDAV(fileName);
  });

  // M3U8 加速代理 API
  // 创建加速会话：返回 { ok, sessionId, playUrl, baseUrl, meta }
  // 播放器应优先使用 playUrl 加载 HLS；失败时降级为原始 url 直连
  ipcMain.handle('api.proxy.boost', async (event, url, opts) => {
    return await proxy.boost(url, opts || {});
  });

  // 销毁会话（可选，TTL 自动销毁已启用）
  ipcMain.handle('api.proxy.expire', async (event, sessionId) => {
    return await proxy.expireSession(sessionId);
  });

  // 获取会话实时状态（用于播放器视频信息统计）
  ipcMain.handle('api.proxy.sessionInfo', async (event, sessionId) => {
    return proxy.getSessionInfo(sessionId);
  });

  // 列出所有活跃会话
  ipcMain.handle('api.proxy.sessions', async () => {
    return proxy.listSessions();
  });

  // 全局统计（内存/磁盘/缓存命中率/请求计数）
  ipcMain.handle('api.proxy.stats', async () => {
    return proxy.getStats();
  });

  // 电视直播（IPTV）API
  // 触发订阅更新：拉取 → 解析 → 永久缓存
  ipcMain.handle('api.iptv.updateSubscription', async (event, url) => {
    if (!url || typeof url !== 'string') {
      return { success: false, error: '订阅地址不能为空' };
    }
    return await iptv.updateSubscription(url);
  });

  // 获取缓存的频道列表（永久缓存，直至手动更新）
  ipcMain.handle('api.iptv.getChannels', async () => {
    return await iptv.getChannels();
  });

  // 获取缓存的分组列表
  ipcMain.handle('api.iptv.getGroups', async () => {
    return await iptv.getGroups();
  });

  // 获取当前订阅地址（未设置时返回默认地址）
  ipcMain.handle('api.iptv.getSubscriptionUrl', async () => {
    return await iptv.getSubscriptionUrl();
  });

  // 获取缓存元信息（更新时间等）
  ipcMain.handle('api.iptv.getCacheInfo', async () => {
    const data = await iptv.getCachedData();
    if (!data) return { success: false, data: null };
    return {
      success: true,
      data: { updatedAt: data.updatedAt, url: data.url, count: data.channels.length, groups: data.groups.length },
    };
  });
}

// 获取应用程序实例锁
const gotTheLock = app.requestSingleInstanceLock();

// 如果没有获取到锁，说明已经有实例在运行，退出当前实例
if (!gotTheLock) {
  logger.info('应用程序已在运行中，退出当前实例');
  app.quit();
} else {
  // 监听第二个实例启动事件
  app.on('second-instance', () => {
    // 当运行第二个实例时，将会聚焦到mainWindow这个窗口
    logger.info('检测到第二个实例启动，聚焦到主窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(async () => {
    logger.info('Electron已准备就绪');
    logger.debug(`应用根目录: ${APP_ROOT}`);
    
    try {
      await ensureAppDirs();
      logger.info('应用目录初始化完成');
    } catch (error) {
      logger.error(`应用目录初始化失败: ${error.message}`);
    }

    // 清理过期日志（保留 7 天），避免日志文件无限增长
    try {
      await logger.cleanOldLogs(7);
      logger.info('过期日志清理完成');
    } catch (error) {
      logger.warn(`过期日志清理失败: ${error.message}`);
    }
    
    try {
      createWindow();
      
      // 注册IPC处理程序
      registerIpcHandlers();

      // 当所有窗口关闭时的行为
      app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
          app.quit();
        }
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });

      // 应用退出前清理
      app.on('before-quit', async () => {
        if (playerWindowManager) {
          playerWindowManager.destroy();
        }
        // 关闭加速代理并清理所有会话缓存
        try {
          await proxy.shutdownProxy();
        } catch (e) {
          logger.error(`关闭加速代理异常: ${e.message}`);
        }
      });

      // 主窗口显示后执行后台初始化（不阻塞启动）
      setTimeout(async () => {
        await initializeBackgroundServices();
      }, 100);
    } catch (error) {
      logger.error(`应用初始化失败: ${error.message}`);
      app.quit();
    }
  });

  /**
   * 初始化后台服务
   * 这些操作不阻塞主窗口启动，在后台异步执行
   */
  async function initializeBackgroundServices() {
    logger.info('开始初始化后台服务...');

    // 0. 初始化全局网络配置（UA + 代理），并监听设置变更
    try {
      await httpUtil.refreshNetworkConfig();
      settings.on('settingsChanged', (detail) => {
        if (!detail || detail.key === 'network' || detail.key?.startsWith('network.')) {
          httpUtil.refreshNetworkConfig();
        }
      });
      logger.info('全局网络配置初始化完成');
    } catch (error) {
      logger.error(`初始化全局网络配置失败: ${error.message}`);
    }

    // 1. 清理过期缓存
    try {
      logger.info('开始清理过期缓存...');
      const cleanDetails = await cache.cleanExpired();
      
      // 记录清理明细
      if (cleanDetails.totalCount > 0) {
        logger.info(`缓存清理完成 - 总计: ${cleanDetails.totalCount}个, 总大小: ${(cleanDetails.totalSize / 1024).toFixed(2)}KB`);
        logger.info(`  内存缓存: ${cleanDetails.memoryCount}个, ${(cleanDetails.memorySize / 1024).toFixed(2)}KB`);
        logger.info(`  磁盘缓存: ${cleanDetails.diskCount}个, ${(cleanDetails.diskSize / 1024).toFixed(2)}KB`);
        
        // 记录清理的缓存键（最多记录前10个）
        if (cleanDetails.memoryCleaned.length > 0) {
          const memoryKeys = cleanDetails.memoryCleaned.slice(0, 10).map(item => item.key).join(', ');
          logger.info(`  内存缓存键: ${memoryKeys}${cleanDetails.memoryCleaned.length > 10 ? '...' : ''}`);
        }
        if (cleanDetails.diskCleaned.length > 0) {
          const diskKeys = cleanDetails.diskCleaned.slice(0, 10).map(item => item.key).join(', ');
          logger.info(`  磁盘缓存键: ${diskKeys}${cleanDetails.diskCleaned.length > 10 ? '...' : ''}`);
        }
      } else {
        logger.info('没有发现过期缓存');
      }
    } catch (error) {
      logger.error(`清理过期缓存失败: ${error.message}`);
    }

    // 2. 初始化播放器窗口管理器
    try {
      playerWindowManager = new PlayerWindowManager({
        autoDestroyDelay: 30000 * 60 * 1000 // 30000分钟（约500小时）不使用自动销毁
      });
      logger.info('播放器窗口管理器初始化完成');
    } catch (error) {
      logger.error(`初始化播放器窗口管理器失败: ${error.message}`);
      playerWindowManager = null;
    }

    // 3. 初始化下载模块
    try {
      await downloadModule.init();
      logger.info('下载模块初始化完成');
    } catch (error) {
      logger.error(`初始化下载模块失败: ${error.message}`);
    }

    // 4. 视频源自动订阅（启动后延迟 1 分钟触发，当天已订阅则跳过）
    try {
      const autoSubscribe = await settings.getSetting('source.autoSubscribe', false);
      if (autoSubscribe) {
        const today = new Date().toISOString().slice(0, 10);
        const lastDate = await settings.getSetting('source.lastSubscribeDate', '');
        if (lastDate !== today) {
          logger.info('视频源自动订阅已开启，将在 1 分钟后执行');
          setTimeout(async () => {
            try {
              const subUrl = await settings.getSetting('ui.subscriptionUrl', '');
              if (!subUrl) {
                logger.info('视频源自动订阅：未配置订阅地址，跳过');
                return;
              }
              logger.info(`视频源自动订阅：开始执行，地址 ${subUrl}`);
              const result = await sourceManager.subscribeSources(subUrl);
              if (result.success) {
                await settings.setSetting('source.lastSubscribeDate', today);
                logger.info(`视频源自动订阅完成：新增 ${result.data.added}，跳过 ${result.data.skipped}，失败 ${result.data.failed}`);
              } else {
                logger.warn(`视频源自动订阅失败：${result.error}`);
              }
            } catch (err) {
              logger.error(`视频源自动订阅执行异常: ${err.message}`);
            }
          }, 60 * 1000);
        } else {
          logger.info('视频源自动订阅：今天已订阅，跳过');
        }
      }
    } catch (error) {
      logger.error(`视频源自动订阅初始化失败: ${error.message}`);
    }

    // 4.1 IPTV 自动订阅（独立于视频源订阅，由 iptv.autoSubscribe 控制）
    try {
      const iptvAutoSubscribe = await settings.getSetting('iptv.autoSubscribe', false);
      if (iptvAutoSubscribe) {
        const today = new Date().toISOString().slice(0, 10);
        const lastDate = await settings.getSetting('iptv.lastSubscribeDate', '');
        if (lastDate !== today) {
          logger.info('IPTV 自动订阅已开启，将在 1 分钟后执行');
          setTimeout(async () => {
            try {
              const subUrl = await settings.getSetting('iptv.subscriptionUrl', '');
              if (!subUrl) {
                logger.warn('IPTV 自动订阅：未配置订阅地址，跳过');
                return;
              }
              logger.info(`IPTV 自动订阅：开始执行，地址 ${subUrl}`);
              const result = await iptv.updateSubscription(subUrl);
              if (result.success) {
                await settings.setSetting('iptv.lastSubscribeDate', today);
                logger.info(`IPTV 自动订阅完成：${result.data.count} 个频道，${result.data.groups} 个分组`);
              } else {
                logger.warn(`IPTV 自动订阅失败：${result.error}`);
              }
            } catch (err) {
              logger.error(`IPTV 自动订阅执行异常: ${err.message}`);
            }
          }, 60 * 1000);
        } else {
          logger.info('IPTV 自动订阅：今天已订阅，跳过');
        }
      }
    } catch (error) {
      logger.error(`IPTV 自动订阅初始化失败: ${error.message}`);
    }

    // 5. 源自动检查（按设定的小时间隔触发测试）
    try {
      const autoCheck = await settings.getSetting('source.autoCheck', false);
      if (autoCheck) {
        const intervalHours = await settings.getSetting('source.autoCheckIntervalHours', 6);
        const intervalMs = intervalHours * 60 * 60 * 1000;
        logger.info(`自动检查源已开启，间隔 ${intervalHours} 小时`);
        setInterval(async () => {
          try {
            logger.info('自动检查源：开始测试全部源...');
            await sourceManager.testAllSources();
            logger.info('自动检查源：测试完成');
          } catch (err) {
            logger.error(`自动检查源执行异常: ${err.message}`);
          }
        }, intervalMs);
      }
    } catch (error) {
      logger.error(`自动检查源初始化失败: ${error.message}`);
    }

    // 6. 初始化 M3U8 加速代理（绑定 127.0.0.1:7788，失败不阻塞应用）
    try {
      const r = await proxy.initProxy();
      if (r.ok) {
        logger.info(`M3U8 加速代理已启动: ${r.baseUrl}`);
      } else {
        logger.warn(`M3U8 加速代理启动失败（已降级为直连）: ${r.error}`);
      }
    } catch (error) {
      logger.error(`M3U8 加速代理初始化异常: ${error.message}`);
    }

    logger.info('后台服务初始化完成');
  }
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error(`未捕获的异常: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`未处理的Promise拒绝: ${reason}`);
});