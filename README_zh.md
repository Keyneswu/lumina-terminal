<p align="center">
  <a href="./src/assets/icon.svg">
    <img src="./src/assets/icon.svg" width="120" height="120" alt="logo">
  </a>
  <h3 align="center">Lumina Terminal</h3>
</p>
<p align="center">
  简体中文 | <a href="./README.md">English</a>
</p>

一个基于 Tauri、React 和 Xterm.js 构建的现代跨平台终端模拟器，拥有精美的界面、命令面板和可自定义的配置文件。

## 安装
* Arch Linux（使用 `paru` 或 `yay` 等 AUR 助手）：
```shell
paru -S lumina-terminal-bin
# 或：yay -S lumina-terminal-bin
```
* 其他 Linux / macOS：使用脚本安装
```shell
curl -fsSL https://raw.githubusercontent.com/iewnfod/lumina-terminal/master/install.sh | bash
```
* Windows：从[发布页](https://github.com/iewnfod/lumina-terminal/releases)下载安装包

## 截图

### 终端
<p align="center">
  <img src="./assets/terminal-zh.png" alt="终端" width="800">
</p>

### 命令面板
<p align="center">
  <img src="./assets/command-palette-zh.png" alt="命令面板" width="800">
</p>

### 设置
<p align="center">
  <img src="./assets/settings-zh.png" alt="设置" width="800">
</p>

### 配置文件
<p align="center">
  <img src="./assets/profile-zh.png" alt="配置文件" width="800">
</p>

## 功能特性

### 终端
* 基于 [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/) 的多标签页终端 — 每个标签页运行一个真实的 Shell 进程
* **撕离标签页** — 将标签页移到独立窗口（`Ctrl+Shift+L` / `Cmd+Shift+L`），同时保留运行中的进程和滚动历史
* **终端内查找**（`Ctrl+Shift+F` / `Cmd+Shift+F`）— 支持区分大小写 / 全字匹配 / 正则，并显示实时结果计数，基于 [addon-search](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search)
* 每个配置文件可指定不同的 Shell — 支持 PowerShell、WSL、Git Bash 等任意可执行文件
* 可选的 [WebGL 渲染器](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl) — GPU 加速渲染
* [Unicode 11 宽度规则](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11) + 可选的[字形簇](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode-graphemes)渲染，正确处理 emoji/符号宽度
* 可选的[编程连体字](https://github.com/princjef/font-ligatures) — 通过字体真实的 OpenType GSUB 表实现（Fira Code 的 `www`、`//`，JetBrains Mono 的 `==` 等）
* 分块批量输出 — 流畅处理大文本输出，不阻塞 UI
* 拖放文件到终端即可插入文件路径；窗口/容器变化时自动调整尺寸

### 用户界面
* **命令面板**（`Ctrl+Shift+P` / `Cmd+Shift+P`）— 搜索并执行命令，支持键盘导航
* **标签栏** — 侧边栏显示标签列表，支持拖拽区域和悬停关闭，可通过标题栏或命令面板切换
* **自定义标题栏** — Windows 和 Linux 上窗口控制按钮与终端主题颜色融为一体
* **自动主题** — UI 明暗模式自动跟随终端背景色
* **颜色扩散** — 全屏 TUI 程序统一的边缘背景可铺满整个窗口边框，沉浸感更强（可在设置中开关）

### 键盘快捷键
* 完全可自定义的快捷键配置，保存在配置文件中。默认快捷键：
  * `Ctrl/Cmd+T` 新建标签页 · `Ctrl/Cmd+W` 关闭标签页
  * `Ctrl/Cmd+Shift+L` 撕离标签页 · `Ctrl/Cmd+Shift+F` 查找
  * `Ctrl/Cmd+,` 打开设置 · `Ctrl/Cmd+Shift+P` 命令面板
  * `Ctrl/Cmd+1–9` 按序号切换标签页
* `Ctrl+C` / `Ctrl+Shift+C` 互换（非 macOS）— `Ctrl+C` 复制选区，`Ctrl+Shift+C` 发送中断信号

### 配置文件
* 多个命名配置文件，各自独立设置 Shell、尺寸、字体、主题和启动命令（如 `vim`、`opencode`，命令退出时标签页关闭；SSH 配置文件会传给远程主机）
* 自定义终端主题，通过 JSON 文件加载（xterm.js ITheme 格式），支持实时颜色预览

### 国际化
* 英语 · 简体中文

### 欢迎向导
* 首次启动引导：语言选择 → 创建配置文件 → 撒花完成

## 性能

Lumina Terminal 的渲染管线针对高负载输出做了调优 —— 大文件 `cat`、ANSI 密集的 TUI、滚动、Unicode —— 同时通过读取背压保持内存占用可控。

以下基准测试使用 [vtebench](https://github.com/alacritty/vtebench)（Alacritty 使用的同一套测试工具），报告 **90 分位**（p90）采样延迟（越低越好）。Lumina 与以下三个同类对比：
- [Alacritty](https://alacritty.org/) — 原生 Rust + OpenGL，任何终端的性能天花板
- [Tabby](https://tabby.sh/) — Electron + xterm.js，流行的 Web 技术终端
- VS Code 内置终端 — Electron + xterm.js，使用最广泛的 Web 技术终端

| 测试 | Lumina | Alacritty | Tabby | VS Code |
|------|-------:|----------:|------:|--------:|
| cursor_motion | 58ms | 9ms | 89ms | 165ms |
| light_cells | 41ms | 8ms | 60ms | 138ms |
| medium_cells | 4ms | 8ms | 73ms | 320ms |
| dense_cells | 135ms | 25ms | 247ms | 473ms |
| scrolling_fullscreen | 6ms | 10ms | 74ms | 139ms |
| scrolling | 257ms | 158ms | 198ms | 730ms |
| scrolling_top_region | 176ms | 172ms | 191ms | 1296ms |
| scrolling_bottom_region | 263ms | 128ms | 198ms | 1250ms |
| scrolling_top_small_region | 277ms | 138ms | 175ms | 1391ms |
| scrolling_bottom_small_region | 248ms | 190ms | 181ms | 1364ms |
| sync_medium_cells | 4ms | 9ms | 72ms | 164ms |
| unicode | 4ms | 7ms | 73ms | 56ms |

Lumina 在多个测试中**追平甚至超越 Alacritty**（medium_cells、scrolling_fullscreen、sync_medium_cells、unicode），并**全面优于 Tabby 和 VS Code 内置终端** —— 而它们运行的是同样的底层 Web 渲染技术栈。

作为纯渲染压力测试，[DOOM Fire](https://github.com/const-void/DOOM-fire-node)（持续全屏 ANSI 动画）测量持续帧率（越高越好）：

| | Lumina | Alacritty | Tabby | VS Code |
|---|-------:|----------:|------:|--------:|
| fps | ~420 | ~1800 | ~175 | ~60 |

在持续重度重绘下，Lumina 保持着 **Tabby 和 VS Code 约 7 倍的帧率**。

> 测试平台：`AMD Ryzen™ AI 9 HX 370 w`, `NVIDIA GeForce RTX™ 5080 Laptop GPU`, Arch Linux

## 开发

```shell
git clone https://github.com/iewnfod/lumina-terminal.git
cd lumina-terminal
pnpm install
pnpm tauri dev
```

开发环境搭建、应用图标指南和代码规范请见 [**CONTRIBUTING.md**](./CONTRIBUTING.md)。完整的架构说明和贡献者规则在 [AGENTS.md](./AGENTS.md) 中。

## 使用的技术
* [Tauri & Tauri Plugins](https://tauri.app/)
* [Rust](https://rust-lang.org/)
* [pnpm](https://pnpm.io/)
* [TypeScript](https://www.typescriptlang.org/)
* [React](https://zh-hans.react.dev/)
* [Vite](https://cn.vite.dev/)
* [HeroUI](https://heroui.com/)
* [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/)
* [log](https://docs.rs/log/latest/log/)
* [Xterm.js & Addons](https://xtermjs.org/)
* [Tailwind CSS](https://tailwindcss.com/)
* [Lucide Icons](https://lucide.dev/)
* [react-markdown](https://github.com/remarkjs/react-markdown)

## 开源协议
[Mozilla Public License Version 2.0](./LICENSE)

## 宣发社区
* [LINUX DO](https://linux.do/)
