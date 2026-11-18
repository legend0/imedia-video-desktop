/**
 * segmentit 中文分词库类型声明
 * 库本身未提供 .d.ts，此处补全项目使用到的最小类型集
 */

declare module 'segmentit' {
  /** 分词结果项（完整模式） */
  interface SegmentToken {
    /** 词面 */
    w: string;
    /** 词性标记 */
    p: number;
  }

  /** doSegment 配置项 */
  interface SegmentOptions {
    /** 去除标点 */
    stripPunctuation?: boolean;
    /** 去除停止词 */
    stripStopword?: boolean;
    /** 转换同义词 */
    convertSynonym?: boolean;
    /** 仅返回单词字符串数组 */
    simple?: boolean;
  }

  /** 分词器主类 */
  export class Segment {
    /** 使用指定模块 */
    use(modules: unknown): this;
    /** 加载词典 */
    loadDict(dicts: unknown): this;
    /** 加载同义词词典 */
    loadSynonymDict(dicts: unknown): this;
    /** 加载停止词词典 */
    loadStopwordDict(dicts: unknown): this;
    /** 获取词典 */
    getDict(name: string): Record<string, unknown>;
    /** 执行分词 */
    doSegment(text: string, options?: SegmentOptions): SegmentToken[] | string[];
  }

  /** 加载默认词典与模块到指定 Segment 实例 */
  export function useDefault(segmentInstance: Segment): Segment;
}
