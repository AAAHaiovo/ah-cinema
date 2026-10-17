# AH 影视 · 可执行 MVP 方案（2026-10-17）

> **实施更新（2026-10-17 晚）：v0.1 静态 PWA 已完成并通过本机浏览器 23 项交互测试。**
> 由于本机网络无法访问 archive.org，原定批量取 Internet Archive 片库的方案暂缓；当前示例片库 4 部，来自 W3C / Blender Foundation / MDN，授权为 CC BY 3.0 / CC0。
> 已落地：海报网格、分页/跳页、分类、搜索、详情、播放器（暂停/±10 秒/清晰度/倍速/静音/全屏/返回）、历史、收藏、续播、白天/黑夜主题、PWA 安装、断网应用壳、AH 标识。
> 当前状态、运行与部署步骤见根目录 [`README.md`](README.md)；下文是早期调研方案，涉及 archive.org 的数量与流程尚未执行。
>
> 适用：单人自用、Windows + iPhone；代码由我实现，你负责确认、上传和验收。
> 路线：只使用公共领域/开放授权影片，以及你以后拥有使用权的自有文件；绝不接入盗版站、未授权聚合、破解接口或 DRM 绕过。
> P0 = v1 必须；P1 = 第二版；P2 = 以后。文中「需验证」必须在构建期或真机复核。

## 0. 一页结论

1. 技术：纯静态 PWA，原生 HTML/CSS/ES Modules，无框架、无构建；仓库建议 ah-cinema，从 docs/ 发布 GitHub Pages；hash 路由；全站相对路径。
2. 内容：v1 自带 21 部高置信美国 PD 影片，打开即有内容；P0 目标 36 部（2 页），P1 60 部，P2 120 部。全部来自 Internet Archive，详情页显示来源、授权依据、核验日期和回链。
3. 播放：video 直连 https://archive.org/download/{archive_id}/{file}；只列真实清晰度；单文件显示「原画」，最高不足 720P 时详情页写明「源片最高 480P」。P0 不转码、不做 HLS、不缓存完整视频。
4. 数据：进度/收藏/设置/最近搜索存 IndexedDB；P0 用 JSON 导出/导入备份；P1 可选 Cloudflare Worker + D1 自动同步。
5. 三个必须先验证的前提：
   - 你的 Windows 和 iPhone 能否访问 archive.org 与 *.us.archive.org（调研机 2026-10-17 在中国大陆网络实测不可达，你的网络需实测）；
   - 样本 MP4 是否支持 Range（拖动进度）且能被 video 直接播放；
   - GitHub Pages 免费版需要 public 仓库，目录/海报/rights.json 会公开。
6. 若 archive.org 不可达：不要用代理绕过网络限制。合法 Plan B 是把 PD 影片自托管到你可访问的对象存储/NAS（P2），或换可达的合法开放授权源；P0 先按直连 IA 设计并保留「源暂不可用」兜底。

## 1. 产品范围

### 1.1 v1 做什么（P0）

| 模块 | 内容 | 验收 |
|---|---|---|
| 浏览 | 首页海报网格，2/4/5/6 列，24 部/页，上一页/下一页/跳页 | 不做无限滚动；翻页回顶；URL 带 ?page= |
| 分类 | 默片/影史经典/黑色电影/科幻·恐怖/动画/剧集；年代、标签筛选 | 主类唯一，标签交叉 |
| 搜索 | 片名、原名、别名、年份本地搜索；最近搜索 10 条 | 不发网络请求 |
| 详情 | 剧照、海报、完整名称、年份/类型/地区/时长或集数、简介、来源与授权、收藏、播放/继续 | 来源/授权卡片必填 |
| 播放 | 播放/暂停、±10 秒、进度条、清晰度、倍速、字幕、全屏、返回、下一集 | 切档保留进度；退出保存 |
| 记录 | 历史、继续观看、收藏、最近搜索 | 95% 视为看完 |
| 主题 | 跟随系统/白天/黑夜；白灰红/黑灰暗红 | 刷新保持，不闪白 |
| PWA | manifest、图标、启动图、SW 壳缓存、iOS 安装引导 | 断网能开壳和目录 |
| 数据 | IndexedDB + JSON 导出/导入 | 换机可备份 |
| 品牌 | AH 顶栏、图标、启动页、空状态、关于页；红色版+黑白版 | 不拉伸、不描边、视频无水印 |

### 1.2 v1 不做什么

账号/会员/多用户/评论/弹幕/推荐；盗版站、未授权聚合、破解接口、DRM 绕过；运行期 IA/TMDB 搜索；转码/HLS/4K/HDR；完整视频离线下载；原生 App、Android/TV；用户自有文件导入（P2，仅预留 schema 和入口文案）；云同步（P1 可选）。

### 1.3 产品原则

合法优先（宁缺毋滥，每片有 rights 证据）；诚实清晰度（源片决定上限）；本地优先（观看数据不上传）；单用户省事（无登录、无后端、无构建）；iOS 优先但 Windows 不将就。

## 2. 片库

### 2.1 规模与批次

| 阶段 | 数量 | 说明 |
|---|---:|---|
| P0 首发门槛 | 21 | 本报告标记「发布」的条目，保证打开即有内容 |
| P0 目标 | 36 | 补 15 部，2 页；未复核不进 catalog |
| P1 | 60 | 约 2.5 页 |
| P2 | 120 | 5 页 |

单部工作量约 30 分钟（核验 10–15、中文简介 10、海报 5、试播 5）；36 部约 18–20 小时。电视剧一条目只对应一集，整季包不收；v1 剧集 UI 已实现，是否有剧集内容取决于第 25 条能否通过单集复核，否则 v1 全为电影。

### 2.2 分类

primaryCategory 唯一：silent 默片、classic 影史经典、noir 黑色电影、scifi_horror 科幻·恐怖、animation 动画、tv 剧集。tags 交叉；筛选支持分类、年代、标签；默认按人工 sortWeight，其次年份降序。

### 2.3 字段 schema

每个片目一个对象，完整骨架见 catalog_schema 字段。核心：
- 身份：id、kind（movie/series）、primaryCategory、tags、title（中文）、originalTitle、aliases、year、countries、languages、runtimeSec、synopsis、curatorNote、contentAdvisory。
- 图片：poster、backdrop（src/width/height/source/credit）。
- 来源：provider、archiveId、itemUrl、uploader、metadataSnapshotSha256。
- 授权：status、basis、jurisdiction、licenseUrl、rightsText、evidenceUrls、confidence、verifiedAt、reviewer。
- 剧集：episodes[]（id/season/number/title/durationSec/sources[]/subtitles[]）。
- 文件：sources[]（quality/height/width/label/src/mime/codec/sizeBytes/rangeOk/probe）。
- 状态：draft/published/hold、addedAt、updatedAt、catalogVersion。

规则：archiveId 唯一；itemUrl 必须等于 https://archive.org/details/{archiveId}；至少 1 个 H.264/AAC MP4；published 必须有 rights 证据和海报兜底；hold 禁止发布。

### 2.4 授权核验六步

1. 抓 metadata 快照（sha256）。
2. 按美国法看年代：1930 年及以前出版为 PD；1931–1963 查 CCE 续展；1964–1977 默认仍有版权；1978 以后只接受 CC0/PDM/明确许可。
3. 外国片查 URAA 与来源国 1996 年状态。
4. 交叉验证 IA 字段：licenseurl 最强；collection 只是栏目，不是授权证明；access-restricted-item=true 或 files[].private=true 直接排除。
5. 拆开影片与附着物：修复、4K 扫描、调色、新配乐、新译字幕、评论音轨都可能另有版权；优先原始转印/无现代配乐版。
6. 记录四件套：status、basis（可复核的一句话）、evidenceUrls、verifiedAt/reviewer。

证据优先级：Copyright Office/CCE > 出版事实 > IA licenseurl > IA collection > 社区 PD 列表 > 上传者描述。复核触发器：无 licenseurl；1930–1977；classic_tv；rights 含 copyright/restricted/permission；上传者非 creator；描述含 ripped/Blu-ray/DVD/restored/new score/colorized/AI upscale；动画角色；电视剧单集。

状态枚举：us_pd、pdm、cc0、cc_by、cc_by_sa、needs_review、hold。自动发布只允许前五种；needs_review/hold 默认隐藏。

### 2.5 署名与回链

详情页固定「来源与授权」卡片：来源 Internet Archive · archive_id + 条目回链；授权判断 + 依据；核验日期/核验人/置信度；CC 条目按 TASL 署名（标题、作者、来源、许可证链接、是否修改）。全站 rights.json 可逐条审计。文案写「依据…判断为美国公共领域」，不写「绝对无版权」。不使用 IA logo/名称暗示背书。关于页与详情页固定免责声明：仅播放公共领域、开放授权或你拥有使用权的文件。

### 2.6 25 条样本（archive_id 来自公开检索，全部需构建期复核）

说明：以下 archive_id 来自 2026-10-17 公开检索结果，详情页为 https://archive.org/details/{id}；调研机网络无法访问 archive.org，因此 licenseurl、height、private 未逐条读取，全部标「需验证」。状态：发布=可进首批；草稿=补 CCE 后发布；暂缓=首版不上。

| # | 中文名 | 年 | archive_id | 授权判断 | 状态 |
|---:|---|---:|---|---|---|
| 1 | 月球旅行记 | 1902 | ATripToTheMoonGeorgeMelies | 美国 PD 高 | 发布 |
| 2 | 卡里加里博士的小屋 | 1920 | the-cabinet-of-dr.-caligari-germany-1919 | 美国 PD 高 | 发布 |
| 3 | 诺斯费拉图 | 1922 | nosferatu.-1922. | 美国 PD 高；配乐另权 | 发布 |
| 4 | 福尔摩斯二世 | 1924 | MyMovie_20190318 | 美国 PD 高；配乐另核 | 发布 |
| 5 | 将军号 | 1926 | TheGeneral_201312 | 美国 PD 高 | 发布 |
| 6 | 大都会 | 1927 | FilmeMetropolis1927 | 美国 PD 高（仅原片） | 发布（换无硬字版） |
| 7 | 战舰波将金号 | 1925 | PancernikPotiomkin | 美国 PD 高；配乐另核 | 发布 |
| 8 | 歌剧魅影 | 1925 | ThePhantomOfTheOpera1925NewYorkGeneralReleasePrint_620 | 美国 PD 高 | 发布 |
| 9 | 安全至下 | 1923 | safety-last-1923 | 美国 PD 高；Carl Davis 配乐另权 | 发布（换 PD 配乐） |
| 10 | 阿赫迈德王子历险记 | 1926 | prince-achmed-english-subtitles | 美国 PD 高；新译英字另权 | 发布 |
| 11 | 格列佛游记 | 1939 | gullivers-travels-1939_202312 | 影片 PD；歌曲 1966 单独续展 | 暂缓 |
| 12 | 超人：疯狂科学家 | 1941 | max-fleischers-superman-01-the-mad-scientist-1941-hd | 美国 PD 高；角色商标另注意 | 发布 |
| 13 | 女友礼拜五 | 1940 | his_girl_friday | 美国 PD 高 | 发布 |
| 14 | 谜中谜 | 1963 | 1963_charade | 美国 PD 高（通知缺陷）；配乐另核 | 发布 |
| 15 | 绕道 | 1945 | Detour | 美国 PD 高；修复版另权 | 发布 |
| 16 | 陌生人 | 1946 | the-stranger-1946_202404 | 美国 PD 高；PDM 1.0 | 发布 |
| 17 | 红街 | 1945 | scarlet-street-1945 | 需复核 CCE 续展 | 草稿 |
| 18 | 搭车人 | 1953 | the-hitch-hiker-1953_202510 | 美国 PD 高 | 发布 |
| 19 | 堪萨斯城机密 | 1952 | Kansas_City_Confidential_1952 | 美国 PD 高；PDM 1.0 | 发布 |
| 20 | 灵魂狂欢节 | 1962 | carnival-of-souls-1962-restored | 美国 PD 高；修复版另权 | 发布 |
| 21 | 恐怖小店 | 1960 | The.Little.Shop.of.Horrors.60 | 美国 PD 高（法院确认） | 发布 |
| 22 | 活死人之夜 | 1968 | night_of_the_living_dead | 美国 PD 高（通知缺陷） | 发布 |
| 23 | 白僵尸 | 1932 | white-zombie_hd | 美国 PD 高 | 发布 |
| 24 | 地球上最后一个人 | 1964 | TheLastManOnEarth_72 | 美国 PD 中；第三方主张 | 暂缓 |
| 25 | 福尔摩斯探案集：宾夕法尼亚枪案 | 1954 | SherlockHolmes-TheCaseofthePennsylvaniaGun | 需复核单集版权链 | 草稿 |

首批发布清单：1–10、12–16、18–23，共 21 条。17、25 草稿；11、24 暂缓。若 6、9 找不到干净版本，则首批 19 条，仍满足「打开有内容」。完整片名、格式、清晰度和缩略图见 sample_catalog 字段。

### 2.7 发布门槛

- 21 条 rights 四件套齐全，0 条缺证据，0 条 archiveId 重复。
- 至少 12 条在 iPhone Safari 真机实际起播、拖动、切档、续播通过；失败条目降为 draft/hold。
- 每条有中文简介（80–120 字）、AH 占位海报、来源/授权卡片。
- 每条至少 1 个 H.264/AAC MP4，private=false；H.265/MPEG-2/MKV 不作为主源。
- 不做「先上线再补授权」；未复核内容不进 catalog。

### 2.8 海报三轨

A 轨 AH 占位（P0 默认，零版权风险）：600×900，墨黑 #111114 底、左侧 6px 红条（浅 #C92F36 / 深 #E05A5F）、AH 标记、中文标题最多 3 行、原名最多 2 行、底部年份+片长。使用现有 AH 源文件，按 1.027:1 等比缩放，不用 CSS 描边，不用 use+symbol。
B 轨 IA 缩略图：https://archive.org/services/img/{archive_id}；若 302 到 notfound.png 视为无图；人工确认能看清人脸/片名才用，object-fit: cover + 手工 focal point。
C 轨 TMDB 海报：P1 才考虑；海报版权归原权利人，TMDB 不授予版权；公开站点慎用。P0 不用 TMDB。

### 2.9 为什么主片库是 IA

IA 有大量 H.264 MP4，可直接 video 播放；Commons 只有 WebM/OGV，iOS 17.4 起才完整支持，不能当主源；LoC 多为约 5MB 低码率预览且 Cloudflare 会拦截；YouTube 只能官方 iframe，不能锁清晰度、不能离线、国内不可达。IA 是唯一能同时满足「合法、MP4、可直链」的主源，但必须逐条核权。

## 3. 架构

### 3.1 技术选型

纯静态 PWA，原生 HTML/CSS/ES Modules，无 Vite/React。理由：单用户、200–1000 条目录、静态内容；源码即部署产物，少 npm/构建/base path 失败点；iPhone Safari 与 Windows Chrome/Edge 都支持 ES Modules、IndexedDB、Service Worker。开发时在 docs/ 运行 python -m http.server 8000 或 VS Code Live Server；不能双击 file:// 打开。未来 UI 复杂到十几个共享状态页再迁 Vite+React，catalog 与 IndexedDB 契约可原样保留。

### 3.2 目录结构

```
影视/
  docs/
    index.html
    manifest.webmanifest
    sw.js
    .nojekyll
    css/tokens.css
    css/app.css
    css/player.css
    js/theme-boot.js
    js/app.js
    js/router.js
    js/catalog.js
    js/db.js
    js/store.js
    js/search.js
    js/player.js
    js/sync.js（P1）
    js/views/home.js
    js/views/library.js
    js/views/search.js
    js/views/history.js
    js/views/favorites.js
    js/views/me.js
    js/views/detail.js
    js/views/player.js
    js/views/settings.js
    js/views/about.js
    data/catalog.json
    data/rights.json
    data/health.json（P1）
    data/posters/*.webp
    data/subtitles/{archiveId}/{lang}.vtt
    icons/icon-192.png
    icons/icon-512.png
    icons/icon-maskable-512.png
    icons/apple-touch-icon-180.png
    icons/splash/*
    assets/ah-mark.png
    assets/ah-mark-small.png
  tools/
    intake.json
    build-catalog.mjs
    validate-catalog.mjs
    probe-sources.mjs
    srt-to-vtt.mjs
  .github/workflows/build-catalog.yml（P1）
  .github/workflows/link-check.yml（P1）
  README.md
```

docs/ 是唯一发布目录；tools/ 不发布。首页、CSS、核心 JS、manifest、图标进 precache；视频不进。

### 3.3 数据流

1. 人工在 tools/intake.json 填片名、年份、archive_id、分类、授权草稿。
2. 构建脚本（GitHub Actions 或可访问 IA 的机器）请求 https://archive.org/metadata/{id}，归一化 collection/creator/subject 为数组，过滤 private/access-restricted，解析 files[]。
3. 版权过滤器输出 rights.status；只允许 us_pd/pdm/cc0/cc_by/cc_by_sa 进 published。
4. 对候选 MP4 发 Range: bytes=0-1，记录 206、Content-Range、Accept-Ranges、ACAO、Content-Type；用 ffprobe 或运行时 loadedmetadata 确认 codec=h264 和 height。
5. 生成 docs/data/catalog.json、rights.json、posters、subtitles；CI 用 JSON Schema 校验，失败禁止部署。
6. 浏览器只 fetch 一次 catalog.json，构建内存索引；不运行期调用 IA/TMDB。
7. 用户操作写 IndexedDB；视频由 video 直连 archive.org。

IA 查询注意：advancedsearch 带排序最多翻到第 10,000 条（page×rows≤10000），超过常返回空对象；MVP 每个 collection 取 downloads 前 500 条即可；scrape API 可深度分页但可能要求认证（需验证）。不要用 server/dir 拼永久 URL，统一用 https://archive.org/download/{id}/{filename}，文件名逐段 encodeURIComponent。

### 3.4 路由

hash 路由，GitHub Pages 无需 rewrite，刷新不 404：
- #/ 首页
- #/library?type=movie&genre=noir&year=1940s&page=2
- #/search?q=...
- #/history
- #/favorites
- #/me
- #/title/:id
- #/watch/:titleId/:episodeId
- #/settings
- #/about

监听 hashchange；每次切页清理播放器计时器/事件；翻页回顶；详情返回恢复页码和滚动位置；5 个根 Tab 各自保存滚动位置与筛选。推入页隐藏 Tab 栏；播放页隐藏一切外壳。路由切换后 document.title 更新为「页面名 · AH 影视」，焦点移到 h1。

### 3.5 Service Worker

- CACHE_VERSION 随每次发布更新，如 ah-v1-2026-10-17。
- install：precache index、CSS、核心 JS、manifest、图标、离线兜底页。
- activate：删除旧 cache；clients.claim。
- fetch：
  - 非 GET → 网络。
  - destination=video 或 .mp4 → 直接 return，不拦截、不缓存。
  - 导航请求 → network-first，失败回退缓存的 index.html。
  - catalog.json/rights.json → stale-while-revalidate。
  - 海报 → cache-first，最多 200 张/30 天，按 hash 文件名。
  - 其他同源静态资源 → cache-first。
- 更新：发现 waiting 时显示「新版本可用 · 刷新」，用户确认后 skipWaiting + reload；不静默强刷。
- 离线横幅：「当前离线，仅显示已缓存内容」；明确视频不能离线。

### 3.6 IndexedDB

数据库 ah-cinema v1：
- progress，keyPath key（titleId:episodeId），字段 titleId、episodeId、positionSec、durationSec、completed、updatedAt；索引 byUpdatedAt。
- favorites，keyPath titleId，字段 active（false 为删除墓碑）、updatedAt。
- settings，keyPath key，存 theme、pageSize、defaultQuality、defaultRate、showContinue、autoplayNext、systemFullscreen。
- searches，keyPath term，字段 usedAt，最多 10 条。
- meta，keyPath key，存 dbSchemaVersion、lastCatalogVersion。

onupgradeneeded 按 oldVersion 增量创建/加索引，不无条件删库。进度写入节流 5 秒；pause、visibilitychange=hidden、pagehide、ended 强制写。IndexedDB 不可用时降级到内存 + localStorage（设置/收藏），并提示备份。

### 3.7 搜索

加载目录时构建 searchText = title + originalTitle + aliases + year + tags，做 NFKC、转小写、去空白/标点归一化。输入防抖 120ms；排序：完全相等 > 前缀 > 包含，再按年份/收藏；中文直接字符包含，无需分词；只渲染当前 24 条。P1 在构建期预计算拼音/首字母（pinyin、initials），支持 xmd 检索；P0 不引入 Fuse/MiniSearch。最近搜索存 IndexedDB，最多 10 条，可单条删除/清空。

### 3.8 视频与清晰度

- 只保留 .mp4 且 codec=h264、private=false 的文件；排除 HEVC/H.265、MPEG-2、Matroska、AVI、WMV、FLV。
- height 映射：≥1000→1080P，≥700→720P，≥400→480P，≥300→360P，≥200→240P，缺失→原画；同 height 只留 size 最大；按 height 降序。
- URL：https://archive.org/download/{encodeURIComponent(id)}/{filename 逐段 encodeURIComponent}；不要保存跳转后的 ia*.us.archive.org 节点地址。
- video 用 playsinline、webkit-playsinline、preload=metadata、poster；不要加 crossorigin，除非确认代理返回 ACAO；字幕/fetch/canvas 才需要 CORS。
- 构建期逐文件探测 Range；rangeOk=false 仍可播但 UI 标注「拖动可能失效」。
- 单文件：隐藏清晰度菜单，顶部显示「原画 · 480P」；最高 <720P 时详情页写「源片最高 480P，无法凭空提升」。
- 不做上采样、不把 720P 标成 1080P。

### 3.9 字幕

构建期扫描 .srt/.vtt；SRT→VTT：去 BOM、CRLF→LF、首行 WEBVTT、时间戳逗号改点、补 HH:、可选删 cue 编号；输出 docs/data/subtitles/{id}/{lang}.vtt，同源提供，Content-Type: text/vtt; charset=utf-8。播放器用 track kind=subtitles、srclang、label；同源 track 不需要 CORS。ASR 字幕单独标「自动生成，质量不保证」，默认关闭。字幕版权不明时不打包，只在详情页给 archive.org 原文件链接；P1 先做 5–10 部自制/授权中文字幕。

### 3.10 断点续播

键 titleId:episodeId；进入播放页 metadata 加载后：10 秒 < position < duration-15 秒 → seek 并 Toast「已从 12:34 继续」+「从头播放」；≤10 秒从 0 开始；≥duration-15 秒视为看完，从 0 开始（剧集可自动下一集）。播放中每 5 秒写一次；暂停/隐藏/离开/结束再写。首页「继续观看」按 updatedAt 倒序，最多 10 条，完成度 ≥95% 排除。

### 3.11 备份与同步

P0 手动：导出 {app:'ah-cinema', formatVersion:1, exportedAt, data:{progress, favorites, settings, searches}}；文件名 ah-cinema-backup-YYYYMMDD-HHmm.json；iOS 可存「文件/iCloud Drive」。导入先校验 app/formatVersion/字段，再按 updatedAt 合并；收藏含墓碑；设置按 key 取最新；拒绝高版本并给中文提示。首次使用后、每月、换机前提醒导出。

P1 自动（可选）：Cloudflare Worker + D1 单端点 GET/PUT /v1/state，Authorization: Bearer <32字节随机key>；服务端只存 key 的 SHA-256；D1 表 sync_state(user_id, revision, payload, updated_at)，单行 me；PUT 带 baseRevision，冲突返回 409 + 最新数据；客户端重拉、合并、重试一次。CORS 只允许 https://<user>.github.io；只同步进度/收藏/设置，不含视频；token 不进仓库/URL/备份。若嫌配置麻烦，保持手动即可。

### 3.12 安全与隐私

静态站无登录；CSP 尽量收紧：default-src 'self'；img-src 'self' data: https://archive.org https://*.archive.org；media-src https://archive.org https://*.archive.org；connect-src 'self'；script-src 'self'；style-src 'self'。主题启动脚本放外部 js/theme-boot.js，避免 inline script。所有目录文本用 textContent 渲染，不拼 innerHTML。不加载第三方统计/字体/CDN。同步 token 只存 IndexedDB 和请求头；备份不含 token。GitHub Pages 公开仓库意味着目录和 rights.json 公开，观看历史仍只在本地。

## 4. 页面与组件清单

| 页面 | 路由 | 目的 | 关键组件 | 空/错/载入 |
|---|---|---|---|---|
| 首页 | #/ | 继续观看 + 全部影片 | AH 顶栏、大标题、继续观看横排、海报网格、分页 | 骨架卡；无历史隐藏横排；目录失败显示重试 |
| 片库 | #/library | 分类筛选 | 分类 chips、年代/标签筛选、网格、分页 | 无结果显示「片库还没有内容」 |
| 搜索 | #/search | 本地搜索 | 搜索框、清除/取消、最近搜索、结果计数、网格 | 无结果「没有找到 xxx」；离线提示 |
| 历史 | #/history | 观看记录 | 日期分组、缩略图、进度条、清空确认 | 空「还没有观看记录」 |
| 收藏 | #/favorites | 收藏列表 | 网格、数量、空状态 | 「在详情页点 ♡ 收藏」 |
| 我的 | #/me | 个人入口 | 统计三格、收藏/设置/关于/备份入口 | 无账号，不做登录 |
| 详情 | #/title/:id | 影片信息与播放入口 | 剧照、海报、全名、meta、来源/授权、简介展开、选集、播放/收藏 | 骨架；无播放源时按钮禁用 |
| 播放 | #/watch/:titleId/:episodeId | 全屏播放 | video、顶部栏、中央按钮、进度条、控制行、手势层 | 缓冲 spinner；错误面板 |
| 设置 | #/settings | 外观/播放/数据 | 三档主题、默认清晰度/倍速、自动连播、导出/导入、清历史、存储估算 | 破坏性操作二次确认 |
| 关于 | #/about | 品牌与合规 | AH 标识、版本、来源说明、许可、免责声明 | 静态 |

全局状态：
- 骨架：延迟 150ms 显示，最少 300ms；海报 2:3 灰块 + 两行标题条；reduced-motion 改静态灰块。
- 空状态：AH 水印 64px、标题 17/600、说明 13px、可选 44px 主按钮。
- 错误：32px 感叹号、标题「加载失败」、说明、重试/返回、错误码小字。
- 离线：顶部 32px 横幅，恢复后消失。
- Toast：底部 Tab 上方 16px，深色底白字，3 秒消失，aria-live=polite。

关键交互：
- 卡片整块可点；标题最多 2 行省略；桌面 title 属性显示全名；iPhone 进详情看全名。
- 分页：上一页/第 X/Y 页/下一页/跳页；跳页 dialog，只接受 1–总页数整数，非法报错；翻页 window.scrollTo(0,0) 并更新 ?page=；首页/末页禁用。
- 详情主按钮三种文案：开始播放 / 继续观看 12:34 / 重新播放；剧集为播放第 1 集 / 继续观看 第 3 集 12:34。
- 收藏乐观更新，失败回滚；Toast 提示。
- 历史按 titleId 去重显示最近一集；清空需确认，删除历史与进度。
- 播放器退出先暂停、保存进度、再返回详情。

## 5. 设计规范

### 5.1 颜色 token

浅色：bg #F5F5F7、surface #FFFFFF、surface-2 #ECECF0、surface-3 #E3E3E8、text #111114、text-2 #6E6E73、text-2-alt #5F5F64、sep #E3E3E8、control-border #8A8A8F、accent #C92F36、accent-fill #C92F36、accent-pressed #A8242B、accent-soft #FBE9EA、on-accent #FFFFFF、success #248A3D、warning #B25000。
深色：bg #000000、surface #1C1C1E、surface-2 #2C2C2E、surface-3 #3A3A3C、text #FFFFFF、text-2 #A1A1A6、text-2-alt #AEAEB2、sep #38383A、control-border #8E8E93、accent #E05A5F、accent-fill #8E2F35、accent-pressed #74252A、accent-soft #3A1E22、accent-on-surface #F08A8E、on-accent #FFFFFF、success #30D158、warning #FF9F0A。
规则：浅色 #C92F36 可做文字/图标/按钮；深色 #E05A5F 只用于纯黑底或播放器；深色表面上的红字必须 #F08A8E；#8E2F35 只做按钮填充（白字），不做文字；#8E8E93 只用于禁用/装饰。红色只用于当前 Tab、主按钮、进度、收藏、选中页码、徽标，不铺大面积背景。
对比度实测：浅色主文字 17.31:1、次文字 4.66:1、红字 4.89:1、白字红底 5.33:1；#6E6E73 on #ECECF0 仅 4.30，改用 #5F5F64（5.39）；#8E8E93 on #F5F5F7 仅 2.99，只做禁用。深色白/黑 21、#E05A5F/黑 5.80、#F08A8E/#1C1C1E 7.07、白/#8E2F35 8.05、#FFB4B7/#3A1E22 8.98。完整 CSS 变量见 design_tokens 字段。

### 5.2 字体与字号

字体栈：-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif。时间/页码/集号用 tabular-nums。输入框 17px（防 iOS 聚焦放大）。
字号：Large Title 34/41/700（仅手机顶级页）；Title 1 28/34/700；Title 2 22/28/700；Title 3 20/25/600；Headline 17/22/600；Body 17/25/400；Subhead 15/22/500；Footnote 13/18；Caption 12/16；Tab 10/12/500；海报标题 15/20/500；播放器时间 12/16/500。中文 letter-spacing 0。

### 5.3 间距与圆角

间距 4/8/12/16/20/24/32/40/48；页面左右 16（手机）/24（768）/32（1024）/40（1440）；网格列间距 12/16，行间距 20/24；区块 32；海报与标题 8。
圆角：海报 12、卡片 16、按钮/图标按钮 12、搜索框 10、弹窗 14、底部面板 20（仅上圆角）、胶囊 999。

### 5.4 海报网格

手机 2 列；768–1023 4 列；1024–1279 4 列；1280–1439 5 列；≥1440 6 列，内容最大宽 1440 居中。24 部/页；5 列最后一行不足 5 个保持左对齐，不拉伸。海报 2:3、圆角 12、object-fit: cover；标题容器宽度=海报宽度，最多 2 行，-webkit-line-clamp:2、overflow:hidden、省略号，min-height 40px 保证同行对齐。首屏前 6 张 eager，其余 loading=lazy、decoding=async；提供 width/height 或 aspect-ratio 防 CLS。失败显示 --ah-surface-2 底 + 32px AH 白水印 opacity .18，不弹错。

### 5.5 分页

网格下方居中，min-height 44，margin 24 0 40。元素：‹ 上一页、第 X / Y 页、下一页 ›、跳页。首/末页 opacity .35、aria-disabled、不响应。320 宽允许只显示箭头 + aria-label。跳页 dialog 宽 min(270px, calc(100vw - 64px))、圆角 14、标题「跳转到页码」、说明「请输入 1–8 之间的页码」、inputmode=numeric、自动聚焦全选、非法提示「请输入 1–8 的整数」；Enter 确认、Esc 取消、点遮罩取消。翻页后回顶、焦点移到 h1、aria-live 播报「第 X 页，共 Y 页」。页大小 12/24/48，默认 24；修改后回第 1 页并钳制页码。不做无限滚动。

### 5.6 AH 标识

几何：宽高比约 1.027:1（以源文件为准），永远等比缩放，不拉伸/旋转/倾斜，不改 A/H 结构；不用 CSS 描边/阴影/渐变/圆角遮罩；不拆开 A 或 H；不用 use+symbol（会整体平移+裁切）。
颜色：主标识墨黑 #111114、纸白 #FFFFFF。红色强调版只换填充：浅色 #C92F36、深色 #E05A5F；不放在红/花色背景上；不给单笔画分别上色。
尺寸：≥32px 用正常版；<32px 用品牌加粗小尺寸版（笔画 +13），没有就保持 ≥32px，不用 CSS -webkit-text-stroke 伪造。顶栏 28×28 墨黑圆角 8 方块 + 白色标记（高约 18px）+「AH 影视」17/22/600；深色 28×28 #1C1C1E + 1px #38383A 边框 + 白标。
App 图标：1024×1024，背景 #111114，白色标记占边长 70%，不预切圆角；输出 1024/512/192/180；maskable 512 用同一墨黑底、标记缩到 56%。启动图：墨黑底 + 白标 96px + 「AH 影视」白字。空状态：96px 红标 opacity .12。播放器画面严禁水印。
源文件：c:/Users/24751/Desktop/新建文件夹/影视/AH标识图/1-AH标记（透明底）.png、4-App图标.png、2-品牌标识规范.png。

### 5.7 响应式

<768px 底部 Tab（49px + 安全区）、2 列、留白 16；768–1023 左侧图标栏 84px、4 列、留白 24；1024–1279 侧栏 240px、4 列、留白 32；1280–1439 5 列；≥1440 6 列、内容最大 1440。iPhone 横屏（max-height:500px 且 width<1024）4 列。详情内容最大宽 960，设置最大宽 720，播放器满视口。hover 只放 @media (hover:hover) and (pointer:fine)。

### 5.8 动效与无障碍

时长：按压 120ms、hover 180ms、Tab 150ms、推入 300ms/返回 250ms、面板 300ms、弹窗 200ms、主题 220ms（只过渡颜色）；曲线 cubic-bezier(.32,.72,0,1)。支持 prefers-reduced-motion（全部 0.01ms，禁 shimmer/缩放/位移）、prefers-reduced-transparency（毛玻璃改不透明）、prefers-contrast:more（边框加深）。
无障碍：所有可点元素 ≥44×44；焦点环 2px solid var(--ah-focus)、offset 2px；正文对比度 ≥4.5:1；每页一个 h1；图标 aria-hidden，图标按钮有 aria-label；Tab 栏 nav aria-label、当前项 aria-current=page；dialog role=dialog aria-modal、焦点陷阱、Esc 关闭、关闭回触发按钮；播放器进度条用 input range + aria-valuetext，时间不要每秒播报；字幕 ≥20px、背景 ≥60% 黑、最多两行；允许 pinch zoom，不设 maximum-scale=1；320px 不横向滚动。

## 6. 播放器

### 6.1 控件

页面 fixed inset:0、背景 #000、100dvh、overscroll-behavior:none；隐藏 Tab/侧栏。video 绝对铺满、object-fit:contain，playsinline、webkit-playsinline、preload=metadata、poster，不自动播放（必须用户手势 play()）。
顶部栏：高 56 + 安全区；返回 44、标题 17/600 白色单行省略、副标题 12px「第 3 集 · 1080P」、更多（P2）。
中央：播放/暂停 72×72 圆形 rgba(17,17,20,.45)+10px 模糊、白色图标 32；后退/前进 10 秒各 56×56，位于中心左右各 96px（小屏 72px），图标内写 10。
底部：进度行（当前时间 12/16 tabular / 进度条 / 总时长）；控制行高 44，右对齐：字幕 CC、清晰度胶囊「1080P」、倍速「1.0×」、下一集、全屏；每个按钮外层 44×44。时间 <1 小时 mm:ss，≥1 小时 h:mm:ss，未知 --:--。
自动隐藏：播放中 3 秒无操作整体 opacity 0（180ms）、pointer-events:none、桌面 cursor:none；暂停、菜单/弹窗、拖动进度、缓冲、结束、键盘焦点在控制层内时不隐藏；鼠标在底部 120px 暂停计时；点击/移动/按键立即恢复。

### 6.2 手势

P0：单击显示/隐藏控制层；双击左 30% -10 秒、右 30% +10 秒、中间 40% 播放/暂停，显示 80px 圆形涟漪 + 「-10s」/「+10s」600ms；控制层按钮不穿透。
P1：长按 500ms 2× 播放，松手恢复；水平拖动快进/快退（全宽=120 秒，显示目标时间气泡）；垂直左亮度遮罩 0–60% 黑（只能调暗）、右音量（iOS 提示用侧边音量键，不显示无效滑块）。
触摸：video 区域 touch-action:none；按钮 touch-action:manipulation；手势 setPointerCapture；控制按钮 44×44，进度条触控高 28。

### 6.3 Windows 快捷键

Space/K 播放暂停；←/→ 或 J/L ±10 秒；Shift+←/→ ±30 秒（P2）；↑/↓ 音量 ±5%；M 静音；F 全屏；C 字幕；N 下一集；P 上一集；0–9 跳到 0%–90%；Esc 先关面板，再退全屏，再暂停保存返回。焦点在 input/textarea/select 或 dialog 打开时不拦截；处理的键 preventDefault；控制层隐藏时按任意快捷键先显示。

### 6.4 清晰度策略

只列真实存在的档位：自动 / 1080P / 720P / 480P / 原画。最高 720P 时菜单不出现 1080P，底部注明「清晰度由源文件决定，最高 720P」；单文件隐藏菜单但显示当前档。默认：有 720P 选 720P，否则最高；移动网络优先 480P（Safari 无 Network Information API 时无法可靠判断，不要假装）。
切换：记 currentTime、playbackRate、是否播放；pause；换 src；load；loadedmetadata 后恢复 currentTime/rate；原来在播则 play()；失败回滚上一档并 Toast「切换失败，已恢复」。不把 720P 标 1080P，不上采样。

### 6.5 iOS Safari 限制

- volume 基本只读，只保留静音切换，提示用机身音量键；不做 0–1 音量滑杆。
- 不能对任意元素 requestFullscreen；iPhone 唯一入口 video.webkitEnterFullscreen()，进入后是原生播放器，自定义控制层被替换。全屏按钮做平台分支：Windows/iPad 用标准 Fullscreen API 保留自定义层；iPhone 调 webkitEnterFullscreen，监听 webkitbeginfullscreen/webkitendfullscreen 隐藏/恢复自定义层；都不支持则进入沉浸模式。
- 不能强制横屏，screen.orientation.lock 不保证；竖屏显示一次性「横屏观看更佳」提示，不遮挡视频。
- PiP/AirPlay 用特性检测；Media Session 只作增强，不承诺后台播放。
- 添加到主屏幕后存储更持久，但仍可能被系统清；status bar 样式启动时固定，运行中切主题可能下次启动才更新。
- 使用 viewport-fit=cover；顶部/底部/左右 padding 用 max(..., env(safe-area-inset-*))；刘海/灵动岛侧不放按钮，Home 条上方至少 12px 才放进度条。

### 6.6 缓冲、错误、自动连播

waiting 300ms 显示 36px spinner；3 秒加「缓冲中…」；15 秒显示「网络较慢」+「切换清晰度」。video.error.code：2 网络、3 解码、4 源不支持；自动重试 2 次（1s/2s 退避），仍失败显示面板「加载失败」+ 错误码 + 重试/返回详情/在 archive.org 打开。全部清晰度失败时不要静默转圈。
自动连播：剧集默认开；ended 显示结束卡（下集剧照/标题 + 5 秒倒计时环 + 立即播放/取消）；最后一集显示「已播完」+ 重播；浏览器阻止自动播放时停在结束卡等点击。Media Session（P1）设置标题/封面/播放/暂停/±10/上下集；播放时申请 Screen Wake Lock，暂停/退出/隐藏释放。

## 7. 风险与限制

| 风险 | 影响 | 缓解 | 级别 |
|---|---|---|---|
| archive.org 在用户网络不可达 | 空目录/坏海报/无法播放 | 构建期快照；真机先测；合法自托管 Plan B；不做代理绕过 | 极高 |
| 公共领域判定是管辖区相关 | 下架/侵权 | 按美国 PD 基线；逐片证据；外国片查 URAA；不确定标 needs_review | 高 |
| 修复版/新配乐/新字幕/彩色化/AI 放大另有版权 | 用了仍侵权 | 优先原始转印；《安全至下》换 PD 配乐；《大都会》换无硬字版 | 高 |
| IA 条目下架/换文件/改借阅 | 链接失效/同 id 换片 | metadata 快照；sha1 记录；P1 每周巡检；在 archive.org 打开兜底 | 高 |
| CORS/Range 因文件而异 | 拖动/字幕/fetch 失败 | 构建期逐文件 Range 探测；字幕同源；video 不加 crossorigin；失败换档 | 高 |
| GitHub Pages 约 1GB/100GB 月带宽 | 不能托管视频 | 只放目录/海报/字幕/前端；视频外置 IA | 高 |
| iOS 存储被系统清理/无后台下载 | 历史丢失/不能真离线 | JSON 备份；UI 只写在线观看；原生壳 P2 | 中 |
| TMDB 条款/key/海报版权 | 违规/泄露 | P0 不用 TMDB；P1 构建期用 secret，缓存≤6 个月，官方署名 | 中 |
| 清晰度预期 | 用户以为能凭空 1080P | 只列真实档位；详情页写明源片上限 | 中 |
| 角色/商标（Superman/Popeye） | 影片 PD 但角色形象受保护 | 只播影片；不用剧照做图标/周边/宣传 | 中 |
| 字幕版权 | 打包分发侵权 | 只收自制/授权字幕；不明时外链；ASR 默认关 | 中 |
| Service Worker 旧缓存/SPA 刷新 | 白屏/旧逻辑 | hash 路由；CACHE_VERSION；更新提示；测试升级路径 | 中 |
| 同步 token/XSS | 观看历史泄露 | CSP；无第三方脚本；textContent；token 不进仓库/URL/备份 | 中 |

## 8. 实施步骤（先能跑 → 再好看 → 再增强）

你只需要做三件事：确认名称和仓库、在 iPhone/Windows 实测网络与播放、按验收清单点一遍。代码、目录、海报模板和构建脚本由我写。

### M0 先能跑（0.5–1 天）

1. 确认 App 名称、GitHub 仓库名、仓库是否 public。
2. 在 Windows 和 iPhone 分别打开 archive.org 详情页，测试 1–2 个样本 MP4 能否播放、拖动；记录结果。
3. 建仓库 ah-cinema，建 docs/ 与 docs/.nojekyll，放最小 index.html，部署 Pages，确认 HTTPS、子路径、刷新不 404、SW scope 正确。
文件：docs/index.html、docs/.nojekyll、docs/css/tokens.css、README.md。
验收：手机能打开 https://<user>.github.io/ah-cinema/。

### M1 能看片（3–5 天，P0 核心）

1. theme-boot.js + tokens.css + 三档主题，防闪白。
2. app.js/router.js/store.js：hash 路由、5 个根 Tab、Windows 侧栏、推入页隐藏 Tab。
3. catalog.json 21 条 + 校验脚本；AH 占位海报；首页网格 + 分页 + 跳页。
4. 详情页：全名、meta、简介展开、来源/授权、收藏、播放/继续。
5. 播放器 v1：播放/暂停、±10、进度、清晰度、倍速、全屏、返回；IndexedDB 进度与续播。
文件：docs/js/*、docs/css/*、docs/data/catalog.json、docs/data/posters/*、docs/assets/ah-*。
验收：iPhone Safari 至少 12 部起播 <5 秒（Wi-Fi）、拖动、切档、退出再进续播；Windows 网格与分页正常。

### M2 好看好用（3–5 天，P0 收尾）

1. 搜索、历史、收藏、我的、设置、关于。
2. 字幕管线（SRT→VTT）+ 播放器字幕开关。
3. manifest、图标、启动图、SW、iOS 安装引导、离线横幅。
4. 空/错/载入骨架、Toast、无障碍、Windows 快捷键、安全区。
5. 扩到 36 条；逐条 probe，失败降级；跑发布门槛。
文件：docs/js/views/*、docs/sw.js、docs/manifest.webmanifest、docs/icons/*、docs/data/subtitles/*、tools/*。
验收：第 9 节清单全过。

### M3 增强（P1，1–2 周）

60 条片库；拼音/首字母搜索；自动连播 + 结束卡；Media Session + Wake Lock；每周链接巡检 GitHub Action + health.json；可选 Worker+D1 同步；5–10 部旗舰中文字幕；真实海报人工替换。

### M4 扩展（P2）

120 条；用户自有文件导入（本机 File System Access API 或合法对象存储）；自托管播放；真离线才考虑 Capacitor/原生壳 + Apple 开发者账号；专题策展。

## 9. 验收清单

### 内容与合规
- 21 条 published 均有 rights.status/basis/evidenceUrls/verifiedAt；0 条缺证据；0 条重复 archiveId。
- 每条详情页有「来源 Internet Archive + archive_id + 回链 + 授权判断 + 核验日期」。
- 至少 12 条真机起播/拖动/切档/续播通过；失败条目未发布。
- 无盗版源、未授权聚合、破解接口、DRM 绕过；关于页有免责声明。

### 布局与分页
- 390×844 两列、无横向滚动；320 宽仍两列；1024/1280/1440 分别 4/5/6 列。
- 海报 2:3 误差≤1px；标题宽度=海报宽；最多两行省略；长英文不撑破。
- 24 部/页；上一页/下一页/跳页可用；输入 0、999、abc 均报错；合法页码回顶；URL 带 ?page=；返回恢复页码和滚动。

### 详情
- 长片名完整换行不省略；年份/类型/时长或集数齐全；简介 3 行可展开/收起。
- 收藏刷新后仍在；主按钮三种状态文案正确；来源/授权可见且链接可打开；无播放源时按钮禁用并说明。

### 播放器
- 3 秒自动隐藏；暂停不隐藏；点击恢复；双击左/右 ±10 秒；长按 2×（P1）。
- 进度条拖动预览并 seek；切清晰度保留时间与播放状态；倍速生效；字幕开关；全屏分支不报错；退出保存；再次进入提示续播；断网显示错误面板可重试。

### 主题与无障碍
- 三档主题即时生效、刷新保持、无闪白；抽查 10 组文字/背景对比度≥4.5；深色表面红字为 #F08A8E；#8E2F35 不作文字。
- 所有按钮 ≥44×44；Tab 可走完首页→详情→播放→返回；焦点环可见；弹窗焦点陷阱/Esc；reduced-motion 无位移动画；VoiceOver 能读片名/集数/进度。

### PWA 与数据
- iOS 可添加到主屏幕；断网能开壳和目录；SW 更新有提示；图标/启动图正确。
- 导出备份可在另一台设备导入；收藏墓碑/设置/进度合并正确；清空历史需确认。

### 品牌
- AH 比例约 1.027:1 不变；App 图标标记 70%；maskable 56%；≤32px 不用红标；顶栏 28px 方块内标记约 18px；视频无水印；红标不在红底上。

## 10. 待确认项（只列需要你拍板的）

1. App 名称与仓库名：AH 影视 / AH 影库 / AH Cinema？仓库用 ah-cinema 还是别的？仓库必须 public（免费 Pages）。
2. 网络实测结果：你的 Windows 和 iPhone 能否直接打开 archive.org 并播放样本？若不能，是否接受 P2 自托管 PD 影片到 NAS/对象存储？这决定「在线看 IA」是否成立。
3. 海报策略：接受 AH 风格占位海报为主、真实海报为辅吗？若坚持真实海报，需要逐张评估版权并增加工期。
4. 备份方式：手动 JSON 导出/导入够用，还是必须自动云同步（需要一次 Cloudflare 配置，约 10–20 分钟）？
5. 离线需求：「在外面看」是只要在线能看，还是必须把完整视频下载到手机？后者 PWA 做不到可靠，需 P2 原生壳/Apple 开发者账号。
6. 内容边界：恐怖/暴力/种族刻板印象老片接受到什么程度？是否要默认展开内容提示？首版是否要包含 1 部剧集（第 25 条需先复核）？
7. 中文字幕：首版只做中文简介、字幕以后再说，还是先做 5–10 部旗舰中文字幕？IA 老片大多没有中文字幕。

## 11. 公开来源

- Internet Archive 搜索 API：https://archive.org/help/aboutsearch.htm
- Internet Archive 元数据：https://archive.org/developers/md-record.html、https://archive.org/developers/md-read.html
- Internet Archive 使用条款：https://archive.org/about/terms.php
- IA 影视集合：https://archive.org/details/feature_films、https://archive.org/details/silent_films、https://archive.org/details/classic_tv、https://archive.org/details/animationandcartoons
- IA 缩略图：https://archive.org/services/img/night_of_the_living_dead
- 美国 PD 影片列表：https://en.wikipedia.org/wiki/List_of_films_in_the_public_domain_in_the_United_States
- 美国版权局记录：https://www.copyright.gov/records/about.html
- CCE 电影卷：https://archive.org/details/copyrightrecords
- GitHub Pages 限制：https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- MDN ES Modules：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
- MDN Service Worker：https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- MDN IndexedDB：https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN Storage API/配额：https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit 主屏 Web App：https://webkit.org/blog/11338/home-screen-web-apps-and-safari/
- WebKit ITP/7 天清理：https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- Apple HTMLVideoElement：https://developer.apple.com/documentation/webkitjs/htmlvideoelement
- Apple 全屏限制讨论：https://developer.apple.com/forums/thread/133248
- Apple HIG Tab Bars：https://developer.apple.com/design/human-interface-guidelines/tab-bars
- WCAG 对比度：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- TMDB 图片/署名：https://developer.themoviedb.org/docs/image-basics、https://www.themoviedb.org/about/logos-attribution
- TMDB 条款：https://www.themoviedb.org/api-terms-of-use
- Wikimedia Commons 视频：https://commons.wikimedia.org/wiki/Commons:Video
- Library of Congress National Screening Room：https://www.loc.gov/collections/national-screening-room/
- YouTube IFrame API：https://developers.google.com/youtube/iframe_api_reference
- Cloudflare D1 限制：https://developers.cloudflare.com/d1/platform/limits/
- pwa-asset-generator：https://github.com/elegantapp/pwa-asset-generator