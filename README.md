# 洛克王国：世界 PVP 伤害计算器

一个基于 Vite + React + TypeScript 的静态前端应用，用于计算《洛克王国：世界》PVP 场景下的精灵属性、技能伤害、特性层数和手动战斗修正。

## 本地开发

```powershell
npm install
npm.cmd run dev
```

默认开发地址为 `http://127.0.0.1:5173/`。

## 本地检查

部署前建议依次运行：

```powershell
npm.cmd run validate:data
npm.cmd run lint
npm.cmd run build
```

其中 `npm.cmd run build` 会执行 TypeScript 编译并生成静态产物到 `dist`。

## 数据更新

线上构建不会访问外网，也不会自动运行导入脚本。需要更新精灵或技能数据时，在本地手动运行导入命令，确认生成数据无误后再提交。

```powershell
npm.cmd run import:skills
npm.cmd run import:spirits:bwiki
npm.cmd run validate:data
```

## Vercel 部署

本项目是纯静态 Vite 应用，可以直接部署到 Vercel。仓库根目录的 `vercel.json` 已固定部署配置：

- Framework Preset: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

首次发布流程：

1. 将代码推送到 GitHub 仓库 `puppetorz/roco-damage-calculator`。
2. 登录 [Vercel](https://vercel.com)，选择 `Add New Project`。
3. 导入该 GitHub 仓库。
4. 确认 Vercel 读取到上述配置后点击 `Deploy`。
5. 部署完成后使用 Vercel 分配的公开域名访问。

后续更新只需要推送新的 commit 到 GitHub，Vercel 会自动重新构建并发布。
