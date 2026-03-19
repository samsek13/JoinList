import { describe, it, expect } from 'vitest';
import {
  extractNeteaseUrl,
  parsePlaylistId,
  truncateInput
} from '../src/utils';

describe('extractNeteaseUrl', () => {
  it('应从纯链接中提取URL', () => {
    const result = extractNeteaseUrl('https://163cn.tv/3pLIrLH');
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://163cn.tv/3pLIrLH');
  });

  it('应从APP分享文本中提取URL', () => {
    const input = '分享歌单: 25年4月最好听的20首粤语歌 https://163cn.tv/3pLIrLH (@网易云音乐)';
    const result = extractNeteaseUrl(input);
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://163cn.tv/3pLIrLH');
  });

  it('应处理链接前后的空格', () => {
    const result = extractNeteaseUrl('  https://163cn.tv/abc  ');
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://163cn.tv/abc');
  });

  it('应在无链接时返回错误', () => {
    const result = extractNeteaseUrl('这是一段没有链接的文字');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_found');
  });

  it('应在多个链接时返回错误', () => {
    const result = extractNeteaseUrl('https://163cn.tv/a https://163cn.tv/b');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('multiple');
  });

  it('应支持http协议', () => {
    const result = extractNeteaseUrl('http://163cn.tv/abc');
    expect(result.success).toBe(true);
    expect(result.url).toBe('http://163cn.tv/abc');
  });

  it('应提取长链接', () => {
    const result = extractNeteaseUrl('https://music.163.com/playlist?id=12345');
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://music.163.com/playlist?id=12345');
  });

  it('应从带额外文字的文本中提取URL', () => {
    const result = extractNeteaseUrl('推荐这个歌单 https://163cn.tv/abc 很好听！');
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://163cn.tv/abc');
  });

  it('应在输入过长时返回错误', () => {
    const longInput = 'a'.repeat(2001);
    const result = extractNeteaseUrl(longInput);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_found');
  });
});

describe('parsePlaylistId', () => {
  it('应从纯数字中提取ID', () => {
    expect(parsePlaylistId('12345')).toBe('12345');
  });

  it('应从URL参数中提取ID', () => {
    expect(parsePlaylistId('https://music.163.com/playlist?id=12345')).toBe('12345');
  });

  it('应从带hash的URL中提取ID', () => {
    expect(parsePlaylistId('https://music.163.com/#/playlist?id=12345')).toBe('12345');
  });

  it('应从带额外参数的URL中提取ID', () => {
    expect(parsePlaylistId('https://music.163.com/playlist?id=12345&userid=67890')).toBe('12345');
  });

  it('应在无效输入时返回null', () => {
    expect(parsePlaylistId('invalid')).toBeNull();
  });

  it('应处理带空格的输入', () => {
    expect(parsePlaylistId('  12345  ')).toBe('12345');
  });
});

describe('truncateInput', () => {
  it('应在输入不超过100字符时返回原输入', () => {
    expect(truncateInput('short')).toBe('short');
  });

  it('应在输入超过100字符时截断并添加省略号', () => {
    const longInput = 'a'.repeat(150);
    const result = truncateInput(longInput);
    expect(result.length).toBe(103); // 100 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('应在输入刚好100字符时返回原输入', () => {
    const input = 'a'.repeat(100);
    expect(truncateInput(input)).toBe(input);
  });
});