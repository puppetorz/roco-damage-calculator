import { recommendedIndividualKeys } from "../data/builds";
import { natures } from "../data/natures";
import { skills } from "../data/skills";
import type {
  CombatantBuild,
  DamageSkill,
  IndividualValues,
  Nature,
  Skill,
  Spirit,
} from "../types/battle";
import { parseTraitRules } from "./effectRuleParser";
import {
  calculatePvpStats,
  createIndividualValuesFromKeys,
} from "./statCalculator";

const skillMap = new Map(skills.map((skill) => [skill.id, skill]));

export function getRecommendedIvs(spiritId: string): IndividualValues {
  return createIndividualValuesFromKeys(
    recommendedIndividualKeys[spiritId] ?? ["hp", "atk", "spe"]
  );
}

export function isDamageSkill(skill: Skill): skill is DamageSkill {
  const hasDynamicPower = (skill.description ?? "").includes(
    "威力等于敌方精灵技能总能耗"
  );

  return (
    (skill.category === "physical" || skill.category === "magical") &&
    (skill.power > 0 || hasDynamicPower)
  );
}

export function getAllSkillsForSpirit(spirit: Spirit): Skill[] {
  const commonSkillIds = spirit.commonSkillIds ?? [];
  const learnableSkillIds = spirit.learnableSkillIds ?? [];
  const skillIds = commonSkillIds.length > 0 ? commonSkillIds : learnableSkillIds;

  return skillIds
    .map((skillId) => skillMap.get(skillId))
    .filter((skill): skill is Skill => Boolean(skill));
}

export function getDamageSkillsForSpirit(spirit: Spirit): DamageSkill[] {
  return getAllSkillsForSpirit(spirit).filter(isDamageSkill);
}

export function getDefaultSkillForSpirit(spirit: Spirit): DamageSkill | undefined {
  return getDamageSkillsForSpirit(spirit)[0];
}

export function getStabMultiplier(attacker: Spirit, skill?: Skill): number {
  if (!skill) {
    return 1;
  }

  return attacker.elements.includes(skill.element) ? 1.25 : 1;
}

export function getTraitRules(spirit: Spirit) {
  return (spirit.traits ?? []).flatMap(parseTraitRules);
}

export function createCombatantBuild(
  spirit: Spirit,
  options: {
    natureId?: string;
    nature?: Nature;
    individualValues?: IndividualValues;
    skillIds?: string[];
  } = {}
): CombatantBuild | undefined {
  const selectedNature =
    options.nature ??
    natures.find((nature) => nature.id === options.natureId) ??
    natures[0];
  const individualValues = options.individualValues ?? getRecommendedIvs(spirit.id);
  const requestedSkillIds = options.skillIds ?? [];
  const availableSkills = getAllSkillsForSpirit(spirit);
  const availableDamageSkills = availableSkills.filter(isDamageSkill);
  const requestedSkills = requestedSkillIds
    .map((skillId) => skillMap.get(skillId))
    .filter((skill): skill is Skill => Boolean(skill));
  const requestedDamageSkills = requestedSkills.filter(isDamageSkill);
  const damageSkills =
    requestedDamageSkills.length > 0 ? requestedDamageSkills : availableDamageSkills;
  const allSkills = requestedSkills.length > 0 ? requestedSkills : availableSkills;

  if (damageSkills.length === 0) {
    return undefined;
  }

  return {
    spirit,
    nature: selectedNature,
    individualValues,
    skills: damageSkills,
    allSkills,
    actualStats: calculatePvpStats(
      spirit.baseStats,
      individualValues,
      selectedNature
    ),
  };
}
