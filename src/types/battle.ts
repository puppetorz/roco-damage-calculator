export type StatKey = "hp" | "atk" | "spa" | "def" | "spd" | "spe";

export type BattleStats = Record<StatKey, number>;

export type IndividualValues = Record<StatKey, number>;

export type NatureModifier = Partial<Record<StatKey, number>>;

export type Spirit = {
  id: string;
  name: string;
  elements: string[];
  baseStats: BattleStats;
};

export type Nature = {
  id: string;
  name: string;
  modifiers: NatureModifier;
};

export type SkillCategory = "physical" | "magical";

export type Skill = {
  id: string;
  name: string;
  category: SkillCategory;
  power: number;
  element?: string;
};

export type CommonBuild = {
  id: string;
  spiritId: string;
  name: string;
  individualValues: IndividualValues;
  natureId: string;
  skillIds: string[];
};

export type DamageInput = {
  category: SkillCategory;

  attackerStats: BattleStats;
  defenderStats: BattleStats;

  skillPower: number;
  responseMultiplier: number;
  powerBonus: number;

  powerBuffMultiplier: number;
  stabMultiplier: number;
  typeMultiplier: number;
  weatherMultiplier: number;

  hitCount: number;
  damageReductions: number[];

  attackerAttackUp: number;
  attackerAttackDown: number;
  defenderDefenseUp: number;
  defenderDefenseDown: number;
};

export type DamageRisk = "必定击杀" | "高危" | "中危" | "低危";

export type DamageResult = {
  attackStatName: "物攻" | "魔攻";
  defenseStatName: "物防" | "魔防";
  attack: number;
  defense: number;
  effectivePower: number;
  abilityMultiplier: number;
  totalDamageReduction: number;
  rawDamage: number;
  damage: number;
  hpPercent: number;
  risk: DamageRisk;
};
