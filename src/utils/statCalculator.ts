import type {
  BattleStats,
  GrowthValues,
  IndividualValues,
  Nature,
  StatKey,
} from "../types/battle";

export const PVP_LEVEL = 60;
export const PERFECT_IV_VALUE = 60;
export const PERFECT_IV_LINE_COUNT = 3;

const MAX_INDIVIDUAL_VALUE = 60;
const MIN_INDIVIDUAL_VALUE = 0;

const NON_HP_BASE_MULTIPLIER = 1.1;
const NON_HP_IV_MULTIPLIER = 0.55;
const NON_HP_FLAT_BONUS = 10;
const NON_HP_FINAL_BONUS = 50;

const HP_BASE_MULTIPLIER = 1.7;
const HP_IV_MULTIPLIER = 0.85;
const HP_FLAT_BONUS = 70;
const HP_FINAL_BONUS = 100;

const MAX_HP_GROWTH = 100;
const MAX_NON_HP_GROWTH = 50;

export const STAT_KEYS: StatKey[] = ["hp", "atk", "spa", "def", "spd", "spe"];

export const DEFAULT_INDIVIDUAL_VALUES: IndividualValues = {
  hp: 0,
  atk: 0,
  spa: 0,
  def: 0,
  spd: 0,
  spe: 0,
};

export const EMPTY_GROWTH_VALUES: GrowthValues = {
  hp: 0,
  atk: 0,
  spa: 0,
  def: 0,
  spd: 0,
  spe: 0,
};

export const DEFAULT_PVP_GROWTH_VALUES: GrowthValues = {
  hp: 100,
  atk: 50,
  spa: 50,
  def: 50,
  spd: 50,
  spe: 50,
};

export function gameRound(value: number): number {
  // 游戏内 0.5 的进退位规则暂未完全确定，当前统一用 Math.round，后续只需替换这里。
  return Math.round(value);
}

export function gameFloor(value: number): number {
  // 伤害公式里的向下取整集中封装，后续如果游戏取整规则有差异，只需要替换这里。
  return Math.floor(value);
}

export function clampIndividualValue(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_INDIVIDUAL_VALUE;
  }

  return Math.min(
    MAX_INDIVIDUAL_VALUE,
    Math.max(MIN_INDIVIDUAL_VALUE, gameRound(value))
  );
}

export function clampGrowthValue(key: StatKey, value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const max = key === "hp" ? MAX_HP_GROWTH : MAX_NON_HP_GROWTH;
  return Math.min(max, Math.max(0, gameRound(value)));
}

export function createIndividualValuesFromKeys(keys: StatKey[]): IndividualValues {
  const selectedKeys = new Set(keys.slice(0, PERFECT_IV_LINE_COUNT));

  return STAT_KEYS.reduce((values, key) => {
    values[key] = selectedKeys.has(key) ? PERFECT_IV_VALUE : 0;
    return values;
  }, { ...DEFAULT_INDIVIDUAL_VALUES });
}

function getNatureRate(statKey: StatKey, nature: Nature): number {
  return nature.modifiers[statKey] ?? 0;
}

export function calculateSingleStat(
  key: StatKey,
  baseValue: number,
  individualValue: number,
  natureRate: number
): number {
  const iv = clampIndividualValue(individualValue);

  if (key === "hp") {
    // PVP 生命公式：round2(round1(1.7 * 种族值 + 个体值 * 0.85 + 70) * 性格倍率) + 100。
    const first = gameRound(
      HP_BASE_MULTIPLIER * baseValue + iv * HP_IV_MULTIPLIER + HP_FLAT_BONUS
    );

    return gameRound(first * (1 + natureRate)) + HP_FINAL_BONUS;
  }

  // PVP 非生命公式：round2(round1(1.1 * 种族值 + 个体值 * 0.55 + 10) * 性格倍率) + 50。
  const first = gameRound(
    NON_HP_BASE_MULTIPLIER * baseValue +
      iv * NON_HP_IV_MULTIPLIER +
      NON_HP_FLAT_BONUS
  );

  return gameRound(first * (1 + natureRate)) + NON_HP_FINAL_BONUS;
}

export function calculatePvpBaseStats(
  baseStats: BattleStats,
  ivs: IndividualValues,
  nature: Nature
): BattleStats {
  return STAT_KEYS.reduce((result, key) => {
    result[key] = calculateSingleStat(
      key,
      baseStats[key],
      ivs[key],
      getNatureRate(key, nature)
    );
    return result;
  }, {} as BattleStats);
}

export function calculatePvpStats(
  baseStats: BattleStats,
  ivs: IndividualValues,
  nature: Nature
): BattleStats {
  // 公式里的最终 +100 / +50 已经是 PVP 实际属性的一部分，不再额外叠加五星成长。
  return calculatePvpBaseStats(baseStats, ivs, nature);
}
