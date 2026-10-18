# dsh-screenshot

> 由 **deepseek好孩子** 完成 · 开源协议 **MIT** · 任何人都可以免费下载、使用、修改和分发。

DeepSeek Harness 输入框截屏按钮：**不调用 Windows 的 `ms-screenclip:` 浮层**，随插件带一个
几十 KB 的原生截图小工具，点一下直接冻结全屏，拖选、回车，截图就进当前会话的输入框。

```
点相机  →  全屏冻结  →  拖选 / 拖手柄调整  →  回车或 ✓  →  自动插入输入框
```

选区外的画面压暗成灰色，选区本身保持原亮度；边框、手柄、尺寸标签和确认键都是微信同款绿色。

**GitHub**：<https://github.com/linandadada-pixel/dsh-screenshot>  
**下载**：在 GitHub Releases 下载 `dsh-screenshot-<version>.tgz`，或直接
`dsh plugin --profile web add github:linandadada-pixel/dsh-screenshot`。

## 为什么快

| 方案 | 点击到可选区 |
|---|---|
| Windows `ms-screenclip:`（旧版） | 约 2–3 秒（系统截图 App 冷启动 + 浮层动画） |
| 本插件自带 helper（2.0+） | 进程启动约 **60 ms**，浮层 0.5 秒内出现，之后每次都是毫秒级 |

helper 是 `lib/ShotHelper.cs` 编译出的 `lib/dsh-shot-helper.exe`（约 20 KB）：

- 用 `Graphics.CopyFromScreen` 一次性抓整个虚拟桌面；
- **双层窗口**：全屏静态压暗层 + 选区大小的动态层，拖动时只重绘选区附近，
  实测约 **10 ms/帧**（~100 fps），不再整屏 2880×1620 重绘；
- 选区外灰色遮罩（预先生成的压暗截图，逐像素计算，不依赖 alpha 混合）；
- 微信绿 `#07C160` 边框、8 个缩放手柄、尺寸标签、✓/✕ 工具条；
- `Esc` / 右键 / ✕ 取消，`Enter` / ✓ / 双击选区内确认；
- 只在确认时裁剪并写出 PNG，退出码 0 成功、2 取消。

> 首次使用（或更新了 `ShotHelper.cs`）会自动用系统自带的 `csc.exe` 编译一次，约 1 秒；
> 编译结果缓存在插件目录，之后启动不再编译。

## 与语音输入共存

截屏按钮注册在 **列表座位** `conversation.input.right`，语音输入用
`conversation.input.activity` 单座位，两者互不抢位：

```
没装语音输入：  [模型] [📷] [发送]
装了语音输入：  [模型] [📷] [🎤] [发送]
```

## 安装

### 插件市场 / 插件页

市场收录合并后，在 DSH 的「插件」页面搜索 `dsh-screenshot` 即可安装（插件商店装的是标准
DSH bundle，`package.json` 里的 `dsh.bundle.patch` 会插入 Host 路由和客户端 UI）。

也可以直接从 GitHub 源安装：

```powershell
dsh plugin --profile web add github:linandadada-pixel/dsh-screenshot
```

> 桌面端的 `dsh plugin` CLI 按设计拒绝 `--profile desktop`；桌面端请用「插件」页，
> 或下载 Release 里的 tgz 后用内置 `plugin_manager` 安装。

### 本地安装（本仓库）

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

做三件事：

1. 复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-screenshot`；
2. 用 `csc.exe` 编译 `lib\dsh-shot-helper.exe`；
3. 在 profile 的 `cordis.patch.yml` 追加 `dsh-screenshot` 条目（幂等）。

DSH 会通过 HMR 热加载；没反应就重开窗口。

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

或从插件页停用/卸载。

## 使用

1. 点输入框右侧（模型选择器和发送之间）的相机图标；
2. 全屏冻结后拖出选区；松手后可以拖选区移动、拖 8 个手柄缩放；
3. 按 `Enter` 或点 ✓ 确认；按 `Esc`、右键或点 ✕ 取消。

截图会作为图片附件进入草稿，补一句话再发送即可。

## 开发

```
dsh-screenshot/
├── package.json          dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      把 Host 半侧挂进 profile
├── icon.svg              插件图标
├── install.ps1           复制 + 编译 + 写 patch
├── uninstall.ps1         反向操作
├── docs/composer.png     界面实拍
└── lib/
    ├── index.js          Host：/dsh-shot/ping、/capture、/cancel
    ├── client.js         浏览器半侧：列表座位相机按钮 + 插入附件
    └── ShotHelper.cs     原生截图小工具（编译成 dsh-shot-helper.exe）
```

### 编译 helper

```powershell
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" `
  /nologo /target:winexe /optimize+ `
  /out:lib\dsh-shot-helper.exe lib\ShotHelper.cs `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll
```

`lib/dsh-shot-helper.exe` 已被 `.gitignore` 忽略，不提交二进制；发布包里也不带 exe，
安装后在目标机器上编译。

### Host 路由

- `POST /dsh-shot/capture` 启动 helper，等它写 PNG；返回 `image/png`；
- `POST /dsh-shot/cancel` 结束等待并 `taskkill /T /F`；
- `GET /dsh-shot/ping` 返回版本、helper 路径、是否已编译；
- 三个路由都过 `connection.requestRejection` 信任栅栏，同一时间只允许一次截图。

### 发布与安装来源

- **GitHub**：<https://github.com/linandadada-pixel/dsh-screenshot>
- **Releases**：每个版本都提供 `dsh-screenshot-<version>.tgz`，任何人都可以直接下载。
- **从 GitHub 安装**：

  ```powershell
  dsh plugin --profile web add github:linandadada-pixel/dsh-screenshot
  ```

  桌面端在「插件」页用 GitHub 源安装，或下载 tgz 后用内置 `plugin_manager` 安装。
- **插件市场**：已向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  提交收录 PR [#7888](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7888)；
  合并后 DSH 插件市场会自动出现（通常一天内）。
- **npm**：发布到 npm 需要 npm 账号。仓库带 `.github/workflows/publish.yml`，
  在 GitHub Secrets 配置 `NPM_TOKEN` 后发布 Release 即自动 `npm publish`；之后也可以
  `dsh plugin --profile web add dsh-screenshot`。

## 兼容性

- Windows 10/11（x64），需要系统自带的 .NET Framework 4.x（`csc.exe`）；
- DSH Desktop / `dsh web` 均可；
- 多显示器：helper 覆盖 `SystemInformation.VirtualScreen` 并按物理像素裁剪；
- 高 DPI：启动时设置 Per-Monitor V2，坐标与截图 1:1。

## 更新日志

- **2.2.0** — 拖动选区不再卡顿：改成「静态全屏压暗层 + 选区大小动态层」，
  只重绘选区附近并跳过重复 mousemove，实测约 10 ms/帧。
- **2.1.0** — 选区外灰色遮罩、微信绿边框/手柄/尺寸标签；压暗图用逐像素计算，
  不依赖 GDI+ alpha 混合。
- **2.0.0** — 移除 `ms-screenclip:`/PowerShell 剪贴板链路，改为自带原生 helper；
  点击到浮层约 0.5 秒；支持多显示器、缩放手柄、回车/✓ 确认、Esc/右键取消；
  补齐 LICENSE、图标与发布元数据。
- **1.2.0** — 修复退出截图后卡死；与官方语音输入同屏共存。
- **1.1.0** — 从单座位迁到列表座位。

## License

MIT
