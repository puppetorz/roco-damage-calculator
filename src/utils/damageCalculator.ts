import type { DamageInput, DamageResult } from "../types/battle";
import { gameFloor, gameRound } from "./statCalculator";

const DAMAGE_FORMULA_ATTACK_NUMERATOR = 37;
const DAMAGE_FORMULA_ATTACK_DENOMINATOR = 41;
const MIN_DEFENSE = 1;
const MIN_DAMAGE = 1;
const MIN_HIT_COUNT = 1;
const MAX_DAMAGE_REDUCTION = 0.99;

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function clampMultiplier(value: number): number {
  return clampNonNegative(value);
}

function clampDamageReduction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(MAX_DAMAGE_REDUCTION, Math.max(0, value));
}

export function calculateAbilityMultiplier(input: DamageInput): number {
  // 能力等级 = (1 + 进攻方攻击提升 + 防守方防御降低) / (1 + 进攻方攻击降低 + 防守方防御提升)。
  const numerator =
    1 +
    clampNonNegative(input.attackerAttackUp) +
    clampNonNegative(input.defenderDefenseDown);
  const denominator =
    1 +
    clampNonNegative(input.attackerAttackDown) +
    clampNonNegative(input.defenderDefenseUp);

  return denominator <= 0 ? 1 : numerator / denominator;
}

export function calculateEffectivePower(input: DamageInput): number {
  // 有效威力 = 技能威力 * 应对倍率 + 威力加成；不稳定触发项由规则层显式传入。
  const skillPower = clampNonNegative(input.skillPower);
  const responseMultiplier = clampMultiplier(input.responseMultiplier);
  const powerBonus = Math.max(0, input.powerBonus);

  return skillPower * responseMultiplier + powerBonus;
}

export function calculateTotalDamageReduction(
  damageReductions: number[]
): number {
  // 多个减伤互相乘算：最终承伤 = (1-a) * (1-b)，总减伤 = 1 - 最终承伤。
  const remainingDamageRate = damageReductions.reduce((remaining, reduction) => {
    return remaining * (1 - clampDamageReduction(reduction));
  }, 1);

  return 1 - remainingDamageRate;
}

export function calculateDamage(input: DamageInput): DamageResult {
  const isPhysical = input.category === "physical";
  const attack = isPhysical ? input.attackerStats.atk : input.attackerStats.spa;
  const defense = isPhysical ? input.defenderStats.def : input.defenderStats.spd;
  const safeAttack = Math.max(0, attack);
  const safeDefense = Math.max(MIN_DEFENSE, defense);

  const effectivePower = calculateEffectivePower(input);
  const abilityMultiplier = calculateAbilityMultiplier(input);
  const totalDamageReduction = calculateTotalDamageReduction(
    input.damageReductions
  );
  const hitCount = Math.max(MIN_HIT_COUNT, gameRound(input.hitCount));

  // 局内威力 = (技能威力 * 应对倍率 + 威力加成) * 威力提升 * 本系 * 克制 * 天气。
  const inBattlePower =
    effectivePower *
    clampMultiplier(input.powerBuffMultiplier) *
    clampMultiplier(input.stabMultiplier) *
    clampMultiplier(input.typeMultiplier) *
    clampMultiplier(input.weatherMultiplier);

  // 实战推导的新 PVP 伤害公式：
  // 1. 能力等级作用在进攻值上，得到修正攻击。
  // 2. 先计算 37 * 局内威力 * 修正攻击 / 41，并用 gameRound 做游戏四舍五入。
  // 3. 再除以防御并用 gameFloor 向下取整，得到单击伤害。
  // 4. 最后单击伤害 * 连击数 * 减伤后承伤，并再次向下取整为最终伤害。
  const adjustedAttack = safeAttack * abilityMultiplier;
  const singleHitIntermediate = gameRound(
    (DAMAGE_FORMULA_ATTACK_NUMERATOR * inBattlePower * adjustedAttack) /
      DAMAGE_FORMULA_ATTACK_DENOMINATOR
  );
  const singleHitDamage = gameFloor(singleHitIntermediate / safeDefense);
  const rawDamage = singleHitDamage * hitCount * (1 - totalDamageReduction);

  const damage = Math.max(MIN_DAMAGE, gameFloor(rawDamage));
  const hp = Math.max(MIN_DEFENSE, input.defenderStats.hp);
  const hpPercent = (damage / hp) * 100;

  let risk: DamageResult["risk"] = "低危";
  if (damage >= hp) {
    risk = "必定击杀";
  } else if (hpPercent >= 70) {
    risk = "高危";
  } else if (hpPercent >= 40) {
    risk = "中危";
  }

  return {
    attackStatName: isPhysical ? "物攻" : "魔攻",
    defenseStatName: isPhysical ? "物防" : "魔防",
    attack: safeAttack,
    defense: safeDefense,
    effectivePower,
    inBattlePower,
    adjustedAttack,
    abilityMultiplier,
    totalDamageReduction,
    singleHitIntermediate,
    singleHitDamage,
    hitCount,
    rawDamage,
    damage,
    hpPercent,
    risk,
  };
}
