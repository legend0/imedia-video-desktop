const { contextBridge, ipcRenderer } = require('electron');

// 事件监听器映射：eventName -> Map<originalCallback, wrapperHandler>
// 用于正确追踪和移除事件监听器
const _eventHandlers = new Map();

// 创建API对象
const api = {
  // 窗口控制API
  window: {
    minimize: () => ipcRenderer.invoke('api.window.minimize'),
    maximize: () => ipcRenderer.invoke('api.window.maximize'),
    restore: () => ipcRenderer.invoke('api.window.restore'),
    close: () => ipcRenderer.invoke('api.window.close'),
    hide: () => ipcRenderer.invoke('api.window.hide'),
    show: () => ipcRenderer.invoke('api.window.show'),
    isMaximized: () => ipcRenderer.invoke('api.window.isMaximized')
  },
  
  // 应用控制API
  app: {
    version: () => ipcRenderer.invoke('api.app.version'),
    quit: () => ipcRenderer.invoke('api.app.quit'),
    restart: () => ipcRenderer.invoke('api.app.restart')
  },
  
  // 对话框API
  dialog: {
    openFile: (options) => ipcRenderer.invoke('api.dialog.openFile', options),
    saveFile: (options) => ipcRenderer.invoke('api.dialog.saveFile', options),
    showMessageBox: (options) => ipcRenderer.invoke('api.dialog.showMessageBox', options)
  },
  
  // 视频源管理API
  source: {
    getSourceList: () => ipcRenderer.invoke('api.sourceManager.getSources'),
    addSource: (key, source) => ipcRenderer.invoke('api.sourceManager.addSource', key, source),
    updateSource: (sourceKey, source) => ipcRenderer.invoke('api.sourceManager.updateSource', sourceKey, source),
    removeSource: (sourceKey) => ipcRenderer.invoke('api.sourceManager.removeSource', sourceKey),
    getCurrentSource: () => ipcRenderer.invoke('api.sourceManager.getCurrentSource'),
    setCurrentSource: (sourceKey) => ipcRenderer.invoke('api.sourceManager.setCurrentSource', sourceKey),
    testSource: (sourceKey) => ipcRenderer.invoke('api.sourceManager.testSource', sourceKey),
    subscribe: (url) => ipcRenderer.invoke('api.sourceManager.subscribe', url)
  },
  
  // 视频引擎API
  video: {
    getCategories: (options) => ipcRenderer.invoke('api.videoEngine.getCategories', options),
    getVideos: (categoryId, options) => ipcRenderer.invoke('api.videoEngine.getVideos', categoryId, options),
    search: (keyword, options) => ipcRenderer.invoke('api.videoEngine.search', keyword, options),
    getVideoDetail: (videoId) => ipcRenderer.invoke('api.videoEngine.getVideoDetail', videoId),
    mediainfo: (movieName, options) => ipcRenderer.invoke('api.videoEngine.mediainfo', movieName, options),
    clearCache: () => ipcRenderer.invoke('api.videoEngine.clearCache'),
    hotSearch: () => ipcRenderer.invoke('api.videoEngine.hotSearch'),
  },
  
  // 设置API
  settings: {
    get: (key) => ipcRenderer.invoke('api.settings.get', key),
    set: (key, value) => ipcRenderer.invoke('api.settings.set', key, value),
    getAll: () => ipcRenderer.invoke('api.settings.getAll'),
    setAll: (settings) => ipcRenderer.invoke('api.settings.setAll', settings),
    reset: () => ipcRenderer.invoke('api.settings.reset')
  },
  
  // 用户媒体API
  user: {
    getFavorites: () => ipcRenderer.invoke('api.userMedia.getFavorites'),
    addToFavorites: (video) => ipcRenderer.invoke('api.userMedia.addToFavorites', video),
    removeFromFavorites: (videoId) => ipcRenderer.invoke('api.userMedia.removeFromFavorites', videoId),
    isFavorite: (videoId) => ipcRenderer.invoke('api.userMedia.isFavorite', videoId),
    getHistory: (options) => ipcRenderer.invoke('api.userMedia.getHistory', options),
    addToHistory: (video) => ipcRenderer.invoke('api.userMedia.addToHistory', video),
    removeHistory: (videoId, sourceKey) => ipcRenderer.invoke('api.userMedia.removeHistory', videoId, sourceKey),
    clearHistory: () => ipcRenderer.invoke('api.userMedia.clearHistory')
  },
  
  // 播放器API
  player: {
    // 打开播放器
    open: (videoData) => ipcRenderer.invoke('api.player.open', videoData),
    
    // 关闭播放器
    close: () => ipcRenderer.invoke('api.player.close'),
    
    // 隐藏播放器
    hide: () => ipcRenderer.invoke('api.player.hide'),
    
    // 显示播放器
    show: () => ipcRenderer.invoke('api.player.show'),
    
    // 检查播放器是否在播放
    isPlaying: () => ipcRenderer.invoke('api.player.isPlaying'),
    
    // 最小化播放器
    minimize: () => ipcRenderer.invoke('api.player.minimize'),
    
    // 切换最大化/正常状态
    toggleMaximize: () => ipcRenderer.invoke('api.player.toggleMaximize'),
    
    // 检查是否最大化
    isMaximized: () => ipcRenderer.invoke('api.player.isMaximized'),
    
    // 切换全屏
    toggleFullscreen: () => ipcRenderer.invoke('api.player.toggleFullscreen'),
    
    // 检查是否全屏
    isFullscreen: () => ipcRenderer.invoke('api.player.isFullscreen'),
    
    // 切换画中画
    togglePictureInPicture: () => ipcRenderer.invoke('api.player.togglePictureInPicture'),
    
    // 检查是否画中画
    isPictureInPicture: () => ipcRenderer.invoke('api.player.isPictureInPicture'),

    // 沉浸模式
    setImmersiveMode: (enabled) => ipcRenderer.invoke('api.player.setImmersiveMode', enabled)
  },
  
  // Shell API
  shell: {
    // 打开文件
    openPath: (path) => ipcRenderer.invoke('api.shell.openPath', path),
    
    // 在文件夹中显示文件
    showItemInFolder: (path) => ipcRenderer.invoke('api.shell.showItemInFolder', path)
  },
  
  // 下载管理API
  download: {
    addTask: (task) => ipcRenderer.invoke('api.download.addTask', task),
    addBatchTasks: (taskList) => ipcRenderer.invoke('api.download.addBatchTasks', taskList),
    pauseTask: (taskId) => ipcRenderer.invoke('api.download.pauseTask', taskId),
    resumeTask: (taskId) => ipcRenderer.invoke('api.download.resumeTask', taskId),
    cancelTask: (taskId) => ipcRenderer.invoke('api.download.cancelTask', taskId),
    retryTask: (taskId) => ipcRenderer.invoke('api.download.retryTask', taskId),
    getTaskList: () => ipcRenderer.invoke('api.download.getTaskList'),
    getTaskInfo: (taskId) => ipcRenderer.invoke('api.download.getTaskInfo', taskId),
    selectDownloadDir: () => ipcRenderer.invoke('api.download.selectDownloadDir'),
    checkFfmpeg: () => ipcRenderer.invoke('api.download.checkFfmpeg'),
    openFile: (filePath) => ipcRenderer.invoke('api.download.openFile', filePath),
    openDir: (dirPath) => ipcRenderer.invoke('api.download.openDir', dirPath)
  },

  // 备份管理API
  backup: {
    exportToFile: (dataTypes) => ipcRenderer.invoke('api.backup.exportToFile', dataTypes),
    importFromFile: (dataTypes) => ipcRenderer.invoke('api.backup.importFromFile', dataTypes),
    createLocal: (dataTypes) => ipcRenderer.invoke('api.backup.createLocal', dataTypes),
    getLocalList: () => ipcRenderer.invoke('api.backup.getLocalList'),
    deleteLocal: (id) => ipcRenderer.invoke('api.backup.deleteLocal', id),
    downloadLocal: (id) => ipcRenderer.invoke('api.backup.downloadLocal', id),
    getWebDAVConfig: () => ipcRenderer.invoke('api.backup.getWebDAVConfig'),
    setWebDAVConfig: (config) => ipcRenderer.invoke('api.backup.setWebDAVConfig', config),
    testWebDAV: (config) => ipcRenderer.invoke('api.backup.testWebDAV', config),
    uploadToWebDAV: (dataTypes) => ipcRenderer.invoke('api.backup.uploadToWebDAV', dataTypes),
    listWebDAV: () => ipcRenderer.invoke('api.backup.listWebDAV'),
    downloadFromWebDAV: (fileName, dataTypes) => ipcRenderer.invoke('api.backup.downloadFromWebDAV', fileName, dataTypes),
    deleteFromWebDAV: (fileName) => ipcRenderer.invoke('api.backup.deleteFromWebDAV', fileName)
  },

  // M3U8 加速代理 API
  // 播放器加载 HLS 时应优先调用 boost 获取本地加速 URL，
  // 失败时降级为原始 url 直连（hls.js 直接加载源地址）
  proxy: {
    // 创建加速会话，返回 { ok, sessionId, playUrl, baseUrl, meta }
    boost: (url, opts) => ipcRenderer.invoke('api.proxy.boost', url, opts),
    // 销毁会话（可选，TTL 自动销毁已启用）
    expire: (sessionId) => ipcRenderer.invoke('api.proxy.expire', sessionId),
    // 获取会话实时状态（含统计信息：分片下载耗时、缓存命中率等）
    sessionInfo: (sessionId) => ipcRenderer.invoke('api.proxy.sessionInfo', sessionId),
    // 列出所有活跃会话
    sessions: () => ipcRenderer.invoke('api.proxy.sessions'),
    // 全局统计（内存/磁盘/缓存命中率/请求计数）
    stats: () => ipcRenderer.invoke('api.proxy.stats')
  },

  // 电视直播（IPTV）API
  // 订阅更新后频道列表永久缓存于后端，直至下次手动更新
  iptv: {
    // 触发订阅更新（Base64 解码 → 拉取 → 解析 → 永久缓存）
    updateSubscription: (url) => ipcRenderer.invoke('api.iptv.updateSubscription', url),
    // 获取缓存的频道列表
    getChannels: () => ipcRenderer.invoke('api.iptv.getChannels'),
    // 获取缓存的分组列表
    getGroups: () => ipcRenderer.invoke('api.iptv.getGroups'),
    // 获取当前订阅地址（未设置时返回默认地址）
    getSubscriptionUrl: () => ipcRenderer.invoke('api.iptv.getSubscriptionUrl'),
    // 获取缓存元信息（更新时间、频道数、分组数）
    getCacheInfo: () => ipcRenderer.invoke('api.iptv.getCacheInfo')
  },
  
  // 事件监听API
  on: (eventName, callback) => {
    const handler = (event, ...args) => {
      callback(...args);
    };
    ipcRenderer.on(eventName, handler);
    // 追踪 wrapper 以便 off 时正确移除
    if (!_eventHandlers.has(eventName)) {
      _eventHandlers.set(eventName, new Map());
    }
    _eventHandlers.get(eventName).set(callback, handler);
  },

  // 移除事件监听
  off: (eventName, callback) => {
    const handlers = _eventHandlers.get(eventName);
    if (handlers) {
      const wrapper = handlers.get(callback);
      if (wrapper) {
        ipcRenderer.removeListener(eventName, wrapper);
        handlers.delete(callback);
      }
    }
  },
  
  // 一次性事件监听
  once: (eventName, callback) => {
    // 监听一次性事件
    ipcRenderer.once(eventName, (event, ...args) => {
      callback(...args);
    });
  },
  
  // 发送事件到主进程
  emit: (eventName, ...args) => {
    ipcRenderer.send(eventName, ...args);
  }
};

// 将API暴露给渲染进程
contextBridge.exposeInMainWorld('API', api);

// 暴露electronAPI用于播放器窗口的IPC通信
contextBridge.exposeInMainWorld('PLAYER', {
  on: (eventName, callback) => {
    ipcRenderer.on(eventName, (event, ...args) => {
      callback(event, ...args);
    });
  },
  send: (eventName, ...args) => {
    ipcRenderer.send(eventName, ...args);
  },
  invoke: (eventName, ...args) => {
    return ipcRenderer.invoke(eventName, ...args);
  }
});

// 暴露一些常用的工具函数
contextBridge.exposeInMainWorld('Utils', {
  // 平台检测
  platform: process.platform,
  
  // 开发环境检测（preload 上下文中 process.argv/execPath 不可靠，仅用 NODE_ENV）
  isDev: process.env.NODE_ENV === 'development',
  
  // 版本信息
  versions: process.versions
});