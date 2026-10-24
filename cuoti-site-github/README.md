# 错题站 · 班级错题本

一个面向 **IB DP** 学生的班级共享错题本：上传错题图片 → AI 转文字 / 生成答案 / 批改作答 / 识别知识点，支持知识点分类、Mark Scheme、间隔复习与学情统计。

## 功能

- **错题本**：上传题目图片（含公式/图表），AI 自动转成文字并渲染数学公式（KaTeX）
- **AI 实时批改**：学生提交作答后自动判分、给出参考答案、逐点得分与错因（选择题 / 计算 / 简答）
- **AI 生成答案**：不用作答也能让 AI 解出标准答案与得分点
- **AI 识别知识点**：自动判断属于哪门 IB DP 学科、哪个 syllabus 知识点，并打标签
- **图形自动裁剪**：整页截图里自动定位图表区域并裁剪，只保留图形
- **知识点 / Mark Scheme**：按知识点归类、记录评分要点与漏点
- **复习**：间隔复习（SM-2 简化版），每账号独立进度
- **统计**：按科目/知识点/错因统计掌握情况
- **班级共享**：多账号、公开注册、共享题库；每人题目状态独立（新题/复习中/已掌握）
- **离线可用**：单文件版可直接双击打开（IndexedDB 本地存储）

## 线上地址

**https://shphstudy.cc**（Vercel 部署，香港区域）

## 技术栈

- 前端：原生 HTML / CSS / JavaScript（无构建工具、无框架），KaTeX 渲染公式
- 班级版服务端：Node.js 零依赖 HTTP 服务（`cloud-server.js`），JSON 文件存储 + 本地图片
- Vercel 版：`api/index.js` 单函数 + `@vercel/kv` + `@vercel/blob`（未配置时内存兜底）
- AI：OpenAI 兼容接口（默认智谱 GLM），支持视觉（图片输入）

## 快速开始

> 推荐流程：**本地测试 → 推 GitHub → Vercel 自动部署**。详见 `测试清单.md` 与 `AGENTS.md`。

### 本地测试（班级版 / 单机）

1. 安装 Node.js 18+
2. 双击 `启动（班级版）.cmd`，浏览器打开 `http://localhost:8765/`
3. 第一个注册的账号自动成为管理员
4. 管理员在「设置 → AI 实时批改」填入 API Key 后即可使用 AI 功能
5. 同学在同一 WiFi 下用控制台打印的局域网地址访问

### Vercel 部署（线上共享）

1. 把仓库导入 Vercel（Framework 选 **Other**，无需构建命令）
2. Storage 里创建 **KV** 和 **Blob** 并连接到项目（自动注入环境变量）
3. 重新部署后打开域名，注册第一个账号即为管理员
4. 管理员填入 AI Key；如需限制注册，加环境变量 `REGISTER_CODE`
5. 更新代码：`git push` 即自动部署，数据在 KV/Blob 不受影响

详见 `deploy/vercel部署说明.md`。

## 目录结构

```
index.html          主页面（7 个功能页）
login.html          登录 / 注册
cloud-server.js     班级版服务器（零依赖）
server.js           本地静态服务
api/index.js        Vercel Serverless 版本
css/                样式 + KaTeX 样式与字体
js/                 前端逻辑（app / db / api / zip / seed / katex）
test/               测试（ZIP、DOM 引用、API）
deploy/             部署脚本与说明
build-single.js     打包单文件离线版
```

## 安全说明

- `cloud-data/` 存放账号、密码哈希、AI 密钥与上传图片，已在 `.gitignore` 中排除，**不要提交**
- 密码使用 scrypt 加盐哈希存储
- AI Key 由管理员在页面中配置，保存在服务端数据文件里，不会发给其他用户

## License

个人/班级学习用途，可自由修改使用。
