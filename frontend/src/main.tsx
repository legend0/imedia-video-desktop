import { createRoot } from "react-dom/client";
import React from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

/** 全局错误边界回退组件：符合应用风格，提供刷新页面和重启应用操作 */
const GlobalErrorFallback: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-destructive/5 p-6">
    <div className="w-full max-w-lg space-y-8 text-center">
      <div className="flex justify-center">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-destructive/20" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-12 w-12 text-destructive" />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-foreground">应用出现异常</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          抱歉，应用遇到了意外错误，部分功能可能受到影响。
        </p>
        <p className="text-xs text-muted-foreground/70">
          你可以尝试刷新页面或重启应用来恢复
        </p>
      </div>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/25"
        >
          <RefreshCw className="h-4 w-4" />
          刷新页面
        </button>
        <button
          onClick={() => {
            if (window.API?.app?.restart) {
              window.API.app.restart();
            } else {
              window.location.reload();
            }
          }}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted hover:shadow-card"
        >
          <RotateCcw className="h-4 w-4" />
          重启应用
        </button>
      </div>
    </div>
  </div>
);

/** 全局错误边界：捕获渲染异常并展示回退 UI */
class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? <GlobalErrorFallback /> : this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <GlobalErrorBoundary>
    <AppWrapper>
      <App />
    </AppWrapper>
  </GlobalErrorBoundary>
);
