/* 官方平台深链：只生成各平台自己的搜索结果页，不抓取、不代理片源。 */

const PLATFORMS = [
  {
    id: 'iqiyi',
    name: '爱奇艺',
    search: (query) => 'https://so.iqiyi.com/so/q_' + encodeURIComponent(query)
  },
  {
    id: 'tencent',
    name: '腾讯视频',
    search: (query) => 'https://v.qq.com/x/search/?q=' + encodeURIComponent(query)
  },
  {
    id: 'youku',
    name: '优酷',
    search: (query) => 'https://so.youku.com/search_video/q_' + encodeURIComponent(query)
  },
  {
    id: 'mgtv',
    name: '芒果 TV',
    search: (query) => 'https://so.mgtv.com/so?k=' + encodeURIComponent(query)
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    search: (query) => 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(query)
  }
];

export const PLATFORM_NAMES = PLATFORMS.map((platform) => platform.name);

export function officialLinks(query) {
  const value = String(query || '').trim().slice(0, 120);
  if (!value) return [];

  return PLATFORMS.map((platform) => ({
    id: platform.id,
    name: platform.name,
    url: platform.search(value)
  }));
}

export function officialLinksForItem(item) {
  if (!item || item.local) return [];
  return officialLinks(item.title);
}
