import React, { Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { FavoritesProvider } from '@/contexts/FavoritesContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DownloadsProvider } from '@/contexts/DownloadsContext';
import { SoundProvider } from '@/contexts/SoundContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { SearchProvider } from '@/contexts/SearchContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import BackendError from '@/components/BackendError';
import Home from './pages/Home';
import Live from './pages/Live';
import Favorites from './pages/Favorites';
import Search from './pages/Search';
import Downloads from './pages/Downloads';
import Detail from './pages/Detail';
import List from './pages/List';
import NotFound from './pages/NotFound';

// Settings 页含大量 Radix 组件，懒加载以减小首屏 bundle
const Settings = lazy(() => import('./pages/Settings'));

/**
 * 应用根组件
 * 当后端 API 不可用时显示错误页，否则正常渲染路由
 */
const App: React.FC = () => {
  if (!window.API) {
    return <BackendError />;
  }

  return (
    <Router>
      <ThemeProvider>
        <SoundProvider>
          <NotificationsProvider>
            <FavoritesProvider>
              <DownloadsProvider>
                <SearchProvider>
                <IntersectObserver />
                <div className="flex flex-col min-h-screen">
                  <main className="flex-grow">
                    <Routes>
                      <Route path="/" element={<AppLayout />}>
                        <Route index element={<Home />} />
                        <Route path="live" element={<Live />} />
                        <Route path="list/:categoryId" element={<List />} />
                        <Route path="favorites" element={<Favorites />} />
                        <Route path="search" element={<Search />} />
                        <Route path="downloads" element={<Downloads />} />
                        <Route path="detail/:id" element={<Detail />} />
                        <Route path="settings" element={
                          <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">加载设置页...</div>}>
                            <Settings />
                          </Suspense>
                        } />
                      </Route>
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </main>
                </div>
                <Toaster position="top-center" richColors />
                </SearchProvider>
              </DownloadsProvider>
            </FavoritesProvider>
          </NotificationsProvider>
        </SoundProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;
