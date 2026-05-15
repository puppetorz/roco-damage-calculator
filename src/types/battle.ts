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
  energyCost?: number;
  description?: string;
  rawEffectText?: string;
  rawDescriptionText?: string;
  effectEntries?: string[];
  parsedEffects?: BattleEffect[];
  unparsedEffectNotes?: string[];
  stableDamage: boolean;
  defaultHitCount?: number;
  defaultPowerBonus?: number;
  defaultPowerBuffMultiplier?: number;
  notes?: string;
  sourceUrl?: string;
  learnableSpiritNames?: string[];
  learnableSpiritIds?: string[];
};

export type BattleEffectTarget = "self" | "opponent" | "team" | "field";

export type BattleResponseKind = "attack" | "status" | "defense";

export type BattleEffectTrigger =
  | {
      kind: "carriedSkillElement";
      element: string;
    }
  | {
      kind: "skillUse";
    }
  | {
      kind: "onHit";
    }
  | {
      kind: "manual";
    };

export type BattleEffect =
  | {
      kind: "powerBonus";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "powerMultiplier";
      target: BattleEffectTarget;
      multiplier: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "hitCountModifier";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "statModifier";
      target: BattleEffectTarget;
      statKeys: StatKey[];
      rate: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "speedModifier";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "status";
      target: BattleEffectTarget;
      status: "burn" | "freeze" | "poison" | "stun" | "other";
      stacks: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "mark";
      target: BattleEffectTarget;
      mark: string;
      stacks: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "heal";
      target: BattleEffectTarget;
      percent?: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "drain";
      target: BattleEffectTarget;
      percent: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "energyDelta";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "energyCostModifier";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "temporaryEnergyCostOnFirstAction";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "dynamicPowerOverride";
      target: BattleEffectTarget;
      powerByEnergy?: number[];
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
      approximationNote?: string;
    }
  | {
      kind: "powerLossByMissingHp";
      target: BattleEffectTarget;
      stepPercent: number;
      amountPerStep: number;
      minimumPower?: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "defenseGapPowerOverride";
      target: BattleEffectTarget;
      table: Array<{
        min: number;
        max?: number;
        power: number;
      }>;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "powerMultiplierIfOpponentSwitched";
      target: BattleEffectTarget;
      multiplier: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "selfFaintAfterUse";
      target: BattleEffectTarget;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "percentHeal";
      target: BattleEffectTarget;
      percent: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "termMark";
      target: BattleEffectTarget;
      term: string;
      stacks: number;
      partial?: boolean;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
      approximationNote?: string;
    }
  | {
      kind: "endTurnEnergyFromMark";
      target: BattleEffectTarget;
      term: string;
      energyPerStack: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "priorityModifier";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "damageReduction";
      target: BattleEffectTarget;
      rate: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "responseWindow";
      target: BattleEffectTarget;
      responseKind: BattleResponseKind;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "interrupt";
      target: BattleEffectTarget;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "permanentEnergyCostModifier";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "permanentPowerModifier";
      target: BattleEffectTarget;
      amount: number;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "entryCounter";
      target: BattleEffectTarget;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "weather";
      target: BattleEffectTarget;
      weather: string;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "field";
      target: BattleEffectTarget;
      field: string;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "dispel";
      target: BattleEffectTarget;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "switch";
      target: BattleEffectTarget;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: boolean;
    }
  | {
      kind: "note";
      target: BattleEffectTarget;
      note: string;
      trigger?: BattleEffectTrigger;
      rawText: string;
      simulated: false;
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

export type DamageSkill = Skill & { category: DamageSkillCategory };

export type CombatantBuild = {
  spirit: Spirit;
  nature: Nature;
  individualValues: IndividualValues;
  skills: DamageSkill[];
  allSkills: Skill[];
  actualStats: BattleStats;
};

export type BattleSide = "A" | "B";

export type BattleAction =
  | {
      kind: "useSkill";
      side: BattleSide;
      skillId: string;
    }
  | {
      kind: "switch";
      side: BattleSide;
      memberIndex: number;
    };

export type BattleMemberState = {
  build: CombatantBuild;
  hp: number;
  maxHp: number;
  energy: number;
  fainted: boolean;
  statModifiers: StatModifierValues;
  flatStatModifiers: StatModifierValues;
  skillEnergyCostModifiers: Record<string, number>;
  skillPowerModifiers: Record<string, number>;
  entryCount: number;
  hasUsedFirstAction: boolean;
  temporaryPriorityBonus: number;
  damageReduction: number;
  responseState?: {
    skillId: string;
    skillName: string;
    responseKind: BattleResponseKind;
    effects: BattleEffect[];
  };
  pendingSwitch?: number;
  statuses: Record<string, number>;
  marks: Record<string, number>;
};

export type BattleTeamState = {
  side: BattleSide;
  activeIndex: number;
  members: BattleMemberState[];
};

export type BattleState = {
  turn: number;
  teams: Record<BattleSide, BattleTeamState>;
  switchedThisTurn: Record<BattleSide, boolean>;
  events: BattleEvent[];
};

export type BattleEvent = {
  turn: number;
  side?: BattleSide;
  actor?: string;
  action?: BattleAction["kind"];
  skillName?: string;
  target?: string;
  damage?: number;
  reducedDamage?: number;
  healing?: number;
  priority?: number;
  interrupted?: boolean;
  respondedSkill?: string;
  dispelledMarks?: number;
  energyChange?: number;
  permanentChange?: string;
  dynamicPower?: number;
  temporaryEnergyCost?: number;
  selfFaintedAfterUse?: boolean;
  markChange?: string;
  termTriggered?: string;
  approximationNote?: string;
  effect?: string;
  message: string;
};

export type SimulatedBattleResult = {
  winner?: BattleSide;
  turns: number;
  scoreA: number;
  scoreB: number;
  remainingHpA: number;
  remainingHpB: number;
  events: BattleEvent[];
  unmodeledEffects: string[];
};

export type MctsConfig = {
  seed: number;
  iterations: number;
  rolloutDepth: number;
  maxTurns: number;
  exploration: number;
};

export type SelfPlayTeamResult = {
  teamId: string;
  rank: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  averageRemainingHp: number;
  team: CombatantBuild[];
  reasons: string[];
  weaknesses: string[];
  keyBattles: SimulatedBattleResult[];
  unmodeledEffects: string[];
};

export type AdvancedTeamRecommendation = {
  generatedAt: string;
  source: string;
  mctsConfig: MctsConfig;
  candidates: string[];
  matchupMatrix: Record<string, Record<string, number>>;
  teams: SelfPlayTeamResult[];
  unmodeledEffects: string[];
};

export type MatchupScore = {
  attackerId: string;
  defenderId: string;
  bestSkill: DamageSkill;
  damage: number;
  hpPercent: number;
  typeMultiplier: number;
  speedAdvantage: boolean;
  killPressure: number;
  score: number;
};

export type TeamMemberScore = {
  build: CombatantBuild;
  averageScore: number;
  bestMatchups: MatchupScore[];
  worstMatchups: MatchupScore[];
  role: string;
};

export type TeamScore = {
  members: TeamMemberScore[];
  score: number;
  coverageScore: number;
  weaknessPenalty: number;
  speedScore: number;
  reasons: string[];
  weaknesses: string[];
};

export type TeamSearchOptions = {
  candidateLimit: number;
  outputCount: number;
  environmentSize: number;
  teamSize?: number;
  beamWidth?: number;
  candidates?: CombatantBuild[];
  environment?: CombatantBuild[];
  usageWeights?: Record<string, number>;
  teammateSynergy?: Record<string, Record<string, number>>;
};

export type TeamSearchResult = {
  candidates: CombatantBuild[];
  environment: CombatantBuild[];
  teams: TeamScore[];
};

export type PvpLineupMember = {
  slot: number;
  spiritName: string;
  spiritId?: string;
  bloodline?: string;
  natureName?: string;
  natureId?: string;
  individualKeys: StatKey[];
  skillNames: string[];
  skillIds: string[];
  unresolvedSkillNames: string[];
};

export type PvpLineup = {
  id: string;
  title: string;
  type: "pvp";
  author?: string;
  bloodlineMagic?: string;
  description?: string;
  uploadedAt?: string;
  sourcePage: string;
  sourceUrl: string;
  members: PvpLineupMember[];
  unresolvedSpiritNames: string[];
};

export type UsageStats = {
  lineupCount: number;
  spiritUsage: Record<string, number>;
  skillUsageBySpirit: Record<string, Record<string, number>>;
  natureUsageBySpirit: Record<string, Record<string, number>>;
  individualUsageBySpirit: Record<string, Record<string, number>>;
  teammateUsage: Record<string, Record<string, number>>;
};

export type OfflineTeamRecommendation = {
  rank: number;
  score: number;
  spiritIds: string[];
  reasons: string[];
  weaknesses: string[];
};
