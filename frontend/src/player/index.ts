import { VideoPlayer, VideoData } from './VideoPlayer';

let videoPlayer: VideoPlayer | null = null;
let isDestroying = false;

/**
 * 初始化播放器实例
 * @param videoData - 视频数据
 */
function initPlayer(videoData: VideoData): void {
  console.log('[Player] initPlayer 被调用，videoData:', videoData);

  if (!videoData) {
    console.warn('[Player] videoData 为空，关闭播放器');
    window.API?.player?.hide();
    return;
  }

  if (isDestroying) {
    console.log('[Player] 正在销毁中，跳过初始化');
    return;
  }

  isDestroying = true;

  (async () => {
    try {
      if (videoPlayer) {
        await videoPlayer.destroy();
        videoPlayer = null;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      isDestroying = false;

      console.log('[Player] 创建 VideoPlayer 实例');
      videoPlayer = new VideoPlayer(videoData);
      console.log('[Player] VideoPlayer 实例已创建，开始初始化');
      await videoPlayer.init();
      console.log('[Player] VideoPlayer 初始化完成');

      const playerContainer = document.getElementById('playerContainer');
      if (playerContainer) {
        requestAnimationFrame(() => {
          playerContainer.classList.add('show');
        });
      }

      window.currentVideoPlayer = videoPlayer;
    } catch (error) {
      isDestroying = false;

      const playerContainer = document.getElementById('playerContainer');
      if (playerContainer) {
        playerContainer.innerHTML = `
                    <div style="padding: 40px; text-align: center; color: #ff4757;">
                        <h3>播放器初始化失败</h3>
                        <p>${(error as Error).message || '未知错误'}</p>
                        <button id="retryInitBtn" style="margin-top: 20px; padding: 10px 20px; background: hsl(346 77% 50%); color: white; border: none; border-radius: 8px; cursor: pointer;">
                            重试
                        </button>
                    </div>
                `;

        playerContainer.classList.add('show');

        document.getElementById('retryInitBtn')?.addEventListener('click', () => {
          location.reload();
        });
      }
    }
  })();
}

/**
 * 确保PLAYER API已注入，注册事件监听器
 */
function setupPlayerListener(): void {
  if (window.PLAYER) {
    console.log('[Player] PLAYER API 已就绪，注册事件监听器');
    window.PLAYER.on('videoData', (event: unknown, videoData: unknown) => {
      console.log('[Player] 收到 videoData 事件:', videoData);
      initPlayer(videoData as VideoData);
    });
  } else {
    console.warn('[Player] PLAYER API 未找到，稍后重试');
    // 如果PLAYER API尚未注入，延迟重试
    setTimeout(setupPlayerListener, 100);
  }
}

// 立即尝试设置监听器
setupPlayerListener();

window.addEventListener('beforeunload', async () => {
  if (videoPlayer) {
    await videoPlayer.destroy();
  }
});
