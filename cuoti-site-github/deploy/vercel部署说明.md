# Vercel 部署说明（当前版本）

> 数据存 **Vercel KV**（分块，单块 400KB），图片存 **Vercel Blob**，函数区域香港（hkg1）。
> 本地版保留：`cloud-server.js` + `启动（班级版）.cmd`，用于测试与局域网使用。

## 1. 准备工作

- Vercel 账号（建议 Pro，$20/月；Hobby 也能跑但函数上限 60s、用量有限）
- GitHub 仓库（已推送代码）
- 智谱 API Key（模型 `glm-5.3-flash`）

## 2. 导入项目

1. Vercel → **Add New → Project** → 选择 GitHub 仓库
2. Framework Preset：**Other**
3. Root Directory：仓库根目录；Build Command / Output Directory 留空
4. 点 **Deploy**

## 3. 连接存储（必须）

1. 项目 → **Storage → Create Database → KV**（Upstash Redis）→ Connect 到本项目
   - 自动注入 `KV_REST_API_URL`、`KV_REST_API_TOKEN`
2. 项目 → **Storage → Create Store → Blob** → Connect 到本项目
   - 自动注入 `BLOB_READ_WRITE_TOKEN`
3. 回到项目 → **Deployments → Redeploy**（让新环境变量生效）

> 未连接存储时会用内存兜底：能打开、能注册，但**重启后数据丢失**，只能演示。

## 4. 首次使用

1. 打开 `https://<项目>.vercel.app`
2. 注册**第一个**账号 → 自动成为管理员
3. 右上「设置」→ AI 实时批改 → 填入 Key → 保存
4. 选做：Settings → Environment Variables 添加 `REGISTER_CODE=班级邀请码` → Redeploy

## 5. 更新代码

```bash
git add .
git commit -m "更新说明"
git push origin main
```

自动部署；数据不受影响。回滚：Deployments → 选旧版本 → Promote to Production。

## 6. 备份

管理员登录 → 设置 → 备份/导出，保存 JSON。建议每周一次、重大更新前一次。

## 7. 限制

| 项目 | 限制 |
|---|---|
| 函数请求体 | 4.5MB（前端已压缩图片） |
| 函数时长 | Hobby 60s / Pro 300s（AI 单次约 3–8s） |
| KV 单次请求 | 约 1MB（已分块 400KB 规避） |
| Blob 存储 | 按量计费，5000 题约 1–1.5GB |

## 8. 常见问题

| 现象 | 处理 |
|---|---|
| 页面能开但接口 500 | 检查 KV/Blob 是否已连接并 Redeploy |
| 注册后登录提示账户不存在 | 存储未连接时的内存模式，重新部署会丢数据 |
| AI 报未配置 Key | 管理员设置里填写 |
| AI 报"模型返回为空" | 检查 Key 额度与模型名 |
| 国内访问慢/不稳 | 已设 hkg1；可绑定自有域名（需备案） |
