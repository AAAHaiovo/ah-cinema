/* 片库加载、分类、搜索与分页。片库是本地 JSON，正式扩充时只换数据文件。 */

export const CATEGORY_LABELS = {
  movie: '电影',
  series: '电视剧',
  animation: '动画',
  documentary: '纪录片',
  short: '短片'
};

const CATEGORY_ORDER = ['movie', 'series', 'animation', 'documentary', 'short'];

let items = [];
let meta = {};

function normalize(item) {
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') {
    return null;
  }

  const sources = Array.isArray(item.sources) ? item.sources.filter((source) => source && source.src) : [];
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const aliases = Array.isArray(item.aliases) ? item.aliases : [];

  const searchText = [
    item.title,
    item.originalTitle,
    item.year,
    item.category,
    CATEGORY_LABELS[item.category],
    item.kind,
    item.source,
    item.license,
    ...aliases,
    ...tags,
    ...genres
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    ...item,
    sources,
    episodes,
    tags,
    genres,
    aliases,
    searchText,
    year: Number.isFinite(item.year) ? item.year : null
  };
}

export async function loadCatalog() {
  const response = await fetch('./data/catalog.json', { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error('片库加载失败（HTTP ' + response.status + '）');
  }

  const data = await response.json();
  if (!data || !Array.isArray(data.items)) {
    throw new Error('片库格式不正确');
  }

  meta = {
    version: data.version || 1,
    updatedAt: data.updatedAt || '',
    notice: data.notice || ''
  };

  items = data.items.map(normalize).filter(Boolean);
  return items;
}

export function allItems() {
  return items.slice();
}

export function getMeta() {
  return { ...meta };
}

export function getItem(id) {
  return items.find((item) => item.id === id) || null;
}

export function getEpisode(item, episodeId) {
  if (!item || !episodeId) return null;
  return item.episodes.find((episode) => String(episode.id) === String(episodeId)) || null;
}

export function sourcesFor(item, episode) {
  if (episode && Array.isArray(episode.sources) && episode.sources.length) {
    return episode.sources;
  }
  return item && Array.isArray(item.sources) ? item.sources : [];
}

export function categories() {
  const total = items.length;
  const counts = {
    all: total
  };

  items.forEach((item) => {
    if (item.kind === 'movie') counts.movie = (counts.movie || 0) + 1;
    if (item.kind === 'series') counts.series = (counts.series || 0) + 1;
    if (item.category) counts[item.category] = (counts[item.category] || 0) + 1;
  });

  return [
    { key: 'all', label: '全部', count: total },
    ...CATEGORY_ORDER.filter((key) => counts[key] > 0).map((key) => ({
      key,
      label: CATEGORY_LABELS[key] || key,
      count: counts[key]
    }))
  ];
}

export function filterItems(category) {
  if (!category || category === 'all') return allItems();
  if (category === 'movie' || category === 'series') {
    return items.filter((item) => item.kind === category);
  }
  return items.filter((item) => item.category === category);
}

export function searchItems(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return [];

  const terms = normalized.split(/\s+/).filter(Boolean);
  const scored = [];

  items.forEach((item) => {
    let score = 0;
    let matchesAll = true;

    for (const term of terms) {
      if (!item.searchText.includes(term)) {
        matchesAll = false;
        break;
      }

      const title = item.title.toLowerCase();
      const original = (item.originalTitle || '').toLowerCase();
      const aliases = item.aliases.map((alias) => String(alias).toLowerCase());

      if (title === term) score += 100;
      else if (title.startsWith(term)) score += 50;
      else if (title.includes(term)) score += 30;
      else if (original === term) score += 40;
      else if (original.includes(term)) score += 20;
      else if (aliases.some((alias) => alias === term)) score += 35;
      else if (aliases.some((alias) => alias.includes(term))) score += 15;
      else score += 5;
    }

    if (matchesAll) {
      if (item.featured) score += 2;
      scored.push({ item, score });
    }
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.title.localeCompare(b.item.title, 'zh-Hans-CN');
  });

  return scored.map((entry) => entry.item);
}

export function relatedItems(item, limit = 6) {
  if (!item) return [];

  const itemTags = new Set([...(item.tags || []), ...(item.genres || [])]);
  const scored = [];

  items.forEach((candidate) => {
    if (candidate.id === item.id) return;

    let score = 0;
    if (candidate.category === item.category) score += 4;
    if (candidate.kind === item.kind) score += 1;

    const candidateTags = [...(candidate.tags || []), ...(candidate.genres || [])];
    candidateTags.forEach((tag) => {
      if (itemTags.has(tag)) score += 2;
    });

    if (score > 0) scored.push({ item: candidate, score });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (Boolean(b.item.featured) !== Boolean(a.item.featured)) return b.item.featured ? 1 : -1;
    return (b.item.year || 0) - (a.item.year || 0);
  });

  return scored.slice(0, limit).map((entry) => entry.item);
}

export function paginate(list, page, pageSize) {
  const totalItems = list.length;
  const size = Math.max(1, Number(pageSize) || 24);
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * size;

  return {
    items: list.slice(start, start + size),
    page: safePage,
    pageSize: size,
    totalPages,
    totalItems
  };
}

export function categoryLabel(key) {
  return CATEGORY_LABELS[key] || key || '';
}
