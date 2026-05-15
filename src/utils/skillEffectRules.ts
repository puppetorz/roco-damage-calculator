import type {
  BattleEffect,
  DamageSkillCategory,
  EffectRule,
  Skill,
  StatKey,
} from "../types/battle";
import { normalizeElementName } from "./typeCalculator";

function normalizeElement(value: string): string {
  return normalizeElementName(value) ?? value.trim().replace(/系$/, "");
}

function buildHasElement(skills: Skill[], element: string, currentSkill: Skill): boolean {
  const normalized = normalizeElement(element);

  return skills.some((skill) => {
    return skill.id !== currentSkill.id && normalizeElement(skill.element) === normalized;
  });
}

export function isBattleEffectTriggered(
  effect: BattleEffect,
  currentSkill: Skill,
  buildSkills: Skill[]
): boolean {
  if (!effect.trigger) {
    return true;
  }

  if (effect.trigger.kind === "skillUse" || effect.trigger.kind === "onHit") {
    return true;
  }

  if (effect.trigger.kind === "carriedSkillElement") {
    return buildHasElement(buildSkills, effect.trigger.element, currentSkill);
  }

  return false;
}

function createRuleId(skill: Skill, effect: BattleEffect, suffix: string): string {
  const trigger = effect.trigger ? `${effect.trigger.kind}:${"element" in effect.trigger ? effect.trigger.element : ""}` : "always";

  return ["skillEffect", skill.id, effect.kind, trigger, suffix]
    .join(":")
    .replace(/\s+/g, "")
    .replace(/[^\w\u4e00-\u9fa5:+.%/-]+/g, "_");
}

function effectLabel(skill: Skill, effect: BattleEffect): string {
  const trigger =
    effect.trigger?.kind === "carriedSkillElement"
      ? `携带${effect.trigger.element}系技能`
      : "触发";

  return `${skill.name}：${trigger}，${effect.rawText}`;
}

function statRuleApplies(effect: BattleEffect, category: DamageSkillCategory): boolean {
  if (effect.kind !== "statModifier") {
    return false;
  }

  const relevant: StatKey[] =
    category === "physical" ? ["atk", "def"] : ["spa", "spd"];

  return effect.statKeys.some((key) => relevant.includes(key));
}

export function createSkillEffectRules(
  skill: Skill & { category: DamageSkillCategory },
  buildSkills: Skill[]
): EffectRule[] {
  const rules: EffectRule[] = [];

  for (const effect of skill.parsedEffects ?? []) {
    if (!effect.simulated || !isBattleEffectTriggered(effect, skill, buildSkills)) {
      continue;
    }

    if (effect.kind === "powerBonus") {
      rules.push({
        id: createRuleId(skill, effect, String(effect.amount)),
        sourceType: "skill",
        sourceName: skill.name,
        kind: "powerBonusToggle",
        label: effectLabel(skill, effect),
        description: effect.rawText,
        condition: "always",
        amount: effect.amount,
      });
      continue;
    }

    if (effect.kind === "powerMultiplier") {
      rules.push({
        id: createRuleId(skill, effect, String(effect.multiplier)),
        sourceType: "skill",
        sourceName: skill.name,
        kind: "powerMultiplierToggle",
        label: effectLabel(skill, effect),
        description: effect.rawText,
        condition: "always",
        multiplier: effect.multiplier,
      });
      continue;
    }

    if (effect.kind === "hitCountModifier") {
      rules.push({
        id: createRuleId(skill, effect, String(effect.amount)),
        sourceType: "skill",
        sourceName: skill.name,
        kind: "hitCountBonusToggle",
        label: effectLabel(skill, effect),
        description: effect.rawText,
        condition: "always",
        amount: effect.amount,
      });
      continue;
    }

    if (effect.kind === "statModifier" && statRuleApplies(effect, skill.category)) {
      rules.push({
        id: createRuleId(skill, effect, `${effect.target}:${effect.statKeys.join("_")}:${effect.rate}`),
        sourceType: "skill",
        sourceName: skill.name,
        kind: "statModifier",
        label: effectLabel(skill, effect),
        description: effect.rawText,
        condition: "always",
        target: effect.target === "opponent" ? "defender" : "attacker",
        statKeys: effect.statKeys,
        rate: effect.rate,
        stackable: false,
      });
    }
  }

  return rules;
}

export function collectTriggeredEffects(
  skill: Skill,
  buildSkills: Skill[]
): BattleEffect[] {
  return (skill.parsedEffects ?? []).filter((effect) =>
    isBattleEffectTriggered(effect, skill, buildSkills)
  );
}
