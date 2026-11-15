# AI Translator — Chrome 浏览器 AI 翻译插件

基于 Manifest V3 的 Chrome 扩展，支持全页面翻译、划词翻译与网页总结。AI 能力兼容 OpenAI Chat Completions 协议，可在设置中自行填写 API Key、Base URL 与模型名。

## 功能

- **全页面翻译**：一键翻译当前网页可见文本
- **双语对照**：保留原文，在原文下方展示译文；可随时在覆盖翻译 / 双语对照之间切换，并一键还原原文
- **划词翻译**：选中文字后弹出翻译结果
- **网页总结**：提炼当前页面主要内容
- **中英互译**：支持自动检测、中→英、英→中

## 安装（开发者模式）

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库根目录

## 配置与管理面板

- 工具栏 popup：快捷切换源/目标语言，选择翻译方式（覆盖翻译 / 双语对照），全页翻译 / 总结
- **管理面板**（popup 内「打开管理面板」，或扩展详情 → 扩展选项）：
  1. 配置 API Key / Base URL / 模型
  2. 切换源语言与目标语言，选择全页翻译方式并「应用到当前页面」
  3. 查看翻译历史（最近 200 条）
  4. Token 消耗统计（总量与近 7 日）

### 翻译方式

| 方式 | 效果 |
|------|------|
| 覆盖翻译（默认） | 直接用译文替换页面原文，与旧版本行为一致 |
| 双语对照 | 原文保持不动，译文以浅蓝竖线块展示在原文下方；正文块独占一行，链接、按钮、列表等行内文本紧跟在原文后 |

- 已翻译的页面切换方式时原地转换，无需重新调用接口；「还原原文」在两种方式下都会回到翻译前状态。
- 双语对照下选中「原文 + 译文」时，划词只翻译原文；关闭浮层后可用「翻译原文」按钮重新打开。

| 字段 | 说明 | 示例 |
|------|------|------|
| API Key | 服务商密钥 | `sk-...` |
| Base URL | OpenAI 兼容接口地址 | `https://api.deepseek.com` |
| 模型 | 模型名称 | `deepseek-v4-flash` |
| 源/目标语言 | 自动 / 中文 / 英文 | 自动检测 |

配置、历史与 Token 统计保存在 `chrome.storage.local`，**不会写入仓库文件**。请勿将 API Key 提交到 Git。

## 项目结构

```
├── manifest.json          # MV3 清单
├── background.js          # Service Worker（API / 历史 / Token）
├── popup/                 # 快捷弹窗
├── panel/                 # 管理面板（选项页）
├── content/               # 内容脚本（划词 / 全页 / 总结 UI）
├── lib/                   # 共享工具（配置、提示词、OpenAI 客户端）
└── icons/                 # 扩展图标
```

## 权限说明

- `storage`：保存用户配置
- `activeTab` / `scripting`：在当前标签页执行翻译与总结
- `host_permissions <all_urls>`：访问网页内容，并向用户配置的任意 Base URL 发请求

## 本地自动化测试

需已安装 Chrome 与 Node.js：

```powershell
npm install
$env:AT_API_KEY="sk-..."
$env:AT_BASE_URL="https://api.deepseek.com"
$env:AT_MODEL="deepseek-v4-flash"
npm test
```

路径含空格时，可将扩展复制到无空格目录，并设置 `$env:AT_EXT_DIR`。

双语对照的回归测试（默认使用内置桩接口，不消耗额度、不需要 Key）：

```powershell
npm run test:bilingual

# 用管理面板中已保存的 DeepSeek 配置实测（会产生真实 Token 消耗）
npm run test:bilingual:live
```

测试页面：`test/fixtures/bilingual.html`（同样的演示页也放在 `docs/bilingual.html` 供官网预览）。

## License

MIT
