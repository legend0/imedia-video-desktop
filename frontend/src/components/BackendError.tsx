import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

/**
 * 后端未启动时的错误页组件
 * 当 window.API 不可用时展示，提供重新检测和重启应用按钮
 */
const BackendError: React.FC = () => {
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  /** 检测 API 是否已就绪 */
  const checkApi = useCallback(() => {
    setRetrying(true);
    setTimeout(() => {
      if (window.API) {
        window.location.reload();
      } else {
        setRetrying(false);
        setRetryCount((c) => c + 1);
      }
    }, 800);
  }, []);

  /** 重启应用（通过 Electron IPC 通知主进程重启） */
  const restartApp = useCallback(() => {
    if (window.API?.app?.restart) {
      window.API.app.restart();
    } else {
      // 降级：刷新页面
      window.location.reload();
    }
  }, []);

  // 每 5 秒自动检测一次
  useEffect(() => {
    const timer = setInterval(() => {
      if (window.API) {
        window.location.reload();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-destructive/5 p-6">
      <div className="w-full max-w-lg space-y-8 text-center">
        {/* 错误图标 + 脉冲动画 */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-destructive/20" />
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-12 w-12 text-destructive" />
            </div>
          </div>
        </div>

        {/* 错误信息 */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-foreground">服务连接失败</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            应用核心服务未响应，部分功能可能无法使用。
          </p>
          <p className="text-xs text-muted-foreground/70">
            你可以尝试重新检测或重启应用来恢复服务
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={checkApi}
            disabled={retrying}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/25 disabled:opacity-50"
          >
            {retrying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                检测中...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                重新检测
              </>
            )}
          </button>
          <button
            onClick={restartApp}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted hover:shadow-card"
          >
            <RotateCcw className="h-4 w-4" />
            重启应用
          </button>
        </div>

        {/* 自动检测提示 */}
        <p className="text-xs text-muted-foreground/60">
          {retryCount > 0
            ? `已重试 ${retryCount} 次 · 每 5 秒自动检测中`
            : '系统每 5 秒自动检测服务状态'}
        </p>
      </div>
    </div>
  );
};

export default BackendError;
