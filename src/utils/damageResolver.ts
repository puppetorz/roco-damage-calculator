import type {
  BattleModifierState,
  BattleStats,
  DamageInput,
  DamageSkillCategory,
  EffectCondition,
  EffectRule,
  Skill,
  StatKey,
  StatModifierValues,
} from "../types/battle";
import { normalizeElementName } from "./typeCalculator";

const WEATHER_MULTIPLIER = 1;
const DAMAGE_REDUCTIONS: number[] = [];

const emptyStatModifiers: StatModifierValues = {
  hp: 0,
  atk: 0,
  spa: 0,
  def: 0,
  spd: 0,
  spe: 0,
};

export type ResolvedDamageInput = {
  input: DamageInput;
  hitCount: number;
  skillPower: number;
  powerBonus: number;
  powerBuffMultiplier: number;
  attackerModifiers: StatModifierValues;
  defenderModifiers: StatModifierValues;
  summaries: string[];
  notes: string[];
};

export type ResolveDamageInputParams = {
  skill: Skill & { category: DamageSkillCategory };
  attackerStats: BattleStats;
  defenderStats: BattleStats;
  stabMultiplier: number;
  typeMultiplier: number;
  state: BattleModifierState;
  rules: EffectRule[];
};

function cloneEmptyModifiers(): StatModifierValues {
  return { ...emptyStatModifiers };
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function getRuleStack(ruleId: string, state: BattleModifierState): number {
  return Math.max(0, Math.round(state.ruleStacks[ruleId] ?? 0));
}

function isRuleActive(rule: EffectRule, state: BattleModifierState): boolean {
  if (!("condition" in rule)) {
    return true;
  }

  if (rule.condition === "always") {
    return true;
  }

  if (
    (rule.kind === "statModifier" && rule.stackable) ||
    rule.kind === "hitCountBonusStack" ||
    rule.kind === "powerBonusStack" ||
    rule.kind === "powerMultiplierStack"
  ) {
    return getRuleStack(rule.id, state) > 0;
  }

  return Boolean(state.ruleEnabled[rule.id]);
}

function addSummary(summaries: string[], text: string): void {
  if (!summaries.includes(text)) {
    summaries.push(text);
  }
}

function normalizeSkillElement(value: string): string {
  return normalizeElementName(value) ?? value.trim().replace(/系$/, "");
}

function powerRuleAppliesToSkill(
  rule: {
    sourceName: string;
    label: string;
    appliesToSkillElements?: string[];
  },
  skill: Skill,
  notes: string[]
): boolean {
  const allowedElements = rule.appliesToSkillElements;
  if (!allowedElements || allowedElements.length === 0) {
    return true;
  }

  const currentElement = normalizeSkillElement(skill.element);
  const normalizedAllowed = allowedElements.map(normalizeSkillElement);

  if (normalizedAllowed.includes(currentElement)) {
    return true;
  }

  addSummary(
    notes,
    `${rule.sourceName}：当前技能属性为 ${skill.element}，不属于 ${allowedElements.join("/")}，${rule.label} 未计入。`
  );
  return false;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function statLabel(key: StatKey): string {
  const labels: Record<StatKey, string> = {
    hp: "生命",
    atk: "物攻",
    spa: "魔攻",
    def: "物防",
    spd: "魔防",
    spe: "速度",
  };

  return labels[key];
}

function conditionLabel(condition: EffectCondition): string {
  const labels: Record<EffectCondition, string> = {
    always: "默认",
    manual: "手动确认",
    responseAttack: "应对攻击/应对成功",
    responseStatus: "应对状态",
    responseDefense: "应对防御",
    typeAdvantage: "克制触发",
    beforeEnemy: "先于敌方攻击",
    afterEnemy: "后手攻击",
    enemySwitch: "敌方本回合更换精灵",
    lowHp: "生命低于 50%",
    fieldActive: "在场时",
  };

  return labels[condition];
}

function getAttackStage(
  category: DamageSkillCategory,
  attackerModifiers: StatModifierValues
): { up: number; down: number } {
  const value = category === "physical" ? attackerModifiers.atk : attackerModifiers.spa;
  return value >= 0 ? { up: value, down: 0 } : { up: 0, down: Math.abs(value) };
}

function getDefenseStage(
  category: DamageSkillCategory,
  defenderModifiers: StatModifierValues
): { up: number; down: number } {
  const value = category === "physical" ? defenderModifiers.def : defenderModifiers.spd;
  return value >= 0 ? { up: value, down: 0 } : { up: 0, down: Math.abs(value) };
}

function mergeManualModifiers(
  target: StatModifierValues,
  manual: StatModifierValues,
  summaries: string[],
  label: string
): void {
  for (const key of Object.keys(target) as StatKey[]) {
    const value = Number(manual[key]) || 0;
    target[key] += value;
    if (value !== 0) {
      addSummary(summaries, `${label}${statLabel(key)} ${formatPercent(value)}`);
    }
  }
}

function applyStatRule(
  rule: Extract<EffectRule, { kind: "statModifier" }>,
  state: BattleModifierState,
  attackerModifiers: StatModifierValues,
  defenderModifiers: StatModifierValues,
  summaries: string[]
): void {
  const stacks = rule.stackable ? getRuleStack(rule.id, state) : 1;
  const value = rule.rate * stacks;
  const target = rule.target === "attacker" ? attackerModifiers : defenderModifiers;

  for (const key of rule.statKeys) {
    target[key] += value;
  }

  addSummary(
    summaries,
    `${rule.sourceName}：${rule.target === "attacker" ? "自己" : "敌方"}${rule.statKeys
      .map(statLabel)
      .join("/")} ${formatPercent(value)}`
  );
}

export function createDefaultBattleModifierState(): BattleModifierState {
  return {
    ruleEnabled: {},
    ruleStacks: {},
    skillUseCount: 0,
    enemyTotalSkillCost: 0,
    manualAttacker: cloneEmptyModifiers(),
    manualDefender: cloneEmptyModifiers(),
  };
}

export function resolveDamageInput({
  skill,
  attackerStats,
  defenderStats,
  stabMultiplier,
  typeMultiplier,
  state,
  rules,
}: ResolveDamageInputParams): ResolvedDamageInput {
  let hitCount = skill.defaultHitCount ?? 1;
  let skillPower = skill.power;
  let powerBonus = skill.defaultPowerBonus ?? 0;
  let powerBuffMultiplier = skill.defaultPowerBuffMultiplier ?? 1;
  const attackerModifiers = cloneEmptyModifiers();
  const defenderModifiers = cloneEmptyModifiers();
  const summaries: string[] = [];
  const notes: string[] = [];

  for (const rule of rules) {
    if (rule.kind === "note") {
      notes.push(rule.description);
      continue;
    }

    if (rule.kind === "hitCountBase") {
      hitCount = Math.max(hitCount, rule.hitCount);
      addSummary(summaries, rule.label);
      continue;
    }

    if (rule.kind === "hitCountPerUse") {
      const value = rule.amount * clampNonNegative(state.skillUseCount);
      hitCount += value;
      if (value > 0) {
        addSummary(summaries, `${rule.sourceName}：使用 ${state.skillUseCount} 次，连击 +${value}`);
      }
      continue;
    }

    if (rule.kind === "powerBonusPerUse") {
      const value = rule.amount * clampNonNegative(state.skillUseCount);
      powerBonus += value;
      if (value > 0) {
        addSummary(summaries, `${rule.sourceName}：使用 ${state.skillUseCount} 次，威力 +${value}`);
      }
      continue;
    }

    if (!isRuleActive(rule, state)) {
      continue;
    }

    switch (rule.kind) {
      case "hitCountBonusToggle":
        hitCount += rule.amount;
        addSummary(summaries, `${rule.sourceName}：${conditionLabel(rule.condition)}，连击 +${rule.amount}`);
        break;
      case "hitCountBonusStack": {
        const stacks = getRuleStack(rule.id, state);
        const value = rule.amountPerStack * stacks;
        hitCount += value;
        addSummary(summaries, `${rule.sourceName}：${rule.stackLabel} ${stacks}，连击 +${value}`);
        break;
      }
      case "hitCountMultiplier":
        hitCount *= rule.multiplier;
        addSummary(summaries, `${rule.sourceName}：${conditionLabel(rule.condition)}，连击 x${rule.multiplier}`);
        break;
      case "hitCountOverride":
        hitCount = rule.hitCount;
        addSummary(summaries, `${rule.sourceName}：${conditionLabel(rule.condition)}，连击变为 ${rule.hitCount}`);
        break;
      case "powerBonusToggle":
        if (!powerRuleAppliesToSkill(rule, skill, notes)) {
          break;
        }
        powerBonus += rule.amount;
        addSummary(summaries, `${rule.sourceName}：${conditionLabel(rule.condition)}，威力 +${rule.amount}`);
        break;
      case "powerBonusStack": {
        if (!powerRuleAppliesToSkill(rule, skill, notes)) {
          break;
        }
        const stacks = getRuleStack(rule.id, state);
        const value = rule.amountPerStack * stacks;
        powerBonus += value;
        addSummary(summaries, `${rule.sourceName}：${rule.stackLabel} ${stacks}，威力 +${value}`);
        break;
      }
      case "powerMultiplierToggle":
        if (!powerRuleAppliesToSkill(rule, skill, notes)) {
          break;
        }
        powerBuffMultiplier *= rule.multiplier;
        addSummary(summaries, `${rule.sourceName}：${conditionLabel(rule.condition)}，威力 x${rule.multiplier}`);
        break;
      case "powerMultiplierStack": {
        if (!powerRuleAppliesToSkill(rule, skill, notes)) {
          break;
        }
        const stacks = getRuleStack(rule.id, state);
        const multiplier = 1 + rule.ratePerStack * stacks;
        powerBuffMultiplier *= multiplier;
        addSummary(summaries, `${rule.sourceName}：${rule.stackLabel} ${stacks}，威力 ${formatPercent(rule.ratePerStack * stacks)}`);
        break;
      }
      case "powerFromEnemyCost":
        skillPower = clampNonNegative(state.enemyTotalSkillCost) * rule.multiplier;
        addSummary(summaries, `${rule.sourceName}：敌方技能总能耗 ${state.enemyTotalSkillCost}，威力 ${skillPower}`);
        break;
      case "statModifier":
        applyStatRule(rule, state, attackerModifiers, defenderModifiers, summaries);
        break;
      default:
        break;
    }
  }

  mergeManualModifiers(attackerModifiers, state.manualAttacker, summaries, "手动：进攻方");
  mergeManualModifiers(defenderModifiers, state.manualDefender, summaries, "手动：防守方");

  const attackStage = getAttackStage(skill.category, attackerModifiers);
  const defenseStage = getDefenseStage(skill.category, defenderModifiers);

  return {
    input: {
      category: skill.category,
      attackerStats,
      defenderStats,
      skillPower,
      responseMultiplier: 1,
      powerBonus,
      powerBuffMultiplier,
      stabMultiplier,
      typeMultiplier,
      weatherMultiplier: WEATHER_MULTIPLIER,
      hitCount,
      damageReductions: DAMAGE_REDUCTIONS,
      attackerAttackUp: attackStage.up,
      attackerAttackDown: attackStage.down,
      defenderDefenseUp: defenseStage.up,
      defenderDefenseDown: defenseStage.down,
    },
    hitCount,
    skillPower,
    powerBonus,
    powerBuffMultiplier,
    attackerModifiers,
    defenderModifiers,
    summaries,
    notes,
  };
}
