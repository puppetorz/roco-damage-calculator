# 项目信息备忘

本文档记录对当前仓库的通读结果，供后续维护、开发和交接使用。

## 项目概览

- 项目名称：`roco-damage-calculator`
- 项目类型：纯前端静态应用
- 主要用途：洛克王国：世界 PVP 伤害计算器
- 技术栈：Vite + React + TypeScript
- 部署目标：Vercel，产物目录为 `dist`
- 当前数据规模：
  - 精灵数据：456 条
  - 技能数据：491 条
  - 推荐个体配置：456 条
  - 常见配招数据：当前为 0 条

## 运行与检查命令

常用命令定义在 `package.json`：

```powershell
npm install
npm.cmd run dev
npm.cmd run validate:data
npm.cmd run lint
npm.cmd run build
npm.cmd run preview
```

其中：

- `dev`：启动 Vite 开发服务器。
- `build`：先运行 TypeScript 项目构建检查，再用 Vite 生成静态产物。
- `lint`：运行 ESLint。
- `validate:data`：校验生成数据并写入 `data-import-report.md`。
- `import:skills`：从 BWIKI 导入技能数据。
- `import:spirits:bwiki`：从 BWIKI 导入精灵数据，并关联技能与推荐个体。
- `import:spirits`：从本地 xlsx 导入精灵种族值。
- `import:data`：早期/辅助的数据源探测脚本。

## 目录结构

- `src/`：前端应用源码。
- `src/App.tsx`：主界面和主要交互状态，包含攻防双方选择、技能选择、规则开关、手动修正和结果展示。
- `src/App.css`、`src/index.css`：界面样式。
- `src/types/battle.ts`：战斗、精灵、技能、性格、伤害输入/输出、效果规则等核心类型。
- `src/utils/`：计算和规则解析逻辑。
- `src/data/`：静态数据入口和属性克制表。
- `src/data/generated/`：脚本生成的大体量静态数据。
- `scripts/`：数据导入和校验脚本。
- `documentory/`：原始资料文件，包括规则文档、属性关系图和精灵种族值 xlsx。
- `public/`：静态图标资源。
- `dist/`：构建产物目录。

## 前端应用行为

主界面围绕一次 PVP 伤害计算组织：

- 选择进攻方和防守方精灵。
- 支持搜索精灵，搜索范围包含名称、编号、形态、阶段、属性和特性。
- 最近选择的精灵会保存到 `localStorage`，最多保留 8 条。
- 每只精灵可选择性格，并在 6 项属性中选择 3 条 `+60` 个体。
- 进攻方技能列表来自该精灵的常见技能或可学习技能，只展示可计算伤害的物理/魔法技能。
- 技能说明和特性说明会被解析成动态规则，例如连击数、威力加成、按使用次数成长、按敌方能耗计算威力、属性或条件触发的能力修正等。
- 用户还可以手动填写攻防双方最终状态修正，作为当前战斗状态的补充输入。

## 核心计算链路

主要计算流程如下：

1. `calculatePvpStats` 根据种族值、个体值和性格计算 PVP 实际属性。
2. `calculateTypeMultiplier` 根据技能属性和防守方属性计算克制倍率。
3. `parseSkillRules` 和 `parseTraitRules` 从技能/特性描述中抽取可计算规则。
4. `resolveDamageInput` 将技能、属性、克制、本系、规则开关、层数和手动修正合并为 `DamageInput`。
5. `calculateDamage` 套用伤害公式，输出最终伤害、占防守方生命百分比和风险等级。

关键设定：

- PVP 固定等级为 `60`。
- 个体值最大为 `60`，默认只允许选择 3 条满个体。
- 本系加成为 `1.25`。
- 天气倍率目前固定为 `1`。
- 多段减伤按剩余伤害率相乘，目前默认减伤数组为空。
- 最终取整集中在 `gameRound`，当前使用 `Math.round`；代码注释说明游戏内 0.5 进退位规则尚未完全确定，后续如确认规则应优先替换这里。
- 双属性克制倍率由单属性倍率相乘后封顶为 `3`。

## 数据层说明

- `src/data/spirits.ts`、`skills.ts`、`builds.ts` 只是轻量入口，实际数据来自 `src/data/generated/`。
- `src/data/generated/spirits.generated.ts` 体积较大，包含精灵基础资料、属性、种族值、特性和技能关联。
- `src/data/generated/skills.generated.ts` 体积较大，包含技能属性、分类、威力、描述和可学习精灵。
- `src/data/generated/builds.generated.ts` 包含推荐个体字段，目前常见配招数组为空。
- `src/data/natures.ts` 自动生成性格列表：中性性格 + 任一属性 `+20%`、另一属性 `-10%` 的组合。
- `src/data/typeChart.ts` 内置属性列表、别名和属性克制矩阵，并自动生成双属性防守组合。

## 数据导入与校验

数据脚本集中在 `scripts/`：

- `importSkillsFromBwiki.mjs`：调用 `https://wiki.biligame.com/rocom/api.php` 导入技能数据。
- `importSpiritsFromBwiki.mjs`：调用同一 BWIKI API 导入精灵资料，并结合已有技能数据建立关联。
- `importSpiritStatsFromXlsx.mjs`：读取 `documentory/精灵种族值.xlsx`，生成精灵基础种族值和推荐个体数据。
- `importWikiData.mjs`：探测候选数据源，不会稳定覆盖生成数据。
- `validateData.mjs`：校验生成数据的字段完整性、技能/精灵引用、推荐个体配置和属性克制覆盖情况，并生成 `data-import-report.md`。

线上构建不应自动访问外网或自动运行导入脚本。需要更新数据时，应在本地手动运行导入脚本，再运行校验、lint 和 build。

## 部署配置

`vercel.json` 固定了 Vercel 部署参数：

- Framework Preset：`vite`
- Install Command：`npm install`
- Build Command：`npm run build`
- Output Directory：`dist`

该项目是静态 Vite 应用，部署时不需要后端服务。

## 维护注意事项

- 当前仓库已有未提交修改：`src/App.tsx` 和 `src/App.css`。后续修改时不要误覆盖这些变更。
- 源码和数据包含大量中文内容，应统一按 UTF-8 处理。
- 终端中如果出现中文乱码，优先检查 shell 输出编码，不要直接判定文件内容损坏。
- `src/data/generated/` 是脚本产物，手动改动容易在下一次导入时被覆盖。
- 新增规则能力时，优先从 `src/types/battle.ts` 扩展规则类型，再同步更新 `effectRuleParser.ts`、`damageResolver.ts` 和 UI 控件展示。
- 新增伤害公式变量时，应让 `DamageInput` 保持显式字段，避免把隐含状态散落在组件里。
- 修改取整、属性克制、PVP 属性公式等基础规则后，应运行 `npm.cmd run validate:data` 和 `npm.cmd run build`。
- `documentory/` 中的原始资料是数据导入和规则校对的重要依据，不建议清理。

