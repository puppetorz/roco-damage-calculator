export type StatKey = "hp" | "atk" | "spa" | "def" | "spd" | "spe";

export type BattleStats = Record<StatKey, number>;

export type IndividualValues = Record<StatKey, number>;

export type GrowthValues = Record<StatKey, number>;

export type NatureModifier = Partial<Record<StatKey, number>>;

export type Trait = {
  name: string;
  description?: string;
};

export type Spirit = {
  id: string;
  name: string;
  elements: string[];
  baseStats: BattleStats;
  dexNo?: string;
  pageId?: number;
  form?: string;
  stage?: string;
  imageUrl?: string;
  sourceUrl?: string;
  traits?: Trait[];
  commonSkillIds?: string[];
  learnableSkillIds?: string[];
  learnableSkillNames?: string[];
  unresolvedSkillNames?: string[];
};

export type Nature = {
  id: string;
  name: string;
  modifiers: NatureModifier;
};

export type DamageSkillCategory = "physical" | "magical";

export type SkillCategory = DamageSkillCategory | "status" | "defense";

export type Skill = {
  id: string;
  name: string;
  element: string;
  category: SkillCategory;
  power: number;
  description?: string;
  stableDamage: boolean;
  defaultHitCount?: number;
  defaultPowerBonus?: number;
  defaultPowerBuffMultiplier?: number;
  notes?: string;
  sourceUrl?: string;
  learnableSpiritNames?: string[];
  learnableSpiritIds?: string[];
};

export type CommonBuild = {
  id: string;
  spiritId: string;
  name: string;
  individualValues: IndividualValues;
  natureId: string;
  skillIds: string[];
  sourceUrl?: string;
  notes?: string;
};

export type DamageInput = {
  category: DamageSkillCategory;

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
  inBattlePower: number;
  adjustedAttack: number;
  abilityMultiplier: number;
  totalDamageReduction: number;
  singleHitIntermediate: number;
  singleHitDamage: number;
  hitCount: number;
  rawDamage: number;
  damage: number;
  hpPercent: number;
  risk: DamageRisk;
};

export type EffectSourceType = "skill" | "trait";

export type EffectCondition =
  | "always"
  | "manual"
  | "responseAttack"
  | "responseStatus"
  | "responseDefense"
  | "typeAdvantage"
  | "beforeEnemy"
  | "afterEnemy"
  | "enemySwitch"
  | "lowHp"
  | "fieldActive";

export type EffectTarget = "attacker" | "defender";

type BaseEffectRule = {
  id: string;
  sourceType: EffectSourceType;
  sourceName: string;
  label: string;
  description: string;
};

export type EffectRule =
  | (BaseEffectRule & {
      kind: "hitCountBase";
      hitCount: number;
    })
  | (BaseEffectRule & {
      kind: "hitCountPerUse";
      amount: number;
    })
  | (BaseEffectRule & {
      kind: "hitCountBonusToggle";
      condition: EffectCondition;
      amount: number;
    })
  | (BaseEffectRule & {
      kind: "hitCountBonusStack";
      condition: EffectCondition;
      amountPerStack: number;
      stackLabel: string;
    })
  | (BaseEffectRule & {
      kind: "hitCountMultiplier";
      condition: EffectCondition;
      multiplier: number;
    })
  | (BaseEffectRule & {
      kind: "hitCountOverride";
      condition: EffectCondition;
      hitCount: number;
    })
  | (BaseEffectRule & {
      kind: "powerBonusPerUse";
      amount: number;
    })
  | (BaseEffectRule & {
      kind: "powerBonusToggle";
      condition: EffectCondition;
      amount: number;
      appliesToSkillElements?: string[];
    })
  | (BaseEffectRule & {
      kind: "powerBonusStack";
      condition: EffectCondition;
      amountPerStack: number;
      stackLabel: string;
      appliesToSkillElements?: string[];
    })
  | (BaseEffectRule & {
      kind: "powerMultiplierToggle";
      condition: EffectCondition;
      multiplier: number;
      appliesToSkillElements?: string[];
    })
  | (BaseEffectRule & {
      kind: "powerMultiplierStack";
      condition: EffectCondition;
      ratePerStack: number;
      stackLabel: string;
      appliesToSkillElements?: string[];
    })
  | (BaseEffectRule & {
      kind: "powerFromEnemyCost";
      multiplier: number;
    })
  | (BaseEffectRule & {
      kind: "statModifier";
      condition: EffectCondition;
      target: EffectTarget;
      statKeys: StatKey[];
      rate: number;
      stackable: boolean;
      stackLabel?: string;
    })
  | (BaseEffectRule & {
      kind: "note";
    });

export type StatModifierValues = Record<StatKey, number>;

export type BattleModifierState = {
  ruleEnabled: Record<string, boolean>;
  ruleStacks: Record<string, number>;
  skillUseCount: number;
  enemyTotalSkillCost: number;
  manualAttacker: StatModifierValues;
  manualDefender: StatModifierValues;
};
