import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { SettingsTabProvider } from '@/contexts/SettingsTabContext';

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const navType = useNavigationType();
  const isSettings = location.pathname === '/settings';
  const isListPage = location.pathname.startsWith('/list/') || location.pathname.startsWith('/search'); // 判断是否在 List/Search 页面
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const prevPathRef = useRef<string>(location.pathname);

  useEffect(() => {
    if (!window.API?.settings?.get) return;
    window.API.settings.get('ui.collapsed').then((value: unknown) => {
      if (typeof value === 'boolean') setCollapsed(value);
    });
  }, []);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const prevPath = prevPathRef.current;
    if (prevPath !== location.pathname) {
      scrollPositions.current.set(prevPath, main.scrollTop);

      if (navType === 'POP') {
        // List 页面通过自身的 listPageCache 恢复滚动位置（含 videos 缓存），
        // AppLayout 不主动恢复，避免重试机制覆盖 List 组件的恢复逻辑。
        // 其他页面（Home/Settings 等）仍由 AppLayout 恢复。
        if (location.pathname.startsWith('/list/')) {
          // 跳过：交给 List 组件处理
        } else {
          const saved = scrollPositions.current.get(location.pathname) ?? 0;
          // 重试恢复滚动位置：异步加载的页面内容可能尚未渲染，
          // 需要在内容逐渐加载后持续尝试恢复，直到位置匹配或超过重试上限
          let attempts = 0;
          const maxAttempts = 30;
          const tryRestore = () => {
            main.scrollTop = saved;
            attempts++;
            if (Math.abs(main.scrollTop - saved) > 5 && attempts < maxAttempts) {
              setTimeout(tryRestore, 50);
            }
          };
          tryRestore();
        }
      } else {
        main.scrollTop = 0;
      }
    }

    prevPathRef.current = location.pathname;
  }, [location.pathname, navType]);

  const handleToggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.API?.settings?.set?.('ui.collapsed', next);
      return next;
    });
  };

  // 动态生成 main 的 className
  // scrollbar-gutter: stable 预留滚动条空间，避免内容增减导致布局宽度抖动
  const mainClassName = `flex-1 min-w-0 overflow-x-hidden overflow-y-auto bg-background px-6 pb-6 [scrollbar-gutter:stable] ${
    isListPage ? 'pt-0' : 'pt-6'
  }`;

  return (
    <SettingsTabProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar
          isSettingsActive={isSettings}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
        />
        <div className="flex-1 min-w-0 flex flex-col h-screen">
          <TitleBar onMenuClick={() => setMobileOpen(true)} />
          <main ref={mainRef} className={mainClassName}>
            <Outlet />
          </main>
        </div>
      </div>
    </SettingsTabProvider>
  );
};