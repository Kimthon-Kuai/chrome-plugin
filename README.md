# AI Translator — Chrome 浏览器 AI 翻译插件

基于 Manifest V3 的 Chrome 扩展，支持全页面翻译、划词翻译与网页总结。AI 能力兼容 OpenAI Chat Completions 协议，可在设置中自行填写 API Key、Base URL 与模型名。

## 功能

- **全页面翻译**：一键翻译当前网页可见文本
- **划词翻译**：选中文字后弹出翻译结果
- **网页总结**：提炼当前页面主要内容
- **中英互译**：支持自动检测、中→英、英→中

## 安装（开发者模式）

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库根目录

## 配置与管理面板

- 工具栏 popup：快捷切换源/目标语言，全页翻译 / 总结
- **管理面板**（popup 内「打开管理面板」，或扩展详情 → 扩展选项）：
  1. 配置 API Key / Base URL / 模型
  2. 切换源语言与目标语言
  3. 查看翻译历史（最近 200 条）
  4. Token 消耗统计（总量与近 7 日）

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

## License

MIT
