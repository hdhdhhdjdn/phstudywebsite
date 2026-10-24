# AGENTS.md — 部署与更新指南（Vercel 为主）

本仓库是「错题站」：IB DP 班级共享错题本。前端纯静态，服务端为 Vercel Serverless 函数（`api/index.js`），数据存 Vercel KV，图片存 Vercel Blob。

> 若只需本地/局域网使用，见文末「自托管」；**不要**改动已部署环境的数据。

## 0. 绝对禁止

1. **禁止**把 `cloud-data/`、`.env`、任何密钥提交到 Git 或写进代码/文档。
2. **禁止**在仓库中新增会清空/覆盖 KV 数据的脚本或命令（如 `kv flushall`、删除 `cuoti:*` 键）。
3. **禁止**删除 Vercel 项目里的 KV / Blob 集成（会丢全部数据）。
4. AI Key 只由管理员在网页「设置」填写，存在 KV 的 config 里；不要写进环境变量或源码。
5. `test/` 下的测试只写临时目录，可放心运行。

## 1. 首次部署（Vercel）

### 前提

- Vercel 账号（建议 Pro，见「额度与费用」）
- GitHub 仓库（代码已推送）
- 已准备智谱 API Key（GLM-5 系列）

### 步骤

1. **创建项目**：Vercel → Add New → Project → 导入 GitHub 仓库。
   - Framework Preset：**Other**
   - Root Directory：仓库根目录
   - Build Command：留空；Output Directory：留空
2. **创建 KV**：项目 → Storage → Create → **KV**（Upstash Redis）→ 连接到本项目。
   - 自动注入 `KV_REST_API_URL`、`KV_REST_API_TOKEN`
3. **创建 Blob**：Storage → Create → **Blob** → 连接本项目。
   - 自动注入 `BLOB_READ_WRITE_TOKEN`
4. **区域**：`vercel.json` 已设 `regions: ["hkg1"]`（香港，国内访问延迟最低）。如需改，改该文件后重新部署。
5. **Deploy**：首次部署完成后访问 `https://shphstudy.cc`。
6. **初始化管理员**：打开网站 → 注册第一个账号 → **该账号自动成为管理员**。
7. **配置 AI**：用管理员登录 → 右上「设置」→ AI 实时批改 → 填 Key、模型 `glm-5.3-flash`、接口 `https://open.bigmodel.cn/api/paas/v4` → 保存。
8. **注册控制（建议）**：Vercel 项目 → Settings → Environment Variables 添加 `REGISTER_CODE=你的班级邀请码`，重新部署。注册页需填邀请码。
9. **验收**：
   - [ ] 打开首页能注册/登录
   - [ ] 上传题目图片 → 「🔤 转文字」成功
   - [ ] 「👀 查看答案」能返回 AI 答案
   - [ ] 同学用手机能访问
   - [ ] 默认管理员密码已修改

## 2. 更新代码（日常最常用）

**数据在 KV/Blob 里，不在仓库里 → 重新部署不会丢数据。**

### 方式 A：Git 自动部署（推荐）

```bash
git add .
git commit -m "更新说明"
git push origin main
```

Vercel 会自动构建并上线 main 分支（约 1 分钟）。

### 方式 B：Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

### 方式 C：网页上传（不推荐）

会把项目当作新建项目，容易丢配置，尽量不用。

### 更新后

- 静态资源（html/js/css）Vercel 默认不长期缓存，同学**刷新页面**即可（异常时 Ctrl+F5）。
- 改了环境变量（如 `REGISTER_CODE`）→ Settings 保存后**必须 Redeploy** 才生效。
- 改了数据结构（如新增字段/集合）→ 代码需兼容旧数据；读不到会自动补默认值。

## 3. 回滚

Vercel → 项目 → **Deployments** → 选择上一个正常版本 → 右侧 **⋯ → Promote to Production**。
数据不受影响（KV/Blob 独立于部署）。

## 4. 备份与恢复（必须定期做）

- **手动导出**：管理员登录 → 「设置」→ 备份/导出（`/api/admin/backup` 返回完整 JSON），保存到本地。
- 建议每周导出一次，或重大更新前导出。
- **恢复**：目前需通过 Vercel KV 控制台写入或使用备份 JSON 重新导入（若需要恢复脚本可再开发）。
- **图片**：存于 Vercel Blob，删除 Blob 存储会丢失；勿随意清理。

## 5. 额度与费用（付费方案下的注意事项）

| 项目 | 说明 |
|---|---|
| Hobby（免费） | 函数 60s 上限、带宽/调用有额度，KV/Blob 有免费额度，够小规模试用 |
| Pro（$20/月/人） | 函数最长 300s、并发与带宽更高、KV/Blob 用量按量计费 |
| KV（Upstash） | 按存储量 + 请求数计费；本项目**已把数据库切成 400KB 分块**，可超 1MB 上限 |
| Blob | 按存储 + 流量计费；图片已压缩到最长边 1500px（约 150–300KB/张） |
| AI | 智谱 token 计费：转文字≈750、知识点≈750、答案≈900、批改≈950 tokens/次 |

估算：50 人 × 100 题 ≈ 5000 题 → 图片 ≈ 1–1.5 GB；AI ≈ 1200 万 tokens。按量付费金额很小（每月几元到几十元量级），主要固定成本是 Pro 订阅。

## 6. 域名（shphstudy.cc）

已在 Vercel → Settings → Domains 添加：shphstudy.cc（主）+ www.shphstudy.cc。
DNS：A @ → 76.76.21.21，CNAME www → cname.vercel-dns.com（以 Vercel 页面为准）。
详见 `deploy/域名配置.md`。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 部署成功但页面打不开 API | 检查 KV/Blob 是否已连接；函数日志看报错 |
| 上传图片 413 | 函数请求体上限 4.5MB；前端已压缩，若仍超请缩小图片 |
| AI 报"还没有配置 AI 密钥" | 管理员到设置里填 Key |
| AI 报"模型返回为空" | 检查 Key 额度；模型名是否为 `glm-5.3-flash` |
| 数据像丢了 | 是否误删 KV 集成/换了项目；用备份恢复 |
| 注册被陌生人占用 | 设置 `REGISTER_CODE` 并 Redeploy |
| 同学说打不开 | 国内访问 `*.vercel.app` 偶有不稳；绑定自有域名通常更稳定 |

## 8. 自托管（备选）

不使用 Vercel 时，可用 `cloud-server.js`（Node 零依赖）：
参考 `deploy/部署说明.md`、`deploy/cuoti.service`、`deploy/nginx-cuoti.conf`、`deploy/backup.sh`。
数据在 `cloud-data/`，**必须**排除在 Git 之外。

## 9. 自检命令

```bash
node --check api/index.js
node --check cloud-server.js
node test/vercel-api.test.js
node test/dom-check.js
```

全部输出「全部通过」即可。
