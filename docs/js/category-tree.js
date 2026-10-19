/*
 * 分类树：把各源的 Apple CMS class 目录归一成「一级类型 + 子类型」。
 *
 * 一级固定为：全部 / 电影 / 电视剧 / 动漫 / 综艺 / 纪录片。
 * 优先使用源站自己的 parent（type_pid）；没有 parent 时按分类名推断。
 * 每个子类型记录它在各源对应的 type_id，数组形式，便于「全部分类」聚合。
 */

export const TOP_GROUPS = [
  { key: 'movie', name: '电影' },
  { key: 'tv', name: '电视剧' },
  { key: 'anime', name: '动漫' },
  { key: 'variety', name: '综艺' },
  { key: 'documentary', name: '纪录片' },
  { key: 'other', name: '其他' }
];

const GROUP_BY_KEY = new Map(TOP_GROUPS.map((group) => [group.key, group]));

const MOVIE_GENRES = [
  '剧情', '喜剧', '爱情', '动作', '科幻', '动画', '悬疑', '犯罪', '惊悚', '冒险',
  '家庭', '儿童', '音乐', '历史', '奇幻', '恐怖', '战争', '传记', '歌舞', '武侠',
  '灾难', '西部', '古装', '运动', '短片', '伦理', '情色'
];
const TV_GENRES = [
  '剧情', '喜剧', '爱情', '悬疑', '犯罪', '惊悚', '战争', '古装', '科幻', '家庭',
  '历史', '传记', '武侠', '动作', '奇幻', '恐怖', '音乐', '运动'
];
const TV_REGIONS = ['国产', '大陆', '港台', '香港', '台湾', '日韩', '日本', '韩国', '欧美', '美国', '海外', '泰国', '短剧'];
const ANIME_GENRES = ['国产', '日韩', '欧美', '港台', '海外', '剧场版', '动画', '奇幻', '冒险', '科幻', '热血', '搞笑', '恋爱', '校园', '悬疑'];
const VARIETY_GENRES = ['大陆', '港台', '日韩', '欧美', '海外', '真人秀', '选秀', '访谈', '脱口秀'];
const DOC_GENRES = ['历史', '自然', '动物', '科学', '军事', '社会', '人文', '美食', '旅行', '探索'];

export const SUB_ORDER = {
  movie: MOVIE_GENRES,
  tv: TV_REGIONS.concat(TV_GENRES, ['短剧']),
  anime: ANIME_GENRES,
  variety: VARIETY_GENRES,
  documentary: DOC_GENRES,
  other: []
};

const MOVIE_SET = new Set(MOVIE_GENRES);
const TV_SET = new Set(TV_GENRES);
const TV_REGION_SET = new Set(TV_REGIONS);
const ANIME_SET = new Set(ANIME_GENRES);
const VARIETY_SET = new Set(VARIETY_GENRES);
const DOC_SET = new Set(DOC_GENRES);
const REGION_SET = new Set([
  '国产', '大陆', '港台', '香港', '台湾', '日韩', '日本', '韩国',
  '欧美', '美国', '海外', '泰国'
]);

const BROAD = {
  movie: new Set(['电影', '影片', '电影片']),
  tv: new Set(['电视剧', '连续剧', '电视连续剧']),
  anime: new Set(['动漫', '动画', '动画片', '番剧', '动漫片']),
  variety: new Set(['综艺', '综艺节目']),
  documentary: new Set(['纪录片', '记录片', '纪录', '记录', '专题片']),
  other: new Set([])
};

const ALIASES = {
  动作片: '动作',
  喜剧片: '喜剧',
  爱情片: '爱情',
  科幻片: '科幻',
  动画片: '动画',
  剧情片: '剧情',
  悬疑片: '悬疑',
  犯罪片: '犯罪',
  惊悚片: '惊悚',
  冒险片: '冒险',
  家庭片: '家庭',
  儿童片: '儿童',
  音乐片: '音乐',
  历史片: '历史',
  奇幻片: '奇幻',
  恐怖片: '恐怖',
  战争片: '战争',
  传记片: '传记',
  歌舞片: '歌舞',
  武侠片: '武侠',
  灾难片: '灾难',
  西部片: '西部',
  古装片: '古装',
  运动片: '运动',
  微电影: '短片',
  记录片: '纪录片',
  记录: '纪录片',
  纪录: '纪录片',
  大陆剧: '国产',
  国产剧: '国产',
  港剧: '港台',
  台剧: '港台',
  港台剧: '港台',
  日剧: '日韩',
  韩剧: '日韩',
  日韩剧: '日韩',
  美剧: '欧美',
  欧美剧: '欧美',
  泰剧: '海外',
  海外剧: '海外',
  短剧: '短剧',
  大陆综艺: '大陆',
  港台综艺: '港台',
  日韩综艺: '日韩',
  欧美综艺: '欧美',
  海外综艺: '海外',
  国产动漫: '国产',
  国产动画: '国产',
  日韩动漫: '日韩',
  日韩动画: '日韩',
  欧美动漫: '欧美',
  欧美动画: '欧美',
  港台动漫: '港台',
  港台动画: '港台',
  海外动漫: '海外',
  海外动画: '海外',
  动画番剧: '番剧'
};

export function normalizeCategoryName(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/[\s　]+/g, '')
    .replace(/[·・]/g, '');
}

export function groupFromName(value) {
  const name = normalizeCategoryName(value);
  if (!name) return '';

  if (/纪录片|记录片|专题片|纪录|记录/.test(name)) return 'documentary';
  if (/综艺|真人秀|选秀|脱口秀|访谈/.test(name)) return 'variety';
  if (/动漫|动画|番剧|剧场版/.test(name)) return 'anime';
  if (/电视剧|连续剧|短剧|国产剧|港台剧|日韩剧|欧美剧|海外剧|美剧|日剧|韩剧|泰剧|台剧|港剧/.test(name)) {
    return 'tv';
  }
  if (/电影|影片|片$/.test(name)) return 'movie';
  return '';
}

export function classifyClass(name, parentName) {
  const parentGroup = groupFromName(parentName);
  if (parentGroup) return parentGroup;

  const ownGroup = groupFromName(name);
  if (ownGroup) return ownGroup;

  const normalized = normalizeCategoryName(name);
  if (MOVIE_SET.has(normalized)) return 'movie';
  if (TV_SET.has(normalized)) return 'tv';
  if (ANIME_SET.has(normalized) && !REGION_SET.has(normalized)) return 'anime';
  if (VARIETY_SET.has(normalized) && !REGION_SET.has(normalized)) return 'variety';
  if (DOC_SET.has(normalized)) return 'documentary';

  /* 只有地区名、没有 parent 时无法判断影视类型，放进「其他」而不是猜错。 */
  return 'other';
}

function isBroad(name, group) {
  const set = BROAD[group];
  return Boolean(set && set.has(name));
}

export function subNameOf(name, group) {
  const original = normalizeCategoryName(name);
  if (!original) return '';
  if (isBroad(original, group)) return '';

  let value = ALIASES[original] || original;
  if (isBroad(value, group)) return '';

  if (group === 'movie') {
    if (!MOVIE_SET.has(value) && !/(纪录片|记录片)$/.test(value)) {
      value = value.replace(/片$/, '');
    }
  } else if (group === 'tv') {
    if (TV_SET.has(value) || TV_REGION_SET.has(value) || value === '短剧') {
      /* 已经是标准类型名。 */
    } else if (TV_SET.has(value.replace(/剧$/, ''))) {
      value = value.replace(/剧$/, '');
    } else if (value.endsWith('剧') && value.length > 1) {
      value = value.slice(0, -1);
    }
  } else if (group === 'anime') {
    value = value.replace(/(动漫|动画|番剧)$/, '');
  } else if (group === 'variety') {
    value = value.replace(/综艺$/, '');
  } else if (group === 'documentary') {
    value = value.replace(/(纪录片|记录片|专题片|纪录|记录)$/, '');
  }

  value = ALIASES[value] || value;
  value = value.trim();
  if (!value || isBroad(value, group)) return '';
  return value;
}

function addType(types, sourceId, id) {
  const list = types[sourceId] || (types[sourceId] = []);
  if (!list.includes(id)) list.push(id);
}

/*
 * 输入 /api/categories 的返回：
 * { sources: [{ sourceId, ok, classes: [{ id, name, parent }] }] }
 * 输出 { groups: [{ key, name, types, children: [{ name, types }] }] }。
 */
export function buildCategoryTree(data) {
  const groups = new Map();
  TOP_GROUPS.forEach((group) => {
    groups.set(group.key, {
      key: group.key,
      name: group.name,
      types: {},
      children: new Map()
    });
  });

  const sources = Array.isArray(data && data.sources) ? data.sources : [];

  sources.forEach((entry) => {
    if (!entry || !entry.ok || !Array.isArray(entry.classes)) return;
    const sourceId = String(entry.sourceId || '');
    if (!sourceId) return;

    const classById = new Map();
    entry.classes.forEach((cls) => {
      if (!cls || !cls.id || !cls.name) return;
      classById.set(String(cls.id), cls);
    });

    const used = new Set();
    entry.classes.forEach((cls) => {
      if (!cls || !cls.id || !cls.name) return;
      const id = String(cls.id);
      if (used.has(id)) return;
      used.add(id);

      const parent = cls.parent ? classById.get(String(cls.parent)) : null;
      const groupKey = classifyClass(cls.name, parent ? parent.name : '');
      const group = groups.get(groupKey) || groups.get('other');
      const sub = subNameOf(cls.name, group.key);

      if (!sub) {
        addType(group.types, sourceId, id);
        return;
      }

      let child = group.children.get(sub);
      if (!child) {
        child = { name: sub, types: {} };
        group.children.set(sub, child);
      }
      addType(child.types, sourceId, id);
    });
  });

  const output = [];
  TOP_GROUPS.forEach((meta) => {
    const group = groups.get(meta.key);
    const order = SUB_ORDER[meta.key] || [];
    const children = Array.from(group.children.values()).sort((left, right) => {
      const leftIndex = order.indexOf(left.name);
      const rightIndex = order.indexOf(right.name);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      }
      return left.name.localeCompare(right.name, 'zh-Hans-CN');
    });

    const hasData = Object.keys(group.types).length > 0 || children.length > 0;
    if (!hasData) return;

    output.push({
      key: group.key,
      name: group.name,
      types: group.types,
      children: children.map((child) => ({ name: child.name, types: child.types }))
    });
  });

  return { groups: output };
}

export function findGroup(tree, key) {
  const groups = tree && Array.isArray(tree.groups) ? tree.groups : [];
  return groups.find((group) => group.key === key) || null;
}

export function groupTitle(key) {
  const group = GROUP_BY_KEY.get(key);
  return group ? group.name : '';
}

/*
 * 一级「全部」：聚合所有子类型，同时保留该组自己的 type_id。
 * 有些源把影片直接挂在「电影」这类父分类下，不能只请求子分类。
 */
export function aggregateGroupTypes(group) {
  const aggregate = {};
  if (!group) return aggregate;

  group.children.forEach((child) => {
    Object.keys(child.types).forEach((sourceId) => {
      child.types[sourceId].forEach((id) => addType(aggregate, sourceId, id));
    });
  });

  Object.keys(group.types).forEach((sourceId) => {
    group.types[sourceId].forEach((id) => addType(aggregate, sourceId, id));
  });

  return aggregate;
}
