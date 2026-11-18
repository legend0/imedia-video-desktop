import React, { createContext, useContext, useState } from 'react';

export type SettingsTab = 'source' | 'system' | 'about';

interface SettingsTabContextType {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

const SettingsTabContext = createContext<SettingsTabContextType | undefined>(undefined);

/**
 * 设置页标签上下文 Provider
 * 在 AppLayout 中包裹，使 TitleBar 和 Settings 页面共享同一个 activeTab 状态
 */
export const SettingsTabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('source');
  return (
    <SettingsTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </SettingsTabContext.Provider>
  );
};

/**
 * 获取设置页标签上下文
 * @throws {Error} 如果在 SettingsTabProvider 外部使用
 */
export const useSettingsTab = (): SettingsTabContextType => {
  const context = useContext(SettingsTabContext);
  if (!context) throw new Error('useSettingsTab must be used within SettingsTabProvider');
  return context;
};
