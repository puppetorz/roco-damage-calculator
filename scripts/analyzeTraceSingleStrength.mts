import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { recommendedIndividualKeys } from "../src/data/builds";
import { skills } from "../src/data/skills";
import { spirits } from "../src/data/spirits";
import type {
  BattleStats,
  EffectCondition,
  EffectRule,
  IndividualValues,
  Nature,
  Skill,
  Spirit,
  StatKey,
} from "../src/types/battle";
import {
  calculatePvpStats,
  createIndividualValuesFromKeys,
} from "../src/utils/statCalculator";
import { getConditionLabel, parseTraitRules } from "../src/utils/effectRuleParser";

type TraceTier = "首选" | "可用" | "偏娱乐/高波动";

type SkillPoolSummary = {
  poolSize: number;
  damageSkillCount: number;
  damageSkillRate: number;
  lowValueCount: number;
  lowValueRate: number;
  averagePower: number;
  maxPower: number;
  elementBreadth: number;
  averageEnergyCost: number;
  averageDiscountValue: number;
  topDamageSkills: string[];
};

type TraitSummary = {
  names: string[];
  score: number;
  structuredScore: number;
  keywordScore: number;
  parsedRuleCount: number;
  notes: string[];
  highlights: string[];
};

type TraceCandidateScore = {
  rank: number;
  tier: TraceTier;
  spiritId: string;
  name: string;
  label: string;
  dexNo?: string;
  form?: string;
  stage?: string;
  sourceUrl?: string;
  elements: string[];
  individualKeys: StatKey[];
  actualStats: BattleStats;
  primaryAttack: number;
  bulk: number;
  skillPool: SkillPoolSummary;
  traits: TraitSummary;
  scoreBreakdown: {
    stats: number;
    randomPool: number;
    stability: number;
    energy: number;
    trait: number;
    total: number;
  };
  reasons: string[];
};

const TRACE_SKILL_NAME = "复写";
const LOW_POWER_CUTOFF = 80;
const FIRST_TIER_COUNT = 12;
const SECOND_TIER_COUNT = 60;
const REPORT_PATH = join(process.cwd(), "trace-single-strength-report.md");
const RESULT_PATH = join(process.cwd(), "trace-single-strength-result.json");

const neutralNature: Nature = {
  id: "neutral",
  name: "无性格修正",
  modifiers: {},
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, value / max));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "/").replaceAll("\n", " ");
}

function isDamageLikeSkill(skill: Skill): boolean {
  const hasDynamicPower = (skill.description ?? "").includes(
    "威力等于敌方精灵技能总能耗"
  );

  return (
    (skill.category === "physical" || skill.category === "magical") &&
    (skill.power > 0 || hasDynamicPower)
  );
}

function getPowerValue(skill: Skill): number {
  if (skill.power > 0) {
    return skill.power;
  }

  if ((skill.description ?? "").includes("威力等于敌方精灵技能总能耗")) {
    return 120;
  }

  return 0;
}

function getEnergyCost(skill: Skill): number {
  return Math.max(0, skill.energyCost ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createActualStats(spirit: Spirit): {
  individualKeys: StatKey[];
  individualValues: IndividualValues;
  actualStats: BattleStats;
} {
  const individualKeys = recommendedIndividualKeys[spirit.id] ?? ["hp", "atk", "spe"];
  const individualValues = createIndividualValuesFromKeys(individualKeys);

  return {
    individualKeys,
    individualValues,
    actualStats: calculatePvpStats(
      spirit.baseStats,
      individualValues,
      neutralNature
    ),
  };
}

function createSpiritLabel(spirit: Spirit): string {
  const details = [spirit.form, spirit.stage].filter(Boolean).join(" / ");

  if (details) {
    return `${spirit.name}（${details}，${spirit.id}）`;
  }

  return `${spirit.name}（${spirit.id}）`;
}

function analyzeSkillPool(pool: Skill[]): SkillPoolSummary {
  const damageSkills = pool.filter(isDamageLikeSkill);
  const damagePowerValues = damageSkills.map(getPowerValue);
  const lowValueSkills = pool.filter((skill) => {
    if (!isDamageLikeSkill(skill)) {
      return true;
    }

    return getPowerValue(skill) < LOW_POWER_CUTOFF;
  });
  const topDamageSkills = [...damageSkills]
    .sort((left, right) => {
      const powerDelta = getPowerValue(right) - getPowerValue(left);

      return powerDelta !== 0 ? powerDelta : left.name.localeCompare(right.name);
    })
    .slice(0, 5)
    .map((skill) => `${skill.name}${getPowerValue(skill)}`);

  return {
    poolSize: pool.length,
    damageSkillCount: damageSkills.length,
    damageSkillRate: pool.length > 0 ? damageSkills.length / pool.length : 0,
    lowValueCount: lowValueSkills.length,
    lowValueRate: pool.length > 0 ? lowValueSkills.length / pool.length : 1,
    averagePower: average(damagePowerValues),
    maxPower: Math.max(0, ...damagePowerValues),
    elementBreadth: new Set(damageSkills.map((skill) => skill.element)).size,
    averageEnergyCost: average(pool.map(getEnergyCost)),
    averageDiscountValue: average(
      pool.map((skill) => Math.min(2, getEnergyCost(skill)))
    ),
    topDamageSkills,
  };
}

function getConditionWeight(condition: EffectCondition): number {
  switch (condition) {
    case "always":
      return 1;
    case "typeAdvantage":
    case "beforeEnemy":
    case "afterEnemy":
    case "fieldActive":
      return 0.65;
    case "lowHp":
    case "enemySwitch":
      return 0.5;
    case "responseAttack":
    case "responseStatus":
    case "responseDefense":
      return 0.45;
    case "manual":
      return 0.35;
  }
}

function getStatRuleWeight(statKey: StatKey): number {
  switch (statKey) {
    case "atk":
    case "spa":
      return 14;
    case "spe":
      return 12;
    case "def":
    case "spd":
      return 8;
    case "hp":
      return 7;
  }
}

function getElementCoverageWeight(
  appliesToSkillElements: string[] | undefined,
  skillPool: SkillPoolSummary
): number {
  if (!appliesToSkillElements || appliesToSkillElements.length === 0) {
    return 1;
  }

  return clamp(appliesToSkillElements.length / Math.max(1, skillPool.elementBreadth), 0.15, 1);
}

function scoreStructuredTraitRule(rule: EffectRule, skillPool: SkillPoolSummary): number {
  switch (rule.kind) {
    case "statModifier": {
      const direction =
        rule.target === "attacker"
          ? rule.rate >= 0
            ? 1
            : -1
          : rule.rate <= 0
            ? 1
            : -1;
      const statScore = rule.statKeys.reduce(
        (sum, statKey) => sum + getStatRuleWeight(statKey),
        0
      );
      const stackWeight = rule.stackable ? 1.25 : 1;

      return (
        direction *
        Math.abs(rule.rate) *
        statScore *
        getConditionWeight(rule.condition) *
        stackWeight
      );
    }
    case "powerBonusToggle":
      return (
        ratio(rule.amount, 80) *
        9 *
        getConditionWeight(rule.condition) *
        getElementCoverageWeight(rule.appliesToSkillElements, skillPool)
      );
    case "powerBonusStack":
      return (
        ratio(rule.amountPerStack, 80) *
        7 *
        getConditionWeight(rule.condition) *
        getElementCoverageWeight(rule.appliesToSkillElements, skillPool)
      );
    case "powerMultiplierToggle":
      return (
        clamp(rule.multiplier - 1, -1, 2) *
        10 *
        getConditionWeight(rule.condition) *
        getElementCoverageWeight(rule.appliesToSkillElements, skillPool)
      );
    case "powerMultiplierStack":
      return (
        clamp(rule.ratePerStack, -1, 2) *
        8 *
        getConditionWeight(rule.condition) *
        getElementCoverageWeight(rule.appliesToSkillElements, skillPool)
      );
    case "hitCountBonusToggle":
      return rule.amount * 4 * getConditionWeight(rule.condition);
    case "hitCountBonusStack":
      return rule.amountPerStack * 3 * getConditionWeight(rule.condition);
    case "hitCountMultiplier":
      return (rule.multiplier - 1) * 7 * getConditionWeight(rule.condition);
    case "hitCountOverride":
      return Math.max(0, rule.hitCount - 1) * 3 * getConditionWeight(rule.condition);
    case "hitCountBase":
      return Math.max(0, rule.hitCount - 1) * 3;
    case "hitCountPerUse":
      return rule.amount * 2.5;
    case "powerBonusPerUse":
      return ratio(rule.amount, 80) * 5;
    case "powerFromEnemyCost":
      return clamp(rule.multiplier, 0, 4) * 1.5;
    case "note":
      return 0;
  }
}

function scoreTraitKeywords(description: string): number {
  let score = 0;

  if (/额外获得.*随机技能|未携带的随机技能/.test(description)) {
    score += 6;
  }

  if (/能耗-\d|能耗降低|减少.*能耗/.test(description)) {
    score += 4;
  }

  if (/回复|治疗|吸血/.test(description)) {
    score += 3.5;
  }

  if (/减伤|受到.*伤害.*降低|免疫/.test(description)) {
    score += 3.5;
  }

  if (/冻结|灼烧|中毒|眩晕|印记|打断/.test(description)) {
    score += 2.5;
  }

  if (/天气|场地|驱散|净化/.test(description)) {
    score += 2;
  }

  if (/击败敌方精灵|敌方.*损失.*魔力/.test(description)) {
    score += 1.5;
  }

  if (/自己额外损失|自己.*损失.*魔力/.test(description)) {
    score -= 2;
  }

  return score;
}

function describeStructuredTraitRule(rule: EffectRule): string | undefined {
  if (rule.kind === "note") {
    return undefined;
  }

  if ("condition" in rule) {
    return `${rule.label}（${getConditionLabel(rule.condition)}）`;
  }

  return rule.label;
}

function analyzeTraits(spirit: Spirit, skillPool: SkillPoolSummary): TraitSummary {
  const traits = spirit.traits ?? [];
  const parsedRules = traits.flatMap(parseTraitRules);
  const structuredScore = parsedRules.reduce(
    (sum, rule) => sum + scoreStructuredTraitRule(rule, skillPool),
    0
  );
  const keywordScore = traits.reduce(
    (sum, trait) => sum + scoreTraitKeywords(trait.description ?? ""),
    0
  );
  const notes = parsedRules
    .filter((rule) => rule.kind === "note")
    .map((rule) => `${rule.sourceName}：${rule.description}`);
  const structuredHighlights = parsedRules
    .map(describeStructuredTraitRule)
    .filter((item): item is string => Boolean(item));
  const keywordHighlights = traits
    .filter((trait) => scoreTraitKeywords(trait.description ?? "") !== 0)
    .map((trait) => `${trait.name}：${trait.description ?? ""}`);
  const highlights = unique([...keywordHighlights, ...structuredHighlights]).slice(0, 5);

  return {
    names: traits.map((trait) => trait.name),
    score: round(clamp(structuredScore + keywordScore, -8, 18)),
    structuredScore: round(structuredScore),
    keywordScore: round(keywordScore),
    parsedRuleCount: parsedRules.length,
    notes,
    highlights,
  };
}

function scoreCandidate(
  skillPool: SkillPoolSummary,
  actualStats: BattleStats,
  traits: TraitSummary
): TraceCandidateScore["scoreBreakdown"] {
  const primaryAttack = Math.max(actualStats.atk, actualStats.spa);
  const bulk = actualStats.hp + actualStats.def + actualStats.spd;
  const statsScore =
    ratio(actualStats.hp, 500) * 12 +
    ratio(primaryAttack, 320) * 16 +
    ratio(actualStats.spe, 260) * 14 +
    ratio(bulk, 850) * 14;
  const randomPoolScore =
    skillPool.damageSkillRate * 20 +
    ratio(skillPool.averagePower, 200) * 18 +
    ratio(skillPool.maxPower, 240) * 10 +
    ratio(skillPool.elementBreadth, 18) * 14 +
    ratio(skillPool.damageSkillCount, 40) * 8;
  const stabilityScore = (1 - skillPool.lowValueRate) * 22;
  const energyScore =
    ratio(skillPool.averageEnergyCost, 8) * 10 +
    ratio(skillPool.averageDiscountValue, 2) * 6;
  const traitScore = traits.score;
  const total =
    statsScore + randomPoolScore + stabilityScore + energyScore + traitScore;

  return {
    stats: round(statsScore),
    randomPool: round(randomPoolScore),
    stability: round(stabilityScore),
    energy: round(energyScore),
    trait: round(traitScore),
    total: round(total),
  };
}

function createReasons(candidate: Omit<TraceCandidateScore, "rank" | "tier">): string[] {
  const reasons: string[] = [];
  const stats = candidate.actualStats;
  const pool = candidate.skillPool;

  reasons.push(
    `面板 ${stats.hp}/${candidate.primaryAttack}/${stats.spe}，厚度 ${candidate.bulk}`
  );
  reasons.push(
    `随机池 ${pool.poolSize} 招，伤害招 ${pool.damageSkillCount} 招（${percent(
      pool.damageSkillRate
    )}）`
  );

  if (pool.elementBreadth >= 14) {
    reasons.push(`属性覆盖 ${pool.elementBreadth} 系`);
  }

  if (pool.maxPower >= 200) {
    reasons.push(`最高威力 ${pool.maxPower}`);
  }

  if (pool.averageEnergyCost >= 4) {
    reasons.push(`平均能耗 ${pool.averageEnergyCost.toFixed(1)}，复写减费收益高`);
  }

  if (pool.lowValueRate >= 0.45) {
    reasons.push(`低价值/高波动池占 ${percent(pool.lowValueRate)}`);
  }

  if (candidate.traits.names.length > 0) {
    const traitLabel = candidate.traits.highlights[0] ?? candidate.traits.names.join("、");
    reasons.push(`特性 ${traitLabel}，估值 ${candidate.traits.score.toFixed(1)}`);
  }

  return reasons;
}

function getTier(rank: number): TraceTier {
  if (rank <= FIRST_TIER_COUNT) {
    return "首选";
  }

  if (rank <= SECOND_TIER_COUNT) {
    return "可用";
  }

  return "偏娱乐/高波动";
}

function createCandidateRows(traceSkill: Skill): TraceCandidateScore[] {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const candidates = spirits.filter((spirit) =>
    (spirit.learnableSkillIds ?? []).includes(traceSkill.id)
  );

  assert(candidates.length > 0, "没有找到可学习复写的精灵。");

  const scored = candidates.map((spirit) => {
    assert(
      (spirit.learnableSkillIds ?? []).includes(traceSkill.id),
      `${spirit.name} 不满足可学习复写的候选条件。`
    );

    const poolIds = unique(spirit.learnableSkillIds ?? []).filter(
      (skillId) => skillId !== traceSkill.id
    );
    const pool = poolIds.map((skillId) => skillById.get(skillId)).filter(Boolean);

    assert(
      pool.length === poolIds.length,
      `${spirit.name} 的随机池存在无法解析的技能 ID。`
    );
    assert(
      pool.every((skill) => skill.id !== traceSkill.id),
      `${spirit.name} 的随机池错误包含复写。`
    );

    const { individualKeys, actualStats } = createActualStats(spirit);
    const skillPool = analyzeSkillPool(pool);
    const traits = analyzeTraits(spirit, skillPool);
    const primaryAttack = Math.max(actualStats.atk, actualStats.spa);
    const bulk = actualStats.hp + actualStats.def + actualStats.spd;
    const baseCandidate = {
      spiritId: spirit.id,
      name: spirit.name,
      label: createSpiritLabel(spirit),
      dexNo: spirit.dexNo,
      form: spirit.form,
      stage: spirit.stage,
      sourceUrl: spirit.sourceUrl,
      elements: spirit.elements,
      individualKeys,
      actualStats,
      primaryAttack,
      bulk,
      skillPool,
      traits,
      scoreBreakdown: scoreCandidate(skillPool, actualStats, traits),
    };

    return {
      ...baseCandidate,
      reasons: createReasons(baseCandidate),
    };
  });

  return scored
    .sort((left, right) => {
      const scoreDelta = right.scoreBreakdown.total - left.scoreBreakdown.total;

      return scoreDelta !== 0 ? scoreDelta : left.spiritId.localeCompare(right.spiritId);
    })
    .map((candidate, index) => ({
      rank: index + 1,
      tier: getTier(index + 1),
      ...candidate,
    }));
}

function createReport(
  generatedAt: string,
  traceSkill: Skill,
  candidates: TraceCandidateScore[]
): string {
  const tierCounts = candidates.reduce<Record<TraceTier, number>>(
    (counts, candidate) => {
      counts[candidate.tier] += 1;
      return counts;
    },
    {
      首选: 0,
      可用: 0,
      "偏娱乐/高波动": 0,
    }
  );
  const topRows = candidates.slice(0, SECOND_TIER_COUNT);
  const uniqueByName = [...candidates]
    .sort((left, right) => {
      const scoreDelta = right.scoreBreakdown.total - left.scoreBreakdown.total;

      return scoreDelta !== 0 ? scoreDelta : left.spiritId.localeCompare(right.spiritId);
    })
    .filter((candidate, index, allCandidates) => {
      return allCandidates.findIndex((item) => item.name === candidate.name) === index;
    })
    .slice(0, 20);

  return [
    "# 复写单只强度筛选报告",
    "",
    `- 生成时间：${generatedAt}`,
    `- 技能：${traceSkill.name}（${traceSkill.id}）`,
    `- 技能效果：${traceSkill.description ?? "无描述"}`,
    `- 候选数量：${candidates.length}`,
    `- 分档：首选 ${tierCounts["首选"]} 只，可用 ${tierCounts["可用"]} 只，偏娱乐/高波动 ${tierCounts["偏娱乐/高波动"]} 只`,
    "",
    "## 评分口径",
    "",
    "- 候选必须能学习复写。",
    "- 随机池为该精灵全部可学技能中排除复写本身。",
    "- 面板使用推荐个体配置和无性格修正，便于横向比较。",
    "- 非伤害技能在静态排名中保守计入低价值/高波动池；动态威力技能按 120 威力近似。",
    "- 特性分优先使用结构化规则估值，无法结构化的回复、减伤、异常、额外随机技能等机制按关键词保守加分。",
    "- 综合分 = 基础战斗力 + 随机池质量 + 稳定性 + 复写减费收益 + 特性估值。",
    "",
    "## 校验结果",
    "",
    "- 复写技能已唯一识别。",
    "- 所有候选精灵均可学习复写。",
    "- 所有随机池均已排除复写本身。",
    "- 技能 ID 均能在当前生成技能数据中解析。",
    "",
    "## 同名去重推荐（前 20）",
    "",
    "| 去重排名 | 原排名 | 分档 | 精灵 | 属性 | 总分 | 特性分 | 关键理由 |",
    "| ---: | ---: | --- | --- | --- | ---: | ---: | --- |",
    ...uniqueByName.map((candidate, index) =>
      `| ${index + 1} | ${candidate.rank} | ${candidate.tier} | ${markdownCell(
        candidate.label
      )} | ${candidate.elements.join("/")} | ${candidate.scoreBreakdown.total.toFixed(
        1
      )} | ${candidate.scoreBreakdown.trait.toFixed(1)} | ${markdownCell(
        candidate.reasons.join("；")
      )} |`
    ),
    "",
    "## 推荐排名（前 60）",
    "",
    "| 排名 | 分档 | 精灵 | 属性 | 总分 | 面板分 | 随机池分 | 稳定分 | 减费分 | 特性分 | 伤害招 | 低价值/高波动 | 代表高威力技能 | 推荐理由 |",
    "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...topRows.map((candidate) =>
      `| ${[
        candidate.rank,
        candidate.tier,
        markdownCell(candidate.label),
        candidate.elements.join("/"),
        candidate.scoreBreakdown.total.toFixed(1),
        candidate.scoreBreakdown.stats.toFixed(1),
        candidate.scoreBreakdown.randomPool.toFixed(1),
        candidate.scoreBreakdown.stability.toFixed(1),
        candidate.scoreBreakdown.energy.toFixed(1),
        candidate.scoreBreakdown.trait.toFixed(1),
        `${candidate.skillPool.damageSkillCount}/${candidate.skillPool.poolSize}`,
        percent(candidate.skillPool.lowValueRate),
        markdownCell(candidate.skillPool.topDamageSkills.join("、")),
        markdownCell(candidate.reasons.join("；")),
      ].join(" | ")} |`
    ),
    "",
    `完整 ${candidates.length} 只候选的结构化排名见 \`trace-single-strength-result.json\`。`,
    ""
  ].join("\n");
}

async function main(): Promise<void> {
  const traceSkills = skills.filter((skill) => skill.name === TRACE_SKILL_NAME);

  assert(traceSkills.length === 1, `复写技能应唯一，实际找到 ${traceSkills.length} 个。`);

  const [traceSkill] = traceSkills;

  assert(
    (traceSkill.description ?? "").includes("随机变成自己未携带的技能") &&
      (traceSkill.description ?? "").includes("能耗-2"),
    "复写技能描述不符合预期。"
  );

  const generatedAt = new Date().toISOString();
  const candidates = createCandidateRows(traceSkill);
  const result = {
    generatedAt,
    traceSkill: {
      id: traceSkill.id,
      name: traceSkill.name,
      description: traceSkill.description,
      sourceUrl: traceSkill.sourceUrl,
    },
    assumptions: {
      scope: "单只精灵强度，不组六只阵容",
      randomPool: "全部可学技能 - 复写",
      stats: "推荐个体配置 + 无性格修正",
      method: "静态评分，不使用当前未完整模拟复写的自博弈结果",
    },
    tiers: {
      firstTierCount: FIRST_TIER_COUNT,
      secondTierCount: SECOND_TIER_COUNT,
    },
    candidates,
  };

  await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(
    REPORT_PATH,
    createReport(generatedAt, traceSkill, candidates),
    "utf8"
  );

  console.log(`已生成 ${REPORT_PATH}`);
  console.log(`已生成 ${RESULT_PATH}`);
  console.log(
    candidates
      .slice(0, 10)
      .map(
        (candidate) =>
          `${candidate.rank}. ${candidate.name} ${candidate.scoreBreakdown.total.toFixed(
            1
          )} (${candidate.tier})`
      )
      .join("\n")
  );
}

await main();
