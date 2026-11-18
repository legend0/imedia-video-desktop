import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { SourceManager } from '@/components/settings/SourceManager';
import { SystemSettings } from '@/components/settings/SystemSettings';
import { AboutSettings } from '@/components/settings/AboutSettings';
import { useSettingsTab } from '@/contexts/SettingsTabContext';

const tabComponents: Record<string, React.FC> = {
  source: SourceManager,
  system: SystemSettings,
  about: AboutSettings,
};

const Settings: React.FC = () => {
  const { activeTab } = useSettingsTab();
  const ActiveComponent = tabComponents[activeTab] ?? SourceManager;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-orange flex items-center justify-center">
          <LayoutGrid className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">设置</h1>
      </div>

      <ActiveComponent />
    </div>
  );
};

export default Settings;
