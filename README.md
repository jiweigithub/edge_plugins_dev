# Edge Plugins Dev

Bilibili 问号弹幕助手浏览器扩展开发仓库。

## Bilibili 问号弹幕助手

在 Bilibili 视频页面添加问号弹幕按钮，支持点击发送单个问号和长按连发多个问号。

### 功能特性

- 在视频工具栏添加问号按钮
- 点击发送单个 `?` 弹幕
- 长按按钮累积问号数量，松开后连发
- 实时显示当前视频问号弹幕总数
- 自动检测登录状态，未登录时提示登录
- 5 秒冷却时间防止频繁发送

### 安装方法

1. 下载 `bilibili_question_mark` 目录
2. 打开 Edge 浏览器，进入 `edge://extensions/`
3. 开启「开发者模式」
4. 点击「加载解压缩的扩展」
5. 选择 `bilibili_question_mark` 目录

### 使用方法

1. 打开 Bilibili 视频页面
2. 工具栏出现问号按钮，显示当前问号数量
3. 点击按钮发送单个问号弹幕
4. 长按按钮可累积数量（如 `?x5`），松开后发送对应数量

### 文件结构

```
bilibili_question_mark/
├── manifest.json      # 扩展配置
├── content.js         # 内容脚本
├── content.css        # 样式
└── icons/             # 图标
    ├── icon16.svg
    ├── icon48.svg
    └── icon128.svg
```

### 开发说明

- 基于 Manifest V3 开发
- 使用内容脚本注入按钮到页面
- 通过 Bilibili API 获取视频信息和发送弹幕
- 本地计数缓存，每 5 分钟刷新一次

### 许可证

MIT