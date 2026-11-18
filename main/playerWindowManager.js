const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const logger = require('./utils/log');
const { isDev } = require('./utils/env');

/**
 * 播放器窗口管理器
 * 采用混合模式：首次使用时创建，后续复用
 */
class PlayerWindowManager {
    constructor(options = {}) {
        this.playerWindow = null ;
        this.isPlaying = false;
        
        // 配置
        this.config = {
            preloadScript: path.join(__dirname, 'preload.js'),
            playerUrl: path.join(__dirname, '..', 'view', 'player.html'),
            ...options
        };

        this.setupIpcHandlers();
        // 创建窗口
        this.createPlayerWindow();
    }

    /**
     * 设置IPC处理器
     */
    setupIpcHandlers() {
        // 播放器窗口控制
        ipcMain.handle('api.player.open', async (event, videoData) => {
            if (videoData !== undefined && (typeof videoData !== 'object' || videoData === null)) {
                return { success: false, error: '无效的视频数据参数' };
            }
            return await this.openPlayer(videoData);
        });

        ipcMain.handle('api.player.close', async () => {
            return await this.closePlayer();
        });

        ipcMain.handle('api.player.hide', async () => {
            return await this.hidePlayer();
        });

        ipcMain.handle('api.player.show', async () => {
            return await this.showPlayer();
        });

        ipcMain.handle('api.player.isPlaying', async () => {
            return this.isPlaying;
        });

        // 监听播放器窗口关闭事件
        ipcMain.on('player-window-closed', () => {
            this.isPlaying = false;
        });

        // 监听播放器播放状态变化
        ipcMain.on('player-playback-changed', (event, isPlaying) => {
            this.isPlaying = isPlaying;
        });

        // 全屏控制
        ipcMain.handle('api.player.toggleFullscreen', async () => {
            return await this.toggleFullscreen();
        });

        ipcMain.handle('api.player.isFullscreen', async () => {
            return await this.isFullscreen();
        });

        // 画中画控制
        ipcMain.handle('api.player.togglePictureInPicture', async () => {
            return await this.togglePictureInPicture();
        });

        ipcMain.handle('api.player.isPictureInPicture', async () => {
            return await this.isPictureInPicture();
        });

        // 最小化控制
        ipcMain.handle('api.player.minimize', async () => {
            return await this.minimize();
        });

        // 最大化/正常切换控制
        ipcMain.handle('api.player.toggleMaximize', async () => {
            return await this.toggleMaximize();
        });

        ipcMain.handle('api.player.isMaximized', async () => {
            return await this.isMaximized();
        });

        ipcMain.handle('api.player.setImmersiveMode', async (event, enabled) => {
            return await this.setImmersiveMode(enabled);
        });
    }

    /**
     * 打开播放器窗口
     * @param {Object} videoData - 视频数据 {title, url, episodes, currentEpisode}
     * @returns {Promise<Object>} 操作结果
     */
    async openPlayer(videoData) {
        try {
            // 如果窗口不存在，创建新窗口
            if (!this.playerWindow || this.playerWindow.isDestroyed()) {
                logger.info('创建新播放器窗口');
                await this.createPlayerWindow();
            }
            // 显示窗口
            this.playerWindow.show();
            this.playerWindow.focus();

            // 发送视频数据到播放器
            if (videoData) {
                this.playerWindow.webContents.send('videoData', videoData);                
            }

            this.isPlaying = true;

            return { success: true };
        } catch (error) {
            logger.error(`打开播放器窗口失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 创建播放器窗口
     * @returns {Promise<BrowserWindow>}
     */
    async createPlayerWindow() {
        return new Promise((resolve, reject) => {
            try {
                const playerWindow = new BrowserWindow({
                    width: 860,
                    height: 580,
                    minWidth: 500,
                    minHeight: 380,
                    frame: false, // 无边框
                    show: false, // 初始隐藏
                    backgroundColor: '#0A0B10',
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        enableRemoteModule: false,
                        preload: this.config.preloadScript,
                        webSecurity: false, // 禁用webSecurity以解决跨域问题
                        allowRunningInsecureContent: true // 允许运行不安全内容
                    }
                });
                // 加载播放器页面
                playerWindow.loadFile(this.config.playerUrl);
                  // 开发环境下打开开发者工具
                if (isDev) {
                    logger.debug('开发环境：打开开发者工具');
                    playerWindow.webContents.openDevTools();
                }
                
                // 窗口关闭事件
                playerWindow.on('close', (event) => {
                    // 阻止默认关闭行为，改为隐藏
                    event.preventDefault();
                    this.hidePlayer();
                });

                // 窗口被销毁时清理
                playerWindow.on('closed', () => {
                    this.playerWindow = null;
                    this.isPlaying = false;
                });

                // 页面完全加载完成（包括所有资源）
                playerWindow.webContents.once('did-finish-load', () => {
                    logger.debug('播放器页面加载完成');
                    
                    // 设置会话级别的CORS策略，解决跨域问题
                    const session = playerWindow.webContents.session;
                    session.webRequest.onHeadersReceived((details, callback) => {
                        callback({
                            responseHeaders: {
                                ...details.responseHeaders,
                                'Access-Control-Allow-Origin': ['*'],
                                'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                                'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With']
                            }
                        });
                    });
                    
                    resolve(playerWindow);
                });

                // 加载失败处理
                playerWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                    logger.error(`播放器页面加载失败: ${errorCode} ${errorDescription}`);
                    reject(new Error(`加载播放器页面失败: ${errorDescription}`));
                });

                this.playerWindow = playerWindow;
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 关闭播放器窗口（隐藏）
     * @returns {Promise<Object>}
     */
    async closePlayer() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                // 发送关闭信号到播放器
                this.playerWindow.webContents.send('player-close');
                
                // 隐藏窗口
                await this.hidePlayer();
            }

            this.isPlaying = false;
            return { success: true };
        } catch (error) {
            logger.error(`关闭播放器窗口失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 隐藏播放器窗口
     * @returns {Promise<Object>}
     */
    async hidePlayer() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                this.playerWindow.hide();
                
                // 暂停播放
                this.playerWindow.webContents.send('player-pause');
                this.isPlaying = false;
            }

            return { success: true };
        } catch (error) {
            logger.error(`隐藏播放器窗口失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 显示播放器窗口
     * @returns {Promise<Object>}
     */
    async showPlayer() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                this.playerWindow.show();
                this.playerWindow.focus();
            }

            return { success: true };
        } catch (error) {
            logger.error(`显示播放器窗口失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查播放器窗口是否存在
     * @returns {boolean}
     */
    isPlayerWindowExists() {
        return this.playerWindow && !this.playerWindow.isDestroyed();
    }

    /**
     * 获取播放器窗口状态
     * @returns {Object}
     */
    getPlayerStatus() {
        return {
            exists: this.isPlayerWindowExists(),
            isPlaying: this.isPlaying,
            isVisible: this.playerWindow && this.playerWindow.isVisible(),
            lastUsedTime: this.lastUsedTime
        };
    }

    /**
     * 销毁管理器
     */
    destroy() {
        // 销毁窗口
        if (this.playerWindow && !this.playerWindow.isDestroyed()) {
            this.playerWindow.destroy();
        }

        // 移除IPC监听器
        ipcMain.removeHandler('api.player.open');
        ipcMain.removeHandler('api.player.close');
        ipcMain.removeHandler('api.player.hide');
        ipcMain.removeHandler('api.player.show');
        ipcMain.removeHandler('api.player.isPlaying');
        ipcMain.removeHandler('api.player.toggleFullscreen');
        ipcMain.removeHandler('api.player.isFullscreen');
        ipcMain.removeHandler('api.player.togglePictureInPicture');
        ipcMain.removeHandler('api.player.isPictureInPicture');
        ipcMain.removeHandler('api.player.minimize');
        ipcMain.removeHandler('api.player.toggleMaximize');
        ipcMain.removeHandler('api.player.isMaximized');
        ipcMain.removeHandler('api.player.setImmersiveMode');

        this.playerWindow = null;
        this.isPlaying = false;
    }

    /**
     * 最小化窗口
     * @returns {Promise<Object>}
     */
    async minimize() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                this.playerWindow.minimize();
                return { success: true };
            }
            return { success: false, error: '播放器窗口不存在' };
        } catch (error) {
            logger.error(`最小化窗口失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 切换最大化/正常状态
     * @returns {Promise<Object>}
     */
    async toggleMaximize() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                if (this.playerWindow.isMaximized()) {
                    this.playerWindow.unmaximize();
                } else {
                    this.playerWindow.maximize();
                }
                return { success: true, isMaximized: this.playerWindow.isMaximized() };
            }
            return { success: false, error: '播放器窗口不存在' };
        } catch (error) {
            logger.error(`切换最大化状态失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查是否最大化
     * @returns {Promise<Object>}
     */
    async isMaximized() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                return { success: true, isMaximized: this.playerWindow.isMaximized() };
            }
            return { success: true, isMaximized: false };
        } catch (error) {
            logger.error(`检查最大化状态失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 切换全屏
     * @returns {Promise<Object>}
     */
    async toggleFullscreen() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                if (this.playerWindow.isFullScreen()) {
                    this.playerWindow.setFullScreen(false);
                } else {
                    this.playerWindow.setFullScreen(true);
                }
                return { success: true, isFullscreen: this.playerWindow.isFullScreen() };
            }
            return { success: false, error: '播放器窗口不存在' };
        } catch (error) {
            logger.error(`切换全屏失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查是否全屏
     * @returns {Promise<Object>}
     */
    async isFullscreen() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                return { success: true, isFullscreen: this.playerWindow.isFullScreen() };
            }
            return { success: true, isFullscreen: false };
        } catch (error) {
            logger.error(`检查全屏状态失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 切换画中画
     * @returns {Promise<Object>}
     */
    async togglePictureInPicture() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                if (this.playerWindow.isAlwaysOnTop()) {
                    this.playerWindow.setAlwaysOnTop(false);
                    this.playerWindow.setSkipTaskbar(false);
                } else {
                    this.playerWindow.setAlwaysOnTop(true);
                    this.playerWindow.setSkipTaskbar(true);
                }
                return { success: true, isPictureInPicture: this.playerWindow.isAlwaysOnTop() };
            }
            return { success: false, error: '播放器窗口不存在' };
        } catch (error) {
            logger.error(`切换画中画失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 设置沉浸模式
     * @param {boolean} enabled - 是否启用沉浸模式
     * @returns {Promise<Object>}
     */
    async setImmersiveMode(enabled) {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                if (enabled) {
                    this.playerWindow.setAlwaysOnTop(true, 'floating');
                    this.playerWindow.setSkipTaskbar(false);
                } else {
                    this.playerWindow.setAlwaysOnTop(false);
                    this.playerWindow.setSkipTaskbar(false);
                }
                return { success: true, isImmersiveMode: enabled };
            }
            return { success: false, error: '播放器窗口不存在' };
        } catch (error) {
            logger.error(`设置沉浸模式失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查是否画中画
     * @returns {Promise<Object>}
     */
    async isPictureInPicture() {
        try {
            if (this.playerWindow && !this.playerWindow.isDestroyed()) {
                return { success: true, isPictureInPicture: this.playerWindow.isAlwaysOnTop() };
            }
            return { success: true, isPictureInPicture: false };
        } catch (error) {
            logger.error(`检查画中画状态失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

module.exports = PlayerWindowManager;