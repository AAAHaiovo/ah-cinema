# AH 影视

个人自用的影视库 App。纯静态 PWA，原生 HTML / CSS / JavaScript，**不需要后端、不需要登录、不需要构建工具**；Windows 浏览器和 iPhone 主屏幕都能用。

**线上地址**：<https://aaahaiovo.github.io/ah-cinema/>（iPhone 用 Safari 打开 → 分享 → 添加到主屏幕）

> 版权边界：只使用公共领域、开放授权，或你自己拥有使用权的影片。不接入盗版站、未授权聚合、破解接口，也不绕过 DRM。

---

## 现在能做什么

- 首页海报墙：海报 + 片名（片名不超出海报宽度，最多两行，超出省略）+ 年份/分类
- 上下滑动浏览；分页、上一页/下一页、跳页（输入页码并校验）
- 片库分类：全部 / 电影 / 动画 / 纪录片 / 短片
- 搜索：片名、原名、标签、拼音别名；最近搜索记录
- 详情页：海报、全名、原名、年份、分类、时长/集数、简介、清晰度、片源与授权、相关影片
- 播放器：播放/暂停、后退 10 秒、前进 10 秒、进度条、清晰度切换、倍速、静音、**横屏/竖屏切换**、全屏、返回
- **哔哩哔哩官方嵌入式播放器**：部分公共领域电影直接调用 B 站官方 iframe 播放，不转存视频；清晰度、倍速、字幕使用 B 站画面内控件，另有“在 B 站打开”入口
- 续播：退出后保存进度，下次从上次位置继续
- 观看历史、收藏、继续观看（B 站嵌入条目只记录“打开过”，不伪造播放进度）
- 白天 / 黑夜 / 跟随系统三档主题（白灰红 / 黑灰暗红），刷新不闪白
- iOS 风格：底部标签栏、桌面侧栏、圆角卡片、底部弹出面板、原生感按钮
- AH 标识：顶栏、启动页、空状态、About 页；**App 图标为品牌红底 + 白 AH**（另有 Android 独立 maskable 版）；播放画面无水印
- PWA：可安装到 Windows 桌面 / iPhone 主屏幕；Service Worker 缓存应用壳、片库和海报，**断网也能打开片库**
- 本地数据：IndexedDB（不支持时自动降级），可导出/导入 JSON 备份

---

## 本地预览（Windows）

需要先安装 Node.js。当前开发机是 Node v24。

```bash
cd "C:\Users\24751\Desktop\新建文件夹\影视"
node tools/serve.js 4173
```

浏览器打开 <http://127.0.0.1:4173/>。

这个本地服务器支持视频 Range 请求，所以进度条可以拖动。它只监听 `127.0.0.1`，iPhone 不能直接通过局域网访问；要在 iPhone 上测试，请先按下一节部署到 GitHub Pages。

### 安装成 Windows App

用 Chrome 或 Edge 打开上面的地址（部署后则是 GitHub Pages 地址），点地址栏右侧的“安装”图标，或浏览器菜单里的“安装 AH 影视”。安装后是一个独立窗口，有任务栏图标，断网也能打开应用壳。

---

## 部署到 GitHub Pages

GitHub Pages 免费版需要 **public（公开）仓库**。代码和图片会公开；观看历史、收藏、进度只存在你自己的设备里，不会上传。

1. 在 GitHub 新建一个仓库，例如 `ah-cinema`。
2. 在项目文件夹里执行（把 `<你的用户名>` 换成你的 GitHub 用户名）：

```bash
git init
git add .
git commit -m "AH 影视 v0.1"
git branch -M main
git remote add origin https://github.com/<你的用户名>/ah-cinema.git
git push -u origin main
```

3. 打开仓库的 **Settings → Pages**：
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，文件夹选 **/docs**
   - 保存
4. 等 1～2 分钟，访问：

```text
https://<你的用户名>.github.io/ah-cinema/
```

5. iPhone 上用 **Safari** 打开这个地址 → 分享按钮 → **添加到主屏幕**。之后从主屏幕打开就是全屏 App 的样子。

App 使用相对路径和 hash 路由，放在 `/<仓库名>/` 子路径下也能正常工作；`docs/.nojekyll` 已放好，GitHub Pages 不会用 Jekyll 处理这些文件。

---

## 示例片库与授权

当前共 11 部。前 4 部使用直接 MP4 片源，覆盖播放器的清晰度、倍速和续播；后 7 部是公共领域电影，通过 **哔哩哔哩官方嵌入式播放器**观看。

### 直接片源

| 影片 | 授权 | 片源 |
|---|---|---|
| 大雄兔（完整版，9:56） | CC BY 3.0 | W3C / Blender Foundation |
| 大雄兔（预告片） | CC BY 3.0 | W3C / Blender Foundation |
| 辛特尔（预告片，1080P / 720P / 480P） | CC BY 3.0 | Blender Foundation / W3C |
| 花（CC0 开放短片） | CC0 1.0 | MDN Web Docs |

### B 站官方嵌入（公共领域）

| 影片 | 年份 | 上传者 | BVID |
|---|---|---|---|
| 将军号 The General | 1926 | ゙珈乐 | `BV1er421H7UC` |
| 诺斯费拉图 Nosferatu | 1922 | ゙珈乐 | `BV1yZ421h7zW` |
| 卡里加里博士的小屋 Das Cabinet des Dr. Caligari | 1920 | 法力超级大风暴 | `BV1g4411V7bt` |
| 战舰波将金号 Броненосец «Потёмкин» | 1925 | ゙珈乐 | `BV1vj421Z78n` |
| 小城之春 Spring in a Small Town | 1948 | 迷惑龙 | `BV1b84y1v7v7` |
| 乌鸦与麻雀 Crows and Sparrows | 1949 | 世纪之年 | `BV1xz411z7DC` |
| 持摄影机的人 Человек с киноаппаратом | 1929 | 法力超级大风暴 | `BV1fE41167aA` |

这 7 部在条目里只保存 `embed: { provider: "bilibili", bvid, page }`，播放页用 `player.bilibili.com/player.html?bvid=...` 的官方 iframe；视频文件始终托管在哔哩哔哩，App 不下载、不转存、不重新分发。详情页和 About 页都显示片源、授权、上传者和回链。

片库数据在 `docs/data/catalog.json`。按现在的中文著作权规则，这 7 部电影的作者均已去世超过 50 年，或电影作品保护期已届满；如果你所在地区规则不同，请以当地法律为准。

> 早前的调研方案曾计划从 Internet Archive 批量取公共领域电影，但当前网络实测 **archive.org 不可达**；按照约定不绕过网络限制，所以先用可达的 W3C / Blender / MDN 素材和 B 站官方嵌入把功能做完整。

---

## 已知限制

- **示例片库现有 11 部**，仍是为了把界面和播放器功能做完整，不是最终片库。扩充时优先使用公共领域/开放授权影片，或你自己的文件。
- **B 站嵌入依赖哔哩哔哩**：需要能访问 `player.bilibili.com`；iframe 里的清晰度、倍速、字幕由 B 站播放器提供，App 自己的这些按钮不适用于嵌入条目。上传者删除视频、改为不可播放、地区限制或登录限制都会导致画面无法加载，此时用右上角“在 B 站打开”。
- B 站 iframe 在部分浏览器/无头测试环境里截图是黑屏，这是截图合成的限制，不代表页面结构有问题；真实 iPhone Safari 上还需人工确认能否正常起播和全屏。
- **视频不下载到本地**：断网时能打开 App、看到片库和海报（应用壳缓存），但播放仍需要网络。真正的“整片离线下载”需要另做下载管理，属于下一步；iOS 对 PWA 的大文件存储也有限制。
- 辛特尔的 **480P 片源自带黑边**（文件本身如此）；720P / 1080P 画面正常铺满宽度。
- iPhone 的安装、全屏和原生播放器行为受 Safari 限制；PWA 需要 HTTPS（GitHub Pages 满足）。安装后长期不打开，Safari 可能清理站点数据，建议偶尔用“导出备份”留一份 JSON。
- 播放器右下角的**方向按钮**用于手动横屏：iPhone 开启“竖排方向锁定”时，旋转手机不会改变网页方向，点这个按钮会把播放器旋转 90° 铺满屏幕；如果手机能自动旋转，转到横屏后按钮会自动隐藏，页面按正常横屏布局显示。
- 当前片源都在海外公开站点（W3C / Blender / MDN），国内网络下速度可能一般；播放失败时播放器会显示重试和换清晰度入口。
- 本地预览服务器只绑定 `127.0.0.1`，iPhone 要通过部署后的 HTTPS 地址访问。

---

## 目录结构

```text
影视/
├─ docs/                    # App 本体；GitHub Pages 只发布这个文件夹
│  ├─ index.html
│  ├─ manifest.webmanifest
│  ├─ sw.js                 # Service Worker（缓存版本 ah-cinema-v4）
│  ├─ css/                  # tokens.css / app.css / player.css
│  ├─ js/                   # app / router / store / catalog / views / player / ui / db
│  ├─ data/catalog.json     # 示例片库
│  ├─ assets/               # AH 标识、海报
│  └─ icons/                # 红白 PWA 图标（192 / 512 / 独立 maskable / Apple 180）
├─ tools/
│  ├─ serve.js              # 本地预览服务器（支持 Range）
│  ├─ cdp-run.js            # 用 Chrome 跑 24 项交互测试并截图
│  ├─ cdp-test.js           # 启动诊断
│  ├─ recolor-icon.ps1      # 生成品牌红 + 白 AH 图标（含 maskable）
│  └─ resize-icons.ps1      # 重新生成 192 / 180 图标
├─ 预览截图/                 # 测试自动生成的手机/桌面截图
├─ AH标识图/                 # 你提供的 AH 标识原图
├─ 需求文档（讨论稿）.md      # 早期需求讨论（历史）
├─ MVP方案（调研版）.md       # 早期调研方案（历史）
└─ README.md
```

---

## 测试

先启动本地服务器，再开一个终端：

```bash
node tools/cdp-run.js
```

脚本会自己启动一个无头 Chrome（不影响你正在用的浏览器），用全新的临时配置跑完下列检查，并把截图写到 `预览截图/`：

- 首页 11 部影片、启动页、片名宽度/两行截断
- 黑夜/白天主题切换、iOS 状态栏配色与截图
- 搜索、最近搜索、结果数量勾选
- 跳页弹窗与页码校验
- 分页逻辑（30 条 / 12 条一页）
- 片库分类筛选
- 详情页、收藏、收藏页
- 设置默认倍速、主题控件、每页 12 / 24 切换
- 播放器：480P 元数据、1.25× 默认倍速、播放/暂停、±10 秒、静音
- 清晰度切换（720P）并保留进度/倍速
- 倍速切换（1.5×）
- 播放器横屏 / 竖屏切换（旋转铺满、状态记忆与恢复）
- 断点续播、观看历史
- 详情页进入播放器、返回键回详情
- 备份导出 / 导入（进度与收藏条数核对）
- B 站官方嵌入式播放器：详情页信息、iframe 地址与尺寸、CSP 未拦截、外部观看记录、返回详情
- 关于页授权列表
- 我的页与安装提示
- Service Worker、manifest、缓存版本、红白图标像素校验
- 断网重载后片库和 11 张海报仍能打开
- 手机横屏布局（4 列海报、无横向溢出、底部导航可见）
- 桌面侧栏布局与截图

当前结果：**24/24 通过**，无未捕获异常、无控制台错误。测试脚本里的 Chrome 路径是当前机器的位置：

```js
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
```

换机器时改这一行即可。

---

## 以后可以怎么扩

1. **扩充合法片库**：往 `docs/data/catalog.json` 加条目，按现有字段填片名、海报、授权、片源；新海报放 `docs/assets/posters/`。想要离线也能看到新海报，把海报路径加进 `docs/sw.js` 的 `SHELL`，并把 `CACHE_NAME` 升一版（例如 `ah-cinema-v5`）。
2. **接入自己的影片文件**：先把文件放在可访问的地址（NAS / 对象存储 / 自己的服务器），再在 catalog 里填 URL；或做“本地文件导入”（需要额外的 UI 和存储方案）。
3. **整片离线下载**：用 OPFS / IndexedDB 分片存视频，加上下载队列、占用空间、断点续传；这是 P1，不是当前版本。
4. **远程访问**：如果家里有 NAS，可用 Tailscale 等私有网络在外网访问，不需要把片库公开。
5. **真实 iPhone 验收**：部署后用 Safari 添加到主屏幕，重点验证全屏、锁屏控制、后台暂停、蜂窝网络播放和存储清理。

---

## 版权与致谢

示例内容：

- **Big Buck Bunny** © Blender Foundation，CC BY 3.0，片源由 W3C 提供
- **Sintel** © Blender Foundation，CC BY 3.0，片源由 Blender Foundation / W3C 提供
- **Flower** CC0 1.0，来自 MDN Web Docs 的公开示例素材
- **将军号 / 诺斯费拉图 / 卡里加里博士的小屋 / 战舰波将金号 / 小城之春 / 乌鸦与麻雀 / 持摄影机的人**：公共领域电影，视频由哔哩哔哩上传者提供，App 仅使用 B 站官方嵌入式播放器并回链原页面

AH 标识来自项目内的 `AH标识图/`，App 图标使用品牌红 `#C92F36` 底 + 白色 AH；界面顶栏与启动页使用同一套标记。
