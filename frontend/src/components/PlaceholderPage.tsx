import React from 'react';

interface PlaceholderPageProps {
  title: string;
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ title }) => {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-muted-foreground animate-in fade-in duration-300">
      <p className="text-sm">{title}页面内容即将上线</p>
    </div>
  );
};
