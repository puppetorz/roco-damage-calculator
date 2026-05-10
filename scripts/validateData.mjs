import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const reportPath = join(root, "data-import-report.md");

const requiredStats = ["hp", "atk", "spa", "def", "spd", "spe"];
const allowedCategories = new Set(["physical", "magical"]);
const allowedElements = new Set([
  "冰",
  "草",
  "虫",
  "地",
  "电",
  "毒",
  "恶",
  "光",
  "幻",
  "火",
  "机",
  "龙",
  "萌",
  "普",
  "水",
  "武",
  "翼",
  "幽",
]);

function extractConstExpression(source, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = ([\\s\\S]*?) satisfies`,
    "m"
  );
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`无法从生成文件中读取 ${exportName}`);
  }

  return Function(`"use strict"; return (${match[1]});`)();
}

function validateStats(spirit, errors) {
  for (const key of requiredStats) {
    const value = spirit.baseStats?.[key];

    if (!Number.isFinite(value)) {
      errors.push(`${spirit.id}: 缺少有效种族值 ${key}`);
    }
  }
}

function validateElements(spirit, errors, warnings) {
  if (!Array.isArray(spirit.elements)) {
    errors.push(`${spirit.id}: elements 必须是数组`);
    return;
  }

  if (spirit.elements.length < 1 || spirit.elements.length > 2) {
    errors.push(`${spirit.id}: 属性数量必须为 1 到 2 个`);
  }

  for (const element of spirit.elements) {
    if (!allowedElements.has(element)) {
      warnings.push(`${spirit.id}: 未知属性 ${element}`);
    }
  }
}

async function main() {
  const errors = [];
  const warnings = [];
  const spiritsSource = await readFile(
    join(generatedDir, "spirits.generated.ts"),
    "utf8"
  );
  const skillsSource = await readFile(
    join(generatedDir, "skills.generated.ts"),
    "utf8"
  );
  const buildsSource = await readFile(
    join(generatedDir, "builds.generated.ts"),
    "utf8"
  );

  const spirits = extractConstExpression(spiritsSource, "generatedSpirits");
  const skills = extractConstExpression(skillsSource, "generatedSkills");
  const builds = extractConstExpression(buildsSource, "generatedBuilds");
  const recommendedIndividualKeys = extractConstExpression(
    buildsSource,
    "generatedRecommendedIndividualKeys"
  );

  const spiritIds = new Set(spirits.map((spirit) => spirit.id));
  const skillIds = new Set(skills.map((skill) => skill.id));

  for (const spirit of spirits) {
    validateStats(spirit, errors);
    validateElements(spirit, errors, warnings);

    for (const skillId of spirit.commonSkillIds ?? []) {
      if (!skillIds.has(skillId)) {
        errors.push(`${spirit.id}: 常见技能不存在 ${skillId}`);
      }
    }
  }

  for (const skill of skills) {
    if (!allowedCategories.has(skill.category)) {
      errors.push(`${skill.id}: 技能类型无法识别 ${skill.category}`);
    }

    if (!Number.isFinite(skill.power)) {
      errors.push(`${skill.id}: 技能威力不是数字`);
    }

    if (!skill.stableDamage) {
      warnings.push(`${skill.id}: 不稳定技能不会自动进入确定伤害假设`);
    }
  }

  for (const build of builds) {
    if (!spiritIds.has(build.spiritId)) {
      errors.push(`${build.id}: 配招引用的精灵不存在 ${build.spiritId}`);
    }

    for (const skillId of build.skillIds) {
      if (!skillIds.has(skillId)) {
        errors.push(`${build.id}: 配招引用的技能不存在 ${skillId}`);
      }
    }
  }

  for (const [spiritId, keys] of Object.entries(recommendedIndividualKeys)) {
    if (!spiritIds.has(spiritId)) {
      errors.push(`推荐个体引用的精灵不存在 ${spiritId}`);
    }

    if (!Array.isArray(keys) || keys.length !== 3) {
      errors.push(`${spiritId}: 推荐个体必须正好 3 条`);
    }
  }

  const report = [
    "# 数据导入/校验报告",
    "",
    `- 精灵数量：${spirits.length}`,
    `- 技能数量：${skills.length}`,
    `- 常见配置数量：${builds.length}`,
    `- 推荐个体数量：${Object.keys(recommendedIndividualKeys).length}`,
    `- 校验状态：${errors.length === 0 ? "通过" : "失败"}`,
    "",
    "## 错误",
    errors.length === 0 ? "- 无" : errors.map((item) => `- ${item}`).join("\n"),
    "",
    "## 警告",
    warnings.length === 0
      ? "- 无"
      : warnings.map((item) => `- ${item}`).join("\n"),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");

  if (errors.length > 0) {
    console.error(`数据校验失败，详见 ${reportPath}`);
    process.exit(1);
  }

  console.log(`数据校验通过，详见 ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
