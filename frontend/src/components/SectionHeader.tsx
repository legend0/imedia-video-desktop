import React from 'react';
import { ChevronRight } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  action?: React.ReactNode;
  /** 点击"查看更多"的回调，传入后按钮可点击且有悬浮效果 */
  onMore?: () => void;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, action, onMore }) => {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div className="flex flex-col">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <div className="mt-1 h-1 w-8 rounded-full bg-brand" />
      </div>
      {action ?? (
        <button
          onClick={onMore}
          className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-brand transition-colors"
        >
          查看更多
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
