import { Plugin } from 'vite';

/**
 * 播放器HTML模板
 * 使用内联SVG图标替代remixicon
 * 符合新框架设计风格
 * 注意：播放器脚本文件名将在构建时通过钩子动态注入
 */
const PLAYER_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>视频播放器</title>
    <link rel="stylesheet" href="./css/player.css">
    <style>
        /* 加载动画 */
        .player-loading {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: hsl(var(--background));
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
            backdrop-filter: blur(10px);
            -webkit-app-region: drag;
        }

        .player-loading.active {
            opacity: 1;
            visibility: visible;
        }

        .loading-wave-container {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 24px;
            height: 40px;
        }

        .loading-wave {
            width: 6px;
            height: 20px;
            background: linear-gradient(180deg, hsl(var(--primary)), hsl(var(--primary) / 0.5));
            border-radius: 3px;
            animation: loading-wave 1.2s ease-in-out infinite;
        }

        .loading-wave:nth-child(1) { animation-delay: 0s; }
        .loading-wave:nth-child(2) { animation-delay: 0.1s; }
        .loading-wave:nth-child(3) { animation-delay: 0.2s; }
        .loading-wave:nth-child(4) { animation-delay: 0.3s; }
        .loading-wave:nth-child(5) { animation-delay: 0.4s; }

        .loading-subtext {
            font-family: "PingFang Heavy", -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            font-size: 14px;
            color: hsl(var(--muted-foreground));
            text-align: center;
            margin-bottom: 20px;
            max-width: 300px;
            line-height: 1.5;
        }

        .loading-progress {
            width: 200px;
            height: 4px;
            background: hsl(var(--border));
            border-radius: 2px;
            overflow: hidden;
        }

        .loading-progress-bar {
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.7));
            border-radius: 2px;
            animation: loading-progress 2s ease-in-out infinite;
            position: relative;
        }

        .loading-progress-bar::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, transparent, hsl(var(--primary-foreground) / 0.4), transparent);
            animation: loading-progress-shine 2s ease-in-out infinite;
        }

        @keyframes loading-wave {
            0%, 100% { 
                height: 20px;
                transform: translateY(0);
            }
            50% { 
                height: 40px;
                transform: translateY(-10px);
            }
        }

        @keyframes loading-progress {
            0% { width: 0%; }
            50% { width: 70%; }
            100% { width: 100%; }
        }

        @keyframes loading-progress-shine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }

        @media (max-width: 768px) {
            .loading-wave {
                width: 4px;
                height: 16px;
            }
            
            .loading-subtext {
                font-size: 12px;
                max-width: 250px;
            }
            
            .loading-progress {
                width: 150px;
            }
        }

        /* SVG图标样式 */
        .icon {
            width: 1em;
            height: 1em;
            display: inline-block;
            vertical-align: middle;
            stroke-width: 2;
            stroke: currentColor;
            fill: none;
        }

        .icon-lg {
            width: 1.5em;
            height: 1.5em;
        }

        .icon-xl {
            width: 2em;
            height: 2em;
        }

        /* 加载阶段关闭按钮：仅在 player-loading 显示期间可见，
           VideoPlayer.ts renderHTML() 会用 #closeBtn 替换掉此节点 */
        .window-close-btn {
            position: fixed;
            top: 12px;
            right: 12px;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            border: none;
            background: hsl(var(--secondary));
            color: hsl(var(--foreground));
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1001;
            -webkit-app-region: no-drag;
            transition: background 0.15s ease, transform 0.15s ease;
        }

        .window-close-btn:hover {
            background: hsl(var(--destructive));
            color: hsl(var(--destructive-foreground));
            transform: scale(1.05);
        }

        .window-close-btn .icon {
            width: 18px;
            height: 18px;
        }
    </style>
</head>
<body>
    <div class="player-container" id="playerContainer">
        <div class="window-close-btn" onclick="window.close()" title="关闭">
            <svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
        </div>
        <div class="player-loading active">      
            <div class="loading-wave-container">
                <div class="loading-wave"></div>
                <div class="loading-wave"></div>
                <div class="loading-wave"></div>
                <div class="loading-wave"></div>
                <div class="loading-wave"></div>
            </div>
            <div class="loading-subtext">请稍等，正在准备最佳播放体验</div>            
            <div class="loading-progress">
                <div class="loading-progress-bar"></div>
            </div>
        </div>
    </div>

    <script src="./player/hls.min.js"></script>
    <script src="./player/kampos.umd.js"></script>
    <!-- 播放器脚本将通过构建钩子动态注入 -->
    <!-- PLAYER_SCRIPT_PLACEHOLDER -->
</body>
</html>`;

export function playerHtmlPlugin(): Plugin {
  return {
    name: 'player-html-plugin',

    generateBundle(_options, bundle) {
      // 查找播放器脚本文件
      let playerScriptFile: string | null = null;

      // 遍历 bundle 查找播放器脚本
      for (const fileName of Object.keys(bundle)) {
        // 播放器脚本的命名格式：assets/js/player/player-[hash].js
        if (fileName.match(/player-[a-zA-Z0-9_-]+\.js$/)) {
          playerScriptFile = fileName;
          console.log(`[playerHtmlPlugin] 找到播放器脚本: ${fileName}`);
          break;
        }
      }

      // 如果找到播放器脚本，注入到 HTML 中
      let html = PLAYER_HTML;
      if (playerScriptFile) {
        const scriptTag = `<script src="./${playerScriptFile}"></script>`;
        html = html.replace('<!-- PLAYER_SCRIPT_PLACEHOLDER -->', scriptTag);
        console.log(`[playerHtmlPlugin] 已注入播放器脚本引用: ${scriptTag}`);
      } else {
        console.warn('[playerHtmlPlugin] 未找到播放器脚本文件');
      }

      // 生成 player.html
      this.emitFile({
        type: 'asset',
        fileName: 'player.html',
        source: html,
      });
    },
  };
}

/**
 * SVG图标定义（基于Lucide图标）
 * 用于播放器中的所有图标
 */
export const PLAYER_ICONS = {
  play: `<svg class="icon icon-lg" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  pause: `<svg class="icon icon-lg" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`,
  skipBack: `<svg class="icon" viewBox="0 0 24 24"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>`,
  skipForward: `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>`,
  volumeHigh: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
  volumeLow: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
  volumeMute: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
  fullscreen: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`,
  fullscreenExit: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>`,
  settings: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v10M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m6 0h10M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"></path></svg>`,
  list: `<svg class="icon" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
  minimize: `<svg class="icon" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  maximize: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`,
  close: `<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  arrowLeft: `<svg class="icon" viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`,
  focus: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`,
  error: `<svg class="icon icon-xl" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  refresh: `<svg class="icon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
  chevronDown: `<svg class="icon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  chevronUp: `<svg class="icon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>`,
  sun: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  contrast: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 1 0 0 20z"></path></svg>`,
  droplet: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
  crosshair: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>`,
  info: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  keyboard: `<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><line x1="6" y1="8" x2="6.01" y2="8"></line><line x1="10" y1="8" x2="10.01" y2="8"></line><line x1="14" y1="8" x2="14.01" y2="8"></line><line x1="18" y1="8" x2="18.01" y2="8"></line><line x1="6" y1="12" x2="6.01" y2="12"></line><line x1="10" y1="12" x2="10.01" y2="12"></line><line x1="14" y1="12" x2="14.01" y2="12"></line><line x1="18" y1="12" x2="18.01" y2="12"></line><line x1="6" y1="16" x2="18" y2="16"></line></svg>`,
};