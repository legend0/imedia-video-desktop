import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface SearchContextType {
  /** 当前搜索关键词（全局共享，跨页面保持） */
  searchKeyword: string;
  /** 设置搜索关键词 */
  setSearchKeyword: (keyword: string) => void;
  /** 清空搜索关键词（退出搜索状态） */
  clearSearch: () => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchKeyword, setSearchKeywordState] = useState('');

  const setSearchKeyword = useCallback((keyword: string) => {
    setSearchKeywordState(keyword);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchKeywordState('');
  }, []);

  const value = useMemo<SearchContextType>(() => ({
    searchKeyword,
    setSearchKeyword,
    clearSearch,
  }), [searchKeyword, setSearchKeyword, clearSearch]);

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
};

/**
 * 获取全局搜索状态
 * @returns 搜索上下文（searchKeyword, setSearchKeyword, clearSearch）
 */
export function useSearch(): SearchContextType {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
