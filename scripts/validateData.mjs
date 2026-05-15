import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const reportPath = join(root, "data-import-report.md");

const requiredStats = ["hp", "atk", "spa", "def", "spd", "spe"];
const statKeys = new Set(requiredStats);
const allowedCategories = new Set(["physical", "magical", "status", "defense"]);
const knownElements = new Set([
  "草",
  "火",
  "水",
  "光",
  "土",
  "冰",
  "龙",
  "电",
  "毒",
  "虫",
  "武",
  "翼",
  "萌",
  "幽",
  "恶",
  "普通",
  "幻",
  "机械",
]);
const elementAliases = new Map([
  ["普", "普通"],
  ["普通", "普通"],
  ["普通系", "普通"],
  ["机", "机械"],
  ["机械", "机械"],
  ["机械系", "机械"],
  ["恶魔", "恶"],
  ["恶魔系", "恶"],
  ["幽灵", "幽"],
  ["幽灵系", "幽"],
  ["地", "土"],
  ["地系", "土"],
]);

function extractConstExpression(source, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = ([\\s\\S]*?) satisfies [^;]+;`,
    "m"
  );
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`无法从生成文件中读取 ${exportName}`);
  }

  return JSON.parse(match[1]);
}

function normalizeElement(value) {
  const cleaned = String(value ?? "").trim().replace(/系$/, "");
  return elementAliases.get(cleaned) ?? cleaned;
}

function createDefenseKey(elements) {
  return elements.map(normalizeElement).join("/");
}

function validateStats(spirit, errors) {
  for (const key of requiredStats) {
    const value = spirit.baseStats?.[key];

    if (!Number.isFinite(value) || value <= 0) {
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
    const normalized = normalizeElement(element);

    if (!knownElements.has(normalized)) {
      warnings.push(`${spirit.id}: 未知属性 ${element}`);
    }
  }
}

function collectMissingTypeChartEntries(skills, spirits) {
  const attackElements = new Set(
    skills.map((skill) => normalizeElement(skill.element)).filter(Boolean)
  );
  const defenseKeys = new Set(spirits.map((spirit) => createDefenseKey(spirit.elements)));
  const missing = [];

  for (const attackElement of attackElements) {
    if (!knownElements.has(attackElement)) {
      missing.push(`未知技能属性 ${attackElement}`);
      continue;
    }

    for (const defenseKey of defenseKeys) {
      const defenders = defenseKey.split("/");
      const hasUnknownDefender = defenders.some(
        (element) => !knownElements.has(element)
      );

      if (hasUnknownDefender) {
        missing.push(`${attackElement} -> ${defenseKey}`);
      }
    }
  }

  return missing;
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
  const pvpLineupsSource = await readFile(
    join(generatedDir, "pvpLineups.generated.ts"),
    "utf8"
  );

  const spirits = extractConstExpression(spiritsSource, "generatedSpirits");
  const skills = extractConstExpression(skillsSource, "generatedSkills");
  const builds = extractConstExpression(buildsSource, "generatedBuilds");
  const pvpLineups = extractConstExpression(
    pvpLineupsSource,
    "generatedPvpLineups"
  );
  const recommendedIndividualKeys = extractConstExpression(
    buildsSource,
    "generatedRecommendedIndividualKeys"
  );

  const spiritIds = new Set(spirits.map((spirit) => spirit.id));
  const skillIds = new Set(skills.map((skill) => skill.id));

  for (const spirit of spirits) {
    validateStats(spirit, errors);
    validateElements(spirit, errors, warnings);

    if (!spirit.sourceUrl) {
      errors.push(`${spirit.id}: 缺少 sourceUrl`);
    }

    if ((spirit.traits?.length ?? 0) === 0) {
      warnings.push(`${spirit.id}: 无特性数据`);
    }

    for (const name of spirit.unresolvedSkillNames ?? []) {
      warnings.push(`${spirit.id}: 未匹配技能 ${name}`);
    }

    for (const skillId of spirit.commonSkillIds ?? []) {
      if (!skillIds.has(skillId)) {
        errors.push(`${spirit.id}: 常见技能不存在 ${skillId}`);
      }
    }

    for (const skillId of spirit.learnableSkillIds ?? []) {
      if (!skillIds.has(skillId)) {
        errors.push(`${spirit.id}: 可学技能不存在 ${skillId}`);
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

    for (const spiritId of skill.learnableSpiritIds ?? []) {
      if (!spiritIds.has(spiritId)) {
        errors.push(`${skill.id}: 可学精灵不存在 ${spiritId}`);
      }
    }

    for (const effect of skill.parsedEffects ?? []) {
      if (!effect.kind || !effect.rawText) {
        errors.push(`${skill.id}: 技能效果缺少 kind/rawText`);
      }

      if (effect.trigger?.kind === "carriedSkillElement") {
        const element = normalizeElement(effect.trigger.element);
        if (!knownElements.has(element)) {
          warnings.push(`${skill.id}: 携带技能触发未知属性 ${effect.trigger.element}`);
        }
      }
    }
  }

  const refraction = skills.find((skill) => skill.name === "折射");
  if (!refraction) {
    errors.push("缺少技能：折射");
  } else {
    const refractionElements = new Set(
      (refraction.parsedEffects ?? [])
        .map((effect) =>
          effect.trigger?.kind === "carriedSkillElement"
            ? normalizeElement(effect.trigger.element)
            : undefined
        )
        .filter(Boolean)
    );
    for (const element of ["土", "普通", "机械", "草", "火", "冰", "毒", "虫", "龙", "翼", "水", "武", "光", "幻", "幽", "恶", "电", "萌"]) {
      if (!refractionElements.has(element)) {
        errors.push(`折射缺少 ${element}系携带触发效果`);
      }
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

  for (const lineup of pvpLineups) {
    if (!lineup.id || !lineup.title) {
      errors.push(`PVP 阵容缺少 id/title: ${JSON.stringify(lineup).slice(0, 120)}`);
    }

    if (!Array.isArray(lineup.members) || lineup.members.length !== 6) {
      errors.push(`${lineup.id}: PVP 阵容成员必须为 6 个`);
      continue;
    }

    for (const member of lineup.members) {
      if (member.spiritId && !spiritIds.has(member.spiritId)) {
        errors.push(`${lineup.id}: 阵容精灵不存在 ${member.spiritId}`);
      }

      if (!member.spiritId && member.spiritName) {
        warnings.push(`${lineup.id}: 未匹配阵容精灵 ${member.spiritName}`);
      }

      for (const skillId of member.skillIds ?? []) {
        if (!skillIds.has(skillId)) {
          errors.push(`${lineup.id}: 阵容技能不存在 ${skillId}`);
        }
      }

      for (const skillName of member.unresolvedSkillNames ?? []) {
        warnings.push(`${lineup.id}: 未匹配阵容技能 ${skillName}`);
      }
    }
  }

  for (const [spiritId, keys] of Object.entries(recommendedIndividualKeys)) {
    if (!spiritIds.has(spiritId)) {
      errors.push(`推荐个体引用的精灵不存在 ${spiritId}`);
    }

    if (!Array.isArray(keys) || keys.length !== 3) {
      errors.push(`${spiritId}: 推荐个体必须正好 3 条`);
      continue;
    }

    for (const key of keys) {
      if (!statKeys.has(key)) {
        errors.push(`${spiritId}: 推荐个体字段无效 ${key}`);
      }
    }
  }

  const missingTypeChartEntries = collectMissingTypeChartEntries(skills, spirits);
  for (const entry of missingTypeChartEntries) {
    warnings.push(`克制表缺失：${entry}`);
  }

  const linkedSpiritCount = spirits.filter(
    (spirit) => (spirit.learnableSkillIds?.length ?? 0) > 0
  ).length;
  const defenseTypeCount = new Set(
    spirits.map((spirit) => createDefenseKey(spirit.elements))
  ).size;
  const report = [
    "# 数据导入/校验报告",
    "",
    `- 精灵数量：${spirits.length}`,
    `- 技能数量：${skills.length}`,
    `- 常见配置数量：${builds.length}`,
    `- PVP 阵容数量：${pvpLineups.length}`,
    `- 推荐个体数量：${Object.keys(recommendedIndividualKeys).length}`,
    `- 已匹配可学技能的精灵：${linkedSpiritCount}`,
    `- 防守属性组合数量：${defenseTypeCount}`,
    `- 克制表缺失数量：${missingTypeChartEntries.length}`,
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
