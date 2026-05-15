import type {
  BattleAction,
  BattleEffect,
  BattleEvent,
  BattleMemberState,
  BattleSide,
  BattleState,
  CombatantBuild,
  DamageSkill,
  MctsConfig,
  SimulatedBattleResult,
  Skill,
  StatKey,
  StatModifierValues,
} from "../types/battle";
import { calculateDamage } from "./damageCalculator";
import {
  getStabMultiplier,
  getTraitRules,
  isDamageSkill,
} from "./combatantBuilder";
import {
  createDefaultBattleModifierState,
  resolveDamageInput,
} from "./damageResolver";
import { parseSkillRules } from "./effectRuleParser";
import {
  collectTriggeredEffects,
  createSkillEffectRules,
} from "./skillEffectRules";
import { STAT_KEYS } from "./statCalculator";
import {
  getPhotosynthesisEnergyGain,
  getWetEnergyCostReduction,
  TERM_MARKS,
} from "./termRules";
import { calculateTypeMultiplier } from "./typeCalculator";

const INITIAL_ENERGY = 10;
const SIDES: BattleSide[] = ["A", "B"];
const MAGIC_BLAST_POWER_BY_ENERGY = [46, 71, 91, 111, 136, 156, 166, 181, 191, 201, 211];
const SAND_TRAP_DEFENSE_GAP_POWER_TABLE = [
  { min: -999999, max: -1, power: 60 },
  { min: 0, max: 14, power: 100 },
  { min: 15, max: 29, power: 130 },
  { min: 30, max: 44, power: 140 },
  { min: 45, max: 59, power: 150 },
  { min: 60, max: 74, power: 160 },
  { min: 75, max: 89, power: 170 },
  { min: 90, max: 104, power: 180 },
  { min: 105, max: 119, power: 190 },
  { min: 120, max: 134, power: 194 },
  { min: 135, power: 200 },
];

type RandomSource = () => number;

type MctsChild = {
  action: BattleAction;
  visits: number;
  value: number;
};

function createRng(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function otherSide(side: BattleSide): BattleSide {
  return side === "A" ? "B" : "A";
}

function cloneModifiers(values: StatModifierValues): StatModifierValues {
  return { ...values };
}

function emptyModifiers(): StatModifierValues {
  return {
    hp: 0,
    atk: 0,
    spa: 0,
    def: 0,
    spd: 0,
    spe: 0,
  };
}

function createMember(build: CombatantBuild): BattleMemberState {
  return {
    build,
    hp: build.actualStats.hp,
    maxHp: build.actualStats.hp,
    energy: INITIAL_ENERGY,
    fainted: false,
    statModifiers: emptyModifiers(),
    flatStatModifiers: emptyModifiers(),
    skillEnergyCostModifiers: {},
    skillPowerModifiers: {},
    entryCount: 1,
    hasUsedFirstAction: false,
    temporaryPriorityBonus: 0,
    damageReduction: 0,
    statuses: {},
    marks: {},
  };
}

export function createInitialBattleState(
  teamA: CombatantBuild[],
  teamB: CombatantBuild[]
): BattleState {
  const state: BattleState = {
    turn: 1,
    teams: {
      A: {
        side: "A",
        activeIndex: 0,
        members: teamA.map(createMember),
      },
      B: {
        side: "B",
        activeIndex: 0,
        members: teamB.map(createMember),
      },
    },
    switchedThisTurn: {
      A: false,
      B: false,
    },
    events: [],
  };

  applyEntryEffects(state, "A", true);
  applyEntryEffects(state, "B", true);

  return state;
}

function cloneMember(member: BattleMemberState): BattleMemberState {
  return {
    build: member.build,
    hp: member.hp,
    maxHp: member.maxHp,
    energy: member.energy,
    fainted: member.fainted,
    statModifiers: cloneModifiers(member.statModifiers),
    flatStatModifiers: cloneModifiers(member.flatStatModifiers),
    skillEnergyCostModifiers: { ...member.skillEnergyCostModifiers },
    skillPowerModifiers: { ...member.skillPowerModifiers },
    entryCount: member.entryCount,
    hasUsedFirstAction: member.hasUsedFirstAction,
    temporaryPriorityBonus: member.temporaryPriorityBonus,
    damageReduction: member.damageReduction,
    responseState: member.responseState
      ? {
          ...member.responseState,
          effects: member.responseState.effects.map((effect) => ({ ...effect })),
        }
      : undefined,
    pendingSwitch: member.pendingSwitch,
    statuses: { ...member.statuses },
    marks: { ...member.marks },
  };
}

function cloneState(state: BattleState): BattleState {
  return {
    turn: state.turn,
    teams: {
      A: {
        side: "A",
        activeIndex: state.teams.A.activeIndex,
        members: state.teams.A.members.map(cloneMember),
      },
      B: {
        side: "B",
        activeIndex: state.teams.B.activeIndex,
        members: state.teams.B.members.map(cloneMember),
      },
    },
    switchedThisTurn: { ...state.switchedThisTurn },
    events: state.events.map((event) => ({ ...event })),
  };
}

function getActiveMember(state: BattleState, side: BattleSide): BattleMemberState {
  return state.teams[side].members[state.teams[side].activeIndex];
}

function getLivingMembers(state: BattleState, side: BattleSide): BattleMemberState[] {
  return state.teams[side].members.filter((member) => !member.fainted);
}

function getWinner(state: BattleState): BattleSide | undefined {
  const aAlive = getLivingMembers(state, "A").length > 0;
  const bAlive = getLivingMembers(state, "B").length > 0;

  if (aAlive && !bAlive) {
    return "A";
  }

  if (bAlive && !aAlive) {
    return "B";
  }

  return undefined;
}

function addEvent(state: BattleState, event: Omit<BattleEvent, "turn">): void {
  state.events.push({
    turn: state.turn,
    ...event,
  });
}

function getSkillEnergyCost(member: BattleMemberState, skill: Skill): number {
  return Math.max(
    0,
    (skill.energyCost ?? 0) +
      (member.skillEnergyCostModifiers[skill.id] ?? 0) -
      getBurstEnergyCostReduction(member, skill) -
      getWetEnergyCostReduction(member)
  );
}

function getBurstEnergyCostReduction(member: BattleMemberState, skill: Skill): number {
  if (member.hasUsedFirstAction) {
    return 0;
  }

  return collectTriggeredEffects(skill, member.build.allSkills).reduce((sum, effect) => {
    return effect.kind === "temporaryEnergyCostOnFirstAction"
      ? sum + Math.abs(effect.amount)
      : sum;
  }, 0);
}

function getModifiedSkill(member: BattleMemberState, skill: DamageSkill): DamageSkill {
  const powerModifier = member.skillPowerModifiers[skill.id] ?? 0;

  return {
    ...skill,
    power: Math.max(0, skill.power + powerModifier),
  };
}

export function listLegalActions(state: BattleState, side: BattleSide): BattleAction[] {
  const team = state.teams[side];
  const active = getActiveMember(state, side);

  if (active.fainted) {
    return team.members
      .map((member, index) => ({ member, index }))
      .filter(({ member }) => !member.fainted)
      .map(({ index }) => ({ kind: "switch", side, memberIndex: index }));
  }

  const skillActions = active.build.allSkills
    .filter((skill) => active.energy >= getSkillEnergyCost(active, skill))
    .map((skill) => ({ kind: "useSkill" as const, side, skillId: skill.id }));
  const switchActions = team.members
    .map((member, index) => ({ member, index }))
    .filter(({ member, index }) => index !== team.activeIndex && !member.fainted)
    .map(({ index }) => ({ kind: "switch" as const, side, memberIndex: index }));

  return [...skillActions, ...switchActions];
}

function applyStatValues(member: BattleMemberState): Record<StatKey, number> {
  return STAT_KEYS.reduce(
    (stats, key) => {
      const base = member.build.actualStats[key];
      stats[key] = Math.max(
        key === "hp" ? 1 : 0,
        Math.round(base * (1 + member.statModifiers[key]) + member.flatStatModifiers[key])
      );
      return stats;
    },
    {} as Record<StatKey, number>
  );
}

function getActionSkill(member: BattleMemberState, action: BattleAction): Skill | undefined {
  if (action.kind !== "useSkill") {
    return undefined;
  }

  return member.build.allSkills.find((skill) => skill.id === action.skillId);
}

function getActionPriority(state: BattleState, action: BattleAction): number {
  if (action.kind === "switch") {
    return 100;
  }

  const active = getActiveMember(state, action.side);
  const skill = getActionSkill(active, action);
  const triggeredEffects = skill ? collectTriggeredEffects(skill, active.build.allSkills) : [];
  const effectPriority = triggeredEffects.reduce((sum, effect) => {
    if (effect.kind === "priorityModifier" && effect.target === "self") {
      return sum + effect.amount;
    }

    if (effect.kind === "damageReduction" || effect.kind === "responseWindow") {
      return sum + 4;
    }

    return sum;
  }, 0);

  return active.temporaryPriorityBonus + effectPriority;
}

function getActionSpeed(state: BattleState, action: BattleAction): number {
  if (action.kind === "switch") {
    return 100000;
  }

  const active = getActiveMember(state, action.side);
  const skill = getActionSkill(active, action);
  const triggeredEffects = skill ? collectTriggeredEffects(skill, active.build.allSkills) : [];
  const actionSpeedBonus = triggeredEffects.reduce((sum, effect) => {
    return effect.kind === "speedModifier" && effect.target === "self" ? sum + effect.amount : sum;
  }, 0);

  return applyStatValues(active).spe + actionSpeedBonus;
}

function switchActive(
  state: BattleState,
  action: Extract<BattleAction, { kind: "switch" }>,
  options: { automatic?: boolean } = {}
): void {
  const team = state.teams[action.side];
  const target = team.members[action.memberIndex];

  if (!target || target.fainted || action.memberIndex === team.activeIndex) {
    return;
  }

  team.activeIndex = action.memberIndex;
  target.entryCount += 1;
  addEvent(state, {
    side: action.side,
    actor: target.build.spirit.name,
    action: "switch",
    message: `${action.side} 换上 ${target.build.spirit.name}`,
  });
  if (!options.automatic) {
    state.switchedThisTurn[action.side] = true;
    applyEntryHazards(state, action.side);
  }
  applyEntryEffects(state, action.side, false);
}

function applyEntryHazards(state: BattleState, side: BattleSide): void {
  const member = getActiveMember(state, side);
  const thornStacks = member.marks[TERM_MARKS.thorn] ?? 0;

  if (thornStacks <= 0) {
    return;
  }

  const damage = Math.min(member.hp, Math.round(member.maxHp * thornStacks * 0.06));
  member.hp = Math.max(0, member.hp - damage);
  addEvent(state, {
    side,
    actor: member.build.spirit.name,
    damage,
    termTriggered: TERM_MARKS.thorn,
    effect: TERM_MARKS.thorn,
    message: `${member.build.spirit.name} 入场触发棘刺，受到 ${damage} 伤害`,
  });
  faintIfNeeded(state, side);
}

function applyEntryEffects(
  state: BattleState,
  side: BattleSide,
  initial: boolean
): void {
  const member = getActiveMember(state, side);

  for (const skill of member.build.allSkills) {
    for (const effect of collectTriggeredEffects(skill, member.build.allSkills)) {
      if (!effect.rawText.includes("每次入场")) {
        continue;
      }

      if (effect.kind === "permanentPowerModifier") {
        member.skillPowerModifiers[skill.id] =
          (member.skillPowerModifiers[skill.id] ?? 0) + effect.amount;
        addEvent(state, {
          side,
          actor: member.build.spirit.name,
          skillName: skill.name,
          permanentChange: `${skill.name} 威力 +${effect.amount}`,
          effect: effect.rawText,
          message: `${member.build.spirit.name}${initial ? "初始入场" : "入场"}触发 ${skill.name} 威力 +${effect.amount}`,
        });
      }
    }
  }
}

function resetTurnState(state: BattleState): void {
  for (const side of SIDES) {
    const member = getActiveMember(state, side);
    member.temporaryPriorityBonus = 0;
    member.damageReduction = 0;
    member.responseState = undefined;
    member.pendingSwitch = undefined;
  }
}

function addStacks(target: Record<string, number>, key: string, value: number): void {
  target[key] = Math.max(0, (target[key] ?? 0) + value);
}

function applyEffect(
  state: BattleState,
  side: BattleSide,
  effect: BattleEffect,
  damageDealt: number,
  sourceSkill: Skill
): void {
  if (!effect.simulated) {
    return;
  }

  const actor = getActiveMember(state, side);
  const target = getActiveMember(state, otherSide(side));
  const selected = effect.target === "opponent" ? target : actor;

  if (effect.kind === "statModifier") {
    for (const key of effect.statKeys) {
      selected.statModifiers[key] = Math.max(
        -0.8,
        Math.min(1.6, selected.statModifiers[key] + effect.rate)
      );
    }
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      effect: effect.rawText,
      message: `${actor.build.spirit.name} 触发 ${effect.rawText}`,
    });
    return;
  }

  if (effect.kind === "speedModifier") {
    selected.flatStatModifiers.spe += effect.amount;
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      effect: effect.rawText,
      message: `${actor.build.spirit.name} 触发 ${effect.rawText}`,
    });
    return;
  }

  if (effect.kind === "status") {
    addStacks(selected.statuses, effect.status, effect.stacks);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      target: selected.build.spirit.name,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 获得 ${effect.stacks} 层 ${effect.status}`,
    });
    return;
  }

  if (effect.kind === "mark") {
    addStacks(selected.marks, effect.mark, effect.stacks);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      target: selected.build.spirit.name,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 获得 ${effect.stacks} 层 ${effect.mark}`,
    });
    return;
  }

  if (effect.kind === "termMark") {
    addStacks(selected.marks, effect.term, effect.stacks);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      target: selected.build.spirit.name,
      markChange: `${effect.term}+${effect.stacks}`,
      termTriggered: effect.term,
      approximationNote: effect.approximationNote,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 获得 ${effect.stacks} 层${effect.term}`,
    });
    return;
  }

  if (effect.kind === "heal") {
    const healing = Math.round(selected.maxHp * (effect.percent ?? 0.18));
    selected.hp = Math.min(selected.maxHp, selected.hp + healing);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      healing,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 回复 ${healing}`,
    });
    return;
  }

  if (effect.kind === "percentHeal") {
    const healing = Math.round(selected.maxHp * effect.percent);
    selected.hp = Math.min(selected.maxHp, selected.hp + healing);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      target: selected.build.spirit.name,
      healing,
      effect: effect.rawText,
      termTriggered: "percent-heal",
      message: `${selected.build.spirit.name} 回复 ${healing}`,
    });
    return;
  }

  if (effect.kind === "drain" && damageDealt > 0) {
    const healing = Math.round(damageDealt * effect.percent);
    actor.hp = Math.min(actor.maxHp, actor.hp + healing);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      healing,
      effect: effect.rawText,
      message: `${actor.build.spirit.name} 吸血回复 ${healing}`,
    });
    return;
  }

  if (effect.kind === "energyDelta") {
    selected.energy = Math.max(0, selected.energy + effect.amount);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      target: selected.build.spirit.name,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 能量 ${effect.amount >= 0 ? "+" : ""}${effect.amount}`,
    });
    return;
  }

  if (effect.kind === "energyCostModifier") {
    for (const skill of selected.build.allSkills) {
      selected.skillEnergyCostModifiers[skill.id] =
        (selected.skillEnergyCostModifiers[skill.id] ?? 0) + effect.amount;
    }
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      effect: effect.rawText,
      permanentChange: effect.rawText,
      message: `${selected.build.spirit.name} 获得能耗修正：${effect.rawText}`,
    });
    return;
  }

  if (effect.kind === "priorityModifier") {
    selected.temporaryPriorityBonus += effect.amount;
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      priority: effect.amount,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 获得先手修正 +${effect.amount}`,
    });
    return;
  }

  if (effect.kind === "damageReduction") {
    selected.damageReduction = Math.max(selected.damageReduction, effect.rate);
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 建立 ${Math.round(effect.rate * 100)}% 减伤`,
    });
    return;
  }

  if (effect.kind === "responseWindow") {
    selected.responseState = {
      skillId: sourceSkill.id,
      skillName: sourceSkill.name,
      responseKind: effect.responseKind,
      effects: collectTriggeredEffects(sourceSkill, selected.build.allSkills),
    };
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      effect: effect.rawText,
      message: `${selected.build.spirit.name} 建立应对窗口：${effect.responseKind}`,
    });
    return;
  }

  if (effect.kind === "permanentEnergyCostModifier") {
    selected.skillEnergyCostModifiers[sourceSkill.id] =
      (selected.skillEnergyCostModifiers[sourceSkill.id] ?? 0) + effect.amount;
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      energyChange: effect.amount,
      permanentChange: `${sourceSkill.name} 能耗 ${effect.amount >= 0 ? "+" : ""}${effect.amount}`,
      effect: effect.rawText,
      message: `${sourceSkill.name} 永久能耗 ${effect.amount >= 0 ? "+" : ""}${effect.amount}`,
    });
    return;
  }

  if (effect.kind === "permanentPowerModifier") {
    selected.skillPowerModifiers[sourceSkill.id] =
      (selected.skillPowerModifiers[sourceSkill.id] ?? 0) + effect.amount;
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      permanentChange: `${sourceSkill.name} 威力 +${effect.amount}`,
      effect: effect.rawText,
      message: `${sourceSkill.name} 永久威力 +${effect.amount}`,
    });
    return;
  }

  if (effect.kind === "dispel") {
    const targets = effect.rawText.includes("双方")
      ? [actor, target]
      : [selected];
    const markCount = targets.reduce((sum, member) => {
      return sum + Object.values(member.marks).reduce((markSum, value) => markSum + value, 0);
    }, 0);
    for (const member of targets) {
      member.marks = {};
    }
    addEvent(state, {
      side,
      actor: actor.build.spirit.name,
      target: effect.rawText.includes("双方") ? "双方" : selected.build.spirit.name,
      dispelledMarks: markCount,
      effect: effect.rawText,
      message: `${effect.rawText.includes("双方") ? "双方" : selected.build.spirit.name} 被驱散 ${markCount} 层印记`,
    });
    return;
  }

  if (effect.kind === "switch") {
    const team = state.teams[side];
    const nextIndex = team.members.findIndex(
      (member, index) => index !== team.activeIndex && !member.fainted
    );
    if (nextIndex >= 0) {
      actor.pendingSwitch = nextIndex;
      addEvent(state, {
        side,
        actor: actor.build.spirit.name,
        effect: effect.rawText,
        message: `${actor.build.spirit.name} 准备脱离换人`,
      });
    }
  }
}

function responseMatches(responseKind: string, skill: Skill): boolean {
  if (responseKind === "attack") {
    return isDamageSkill(skill);
  }

  if (responseKind === "status") {
    return skill.category === "status";
  }

  return skill.category === "defense";
}

function getMatchedResponse(
  state: BattleState,
  defenderSide: BattleSide,
  incomingSkill: Skill
): BattleMemberState["responseState"] {
  const response = getActiveMember(state, defenderSide).responseState;

  if (!response || !responseMatches(response.responseKind, incomingSkill)) {
    return undefined;
  }

  return response;
}

function responseHasInterrupt(
  state: BattleState,
  defenderSide: BattleSide,
  incomingSkill: Skill
): boolean {
  const response = getMatchedResponse(state, defenderSide, incomingSkill);

  return Boolean(
    response?.effects.some(
      (effect) => effect.kind === "interrupt" && effect.rawText.includes("应对")
    )
  );
}

function applyResponseEffects(
  state: BattleState,
  defenderSide: BattleSide,
  incomingSkill: Skill,
  damageDealt: number
): boolean {
  const defender = getActiveMember(state, defenderSide);
  const response = getMatchedResponse(state, defenderSide, incomingSkill);

  if (!response) {
    return false;
  }

  let interrupted = false;

  addEvent(state, {
    side: defenderSide,
    actor: defender.build.spirit.name,
    respondedSkill: incomingSkill.name,
    message: `${defender.build.spirit.name} 应对 ${incomingSkill.name} 成功`,
  });

  for (const effect of response.effects) {
    if (!effect.rawText.includes("应对")) {
      continue;
    }

    if (
      effect.kind === "responseWindow" ||
      effect.kind === "damageReduction" ||
      effect.kind === "priorityModifier"
    ) {
      continue;
    }

    if (effect.kind === "interrupt") {
      interrupted = true;
      addEvent(state, {
        side: defenderSide,
        actor: defender.build.spirit.name,
        interrupted: true,
        respondedSkill: incomingSkill.name,
        effect: effect.rawText,
        message: `${defender.build.spirit.name} 打断 ${incomingSkill.name}`,
      });
      continue;
    }

    applyEffect(
      state,
      defenderSide,
      effect,
      damageDealt,
      defender.build.allSkills.find((skill) => skill.id === response.skillId) ?? incomingSkill
    );
  }

  return interrupted;
}

function isPreActionEffect(effect: BattleEffect): boolean {
  return (
    effect.kind === "damageReduction" ||
    effect.kind === "responseWindow"
  );
}

function applyPreActionEffects(
  state: BattleState,
  side: BattleSide,
  skill: Skill
): void {
  for (const effect of collectTriggeredEffects(skill, getActiveMember(state, side).build.allSkills)) {
    if (isPreActionEffect(effect)) {
      applyEffect(state, side, effect, 0, skill);
    }
  }
}

function getDefenseGapPower(table: Array<{ min: number; max?: number; power: number }>, gap: number): number {
  return table.find((item) => gap >= item.min && (item.max === undefined || gap <= item.max))?.power ?? table[table.length - 1].power;
}

function getDynamicPowerSkill(
  actor: BattleMemberState,
  defender: BattleMemberState,
  opponentSwitchedThisTurn: boolean,
  skill: DamageSkill,
  effects: BattleEffect[]
): { skill: DamageSkill; dynamicPower?: number; approximationNote?: string; consumeAllEnergy: boolean } {
  let power = skill.power;
  let dynamicPower: number | undefined;
  let approximationNote: string | undefined;
  let consumeAllEnergy = false;

  for (const effect of effects) {
    if (!effect.simulated) {
      continue;
    }

    if (effect.kind === "dynamicPowerOverride") {
      const table = effect.powerByEnergy ?? MAGIC_BLAST_POWER_BY_ENERGY;
      const index = Math.max(0, Math.min(table.length - 1, Math.floor(actor.energy)));
      dynamicPower = table[index];
      power = dynamicPower;
      approximationNote = effect.approximationNote;
      consumeAllEnergy = true;
      continue;
    }

    if (effect.kind === "powerLossByMissingHp") {
      const missingPercent = ((actor.maxHp - actor.hp) / actor.maxHp) * 100;
      const steps = Math.floor(missingPercent / effect.stepPercent);
      dynamicPower = Math.max(effect.minimumPower ?? 0, power - steps * effect.amountPerStep);
      power = dynamicPower;
      continue;
    }

    if (effect.kind === "defenseGapPowerOverride") {
      const gap = applyStatValues(actor).def - applyStatValues(defender).def;
      dynamicPower = getDefenseGapPower(
        effect.table.length > 0 ? effect.table : SAND_TRAP_DEFENSE_GAP_POWER_TABLE,
        gap
      );
      power = dynamicPower;
      continue;
    }

    if (effect.kind === "powerMultiplierIfOpponentSwitched" && opponentSwitchedThisTurn) {
      dynamicPower = Math.round(power * effect.multiplier);
      power = dynamicPower;
    }
  }

  return {
    skill: {
      ...skill,
      power,
    },
    dynamicPower,
    approximationNote,
    consumeAllEnergy,
  };
}

function shouldSelfFaintAfterUse(effects: BattleEffect[]): boolean {
  return effects.some((effect) => effect.simulated && effect.kind === "selfFaintAfterUse");
}

function faintIfNeeded(state: BattleState, side: BattleSide): void {
  const member = getActiveMember(state, side);

  if (member.hp > 0) {
    return;
  }

  if (!member.fainted) {
    member.hp = 0;
    member.fainted = true;
    addEvent(state, {
      side,
      actor: member.build.spirit.name,
      message: `${member.build.spirit.name} 倒下`,
    });
  }

  const nextIndex = state.teams[side].members.findIndex((item) => !item.fainted);
  if (nextIndex >= 0) {
    state.teams[side].activeIndex = nextIndex;
    addEvent(state, {
      side,
      actor: state.teams[side].members[nextIndex].build.spirit.name,
      action: "switch",
      message: `${side} 自动换上 ${state.teams[side].members[nextIndex].build.spirit.name}`,
    });
    applyEntryEffects(state, side, false);
  }
}

function executeSkill(
  state: BattleState,
  action: Extract<BattleAction, { kind: "useSkill" }>,
  rng: RandomSource
): void {
  const actor = getActiveMember(state, action.side);

  if (actor.fainted) {
    return;
  }

  if ((actor.statuses.freeze ?? 0) > 0 && rng() < 0.25) {
    addEvent(state, {
      side: action.side,
      actor: actor.build.spirit.name,
      message: `${actor.build.spirit.name} 因冻结未能行动`,
    });
    return;
  }

  const defenderSide = otherSide(action.side);
  const defender = getActiveMember(state, defenderSide);
  const skill = getActionSkill(actor, action);

  if (!skill) {
    return;
  }

  const triggeredEffects = collectTriggeredEffects(skill, actor.build.allSkills);
  const actionPriority = getActionPriority(state, action);
  applyPreActionEffects(state, action.side, skill);
  const energyCost = getSkillEnergyCost(actor, skill);
  const firstActionCostReduction = getBurstEnergyCostReduction(actor, skill);
  actor.energy = Math.max(0, actor.energy - energyCost);
  if (!actor.hasUsedFirstAction) {
    actor.hasUsedFirstAction = true;
    if (firstActionCostReduction > 0) {
      addEvent(state, {
        side: action.side,
        actor: actor.build.spirit.name,
        skillName: skill.name,
        temporaryEnergyCost: -firstActionCostReduction,
        effect: "迸发",
        message: `${actor.build.spirit.name} 触发迸发，${skill.name} 本次能耗 -${firstActionCostReduction}`,
      });
    }
  }

  let damageDealt = 0;
  let selfFaintAfterUse = false;

  if (isDamageSkill(skill)) {
    const damageSkill = getModifiedSkill(actor, skill as DamageSkill);
    const typeResult = calculateTypeMultiplier(skill.element, defender.build.spirit.elements);
    const consumeAllEnergy = /消耗所有能量|消耗全部能量/.test(skill.description ?? "");
    const powerFromEnergy = /消耗越高，伤害越高/.test(skill.description ?? "");
    const legacySkillForDamage: DamageSkill =
      consumeAllEnergy && powerFromEnergy
        ? {
            ...damageSkill,
            power: Math.max(damageSkill.power, damageSkill.power + actor.energy * 12),
          }
        : damageSkill;
    const dynamic = getDynamicPowerSkill(
      actor,
      defender,
      state.switchedThisTurn[defenderSide],
      legacySkillForDamage,
      triggeredEffects
    );
    const skillForDamage = dynamic.skill;
    selfFaintAfterUse = shouldSelfFaintAfterUse(triggeredEffects);

    if (consumeAllEnergy || dynamic.consumeAllEnergy) {
      actor.energy = 0;
    }

    const resolved = resolveDamageInput({
      skill: skillForDamage,
      attackerStats: applyStatValues(actor),
      defenderStats: applyStatValues(defender),
      stabMultiplier: getStabMultiplier(actor.build.spirit, skill),
      typeMultiplier: typeResult.multiplier,
      state: createDefaultBattleModifierState(),
      rules: [
        ...parseSkillRules(skill),
        ...createSkillEffectRules(damageSkill, actor.build.allSkills),
        ...getTraitRules(actor.build.spirit),
      ],
    });
    const damage = calculateDamage(resolved.input);
    const interruptedBeforeDamage = responseHasInterrupt(state, defenderSide, skill);
    const reducedDamage = Math.round(damage.damage * defender.damageReduction);
    damageDealt = interruptedBeforeDamage
      ? 0
      : Math.min(defender.hp, Math.max(0, damage.damage - reducedDamage));
    defender.hp = Math.max(0, defender.hp - damageDealt);
    addEvent(state, {
      side: action.side,
      actor: actor.build.spirit.name,
      action: "useSkill",
      skillName: skill.name,
      target: defender.build.spirit.name,
      damage: damageDealt,
      priority: actionPriority || undefined,
      dynamicPower: dynamic.dynamicPower,
      reducedDamage: reducedDamage > 0 ? reducedDamage : undefined,
      interrupted: interruptedBeforeDamage || undefined,
      approximationNote: dynamic.approximationNote,
      message: `${actor.build.spirit.name} 使用 ${skill.name}，造成 ${damageDealt} 伤害${
        interruptedBeforeDamage ? "（被打断）" : reducedDamage > 0 ? `（减免 ${reducedDamage}）` : ""
      }`,
    });
    applyResponseEffects(state, defenderSide, skill, damageDealt);
    faintIfNeeded(state, defenderSide);
  } else {
    addEvent(state, {
      side: action.side,
      actor: actor.build.spirit.name,
      action: "useSkill",
      skillName: skill.name,
      target: defender.build.spirit.name,
      message: `${actor.build.spirit.name} 使用 ${skill.name}`,
    });
  }

  for (const effect of triggeredEffects) {
    if (effect.rawText.includes("每次入场")) {
      continue;
    }

    if (isPreActionEffect(effect)) {
      continue;
    }

    if (effect.rawText.includes("应对")) {
      continue;
    }

    applyEffect(state, action.side, effect, damageDealt, skill);
  }

  if (selfFaintAfterUse && !actor.fainted) {
    actor.hp = 0;
    addEvent(state, {
      side: action.side,
      actor: actor.build.spirit.name,
      skillName: skill.name,
      selfFaintedAfterUse: true,
      effect: skill.rawEffectText ?? skill.description,
      message: `${actor.build.spirit.name} 使用 ${skill.name} 后倒下`,
    });
    faintIfNeeded(state, action.side);
  }

  if (actor.pendingSwitch !== undefined && !actor.fainted) {
    const switchIndex = actor.pendingSwitch;
    actor.pendingSwitch = undefined;
    switchActive(state, { kind: "switch", side: action.side, memberIndex: switchIndex });
  }

  faintIfNeeded(state, defenderSide);
}

function applyEndTurnStatuses(state: BattleState): void {
  for (const side of SIDES) {
    const member = getActiveMember(state, side);
    if (member.fainted) {
      continue;
    }

    const poison = member.statuses.poison ?? 0;
    const burn = member.statuses.burn ?? 0;
    const damage = Math.floor(member.maxHp * poison * 0.03) + Math.round(member.maxHp * burn * 0.02);

    if (damage > 0) {
      member.hp = Math.max(0, member.hp - damage);
      addEvent(state, {
        side,
        actor: member.build.spirit.name,
        damage,
        effect: "status",
        message: `${member.build.spirit.name} 受到状态伤害 ${damage}`,
      });
      faintIfNeeded(state, side);
    }

    if (burn > 0) {
      member.statuses.burn = Math.max(0, burn - Math.max(1, Math.ceil(burn / 2)));
    }

    const photosynthesisEnergy = getPhotosynthesisEnergyGain(member);
    if (photosynthesisEnergy > 0) {
      member.energy += photosynthesisEnergy;
      addEvent(state, {
        side,
        actor: member.build.spirit.name,
        energyChange: photosynthesisEnergy,
        termTriggered: TERM_MARKS.photosynthesis,
        effect: TERM_MARKS.photosynthesis,
        message: `${member.build.spirit.name} 触发光合，能量 +${photosynthesisEnergy}`,
      });
    }
  }
}

function applyTurn(
  state: BattleState,
  actionA: BattleAction,
  actionB: BattleAction,
  rng: RandomSource
): BattleState {
  const next = cloneState(state);
  resetTurnState(next);
  next.switchedThisTurn = {
    A: false,
    B: false,
  };

  for (const action of [actionA, actionB]) {
    if (action.kind === "switch") {
      switchActive(next, action);
    }
  }

  const skillActions = [actionA, actionB]
    .filter((action): action is Extract<BattleAction, { kind: "useSkill" }> => action.kind === "useSkill")
    .sort((left, right) => {
      const priorityDelta = getActionPriority(next, right) - getActionPriority(next, left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const speedDelta = getActionSpeed(next, right) - getActionSpeed(next, left);
      return speedDelta !== 0 ? speedDelta : left.side.localeCompare(right.side);
    });

  for (const action of skillActions) {
    if (getWinner(next)) {
      break;
    }
    executeSkill(next, action, rng);
  }

  applyEndTurnStatuses(next);
  next.turn += 1;
  return next;
}

export function applyBattleTurn(
  state: BattleState,
  actionA: BattleAction,
  actionB: BattleAction,
  seed = 20260515
): BattleState {
  return applyTurn(state, actionA, actionB, createRng(seed));
}

function remainingHpRatio(state: BattleState, side: BattleSide): number {
  const members = state.teams[side].members;
  const current = members.reduce((sum, member) => sum + member.hp, 0);
  const max = members.reduce((sum, member) => sum + member.maxHp, 0);
  return max > 0 ? current / max : 0;
}

function evaluateForSide(state: BattleState, side: BattleSide): number {
  const winner = getWinner(state);

  if (winner === side) {
    return 1;
  }

  if (winner === otherSide(side)) {
    return 0;
  }

  const delta = remainingHpRatio(state, side) - remainingHpRatio(state, otherSide(side));
  return Math.max(0, Math.min(1, 0.5 + delta * 0.5));
}

function pickRandom<T>(items: T[], rng: RandomSource): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function actionHeuristicScore(state: BattleState, action: BattleAction): number {
  if (action.kind === "switch") {
    const active = getActiveMember(state, action.side);
    const target = state.teams[action.side].members[action.memberIndex];
    return active.hp / active.maxHp < 0.25 ? target.hp / target.maxHp + 0.3 : 0.05;
  }

  const actor = getActiveMember(state, action.side);
  const defender = getActiveMember(state, otherSide(action.side));
  const skill = getActionSkill(actor, action);

  if (!skill) {
    return 0;
  }

  if (!isDamageSkill(skill)) {
    const effectScore = (skill.parsedEffects ?? []).reduce((sum, effect) => {
      if (effect.kind === "damageReduction") {
        return sum + effect.rate * 90;
      }

      if (effect.kind === "responseWindow") {
        return sum + 28;
      }

      if (effect.kind === "energyDelta" || effect.kind === "permanentEnergyCostModifier") {
        return sum + Math.abs(effect.amount) * 8;
      }

      if (effect.kind === "switch") {
        return sum + (actor.hp / actor.maxHp < 0.4 ? 35 : 8);
      }

      return sum + 4;
    }, 0);
    return effectScore;
  }

  const typeResult = calculateTypeMultiplier(skill.element, defender.build.spirit.elements);
  const baseDamage = skill.power + Math.max(actor.build.actualStats.atk, actor.build.actualStats.spa) * 0.2;
  const killBonus = defender.hp < baseDamage * typeResult.multiplier ? 55 : 0;
  const energyPressure = Math.max(0, INITIAL_ENERGY - defender.energy) * 3;
  return baseDamage * typeResult.multiplier + killBonus + energyPressure + (actor.build.actualStats.spe >= defender.build.actualStats.spe ? 20 : 0);
}

function pickHeuristicAction(state: BattleState, side: BattleSide, rng: RandomSource): BattleAction {
  const actions = listLegalActions(state, side);

  if (actions.length === 0) {
    return { kind: "switch", side, memberIndex: state.teams[side].activeIndex };
  }

  if (rng() < 0.18) {
    return pickRandom(actions, rng);
  }

  return [...actions].sort((left, right) => {
    const delta = actionHeuristicScore(state, right) - actionHeuristicScore(state, left);
    return delta !== 0 ? delta : JSON.stringify(left).localeCompare(JSON.stringify(right));
  })[0];
}

function rollout(
  state: BattleState,
  rootSide: BattleSide,
  config: MctsConfig,
  rng: RandomSource
): number {
  let current = cloneState(state);
  const targetTurn = Math.min(config.maxTurns, current.turn + config.rolloutDepth);

  while (!getWinner(current) && current.turn <= targetTurn) {
    current = applyTurn(
      current,
      pickHeuristicAction(current, "A", rng),
      pickHeuristicAction(current, "B", rng),
      rng
    );
  }

  return evaluateForSide(current, rootSide);
}

function selectChild(children: MctsChild[], exploration: number): MctsChild {
  const totalVisits = children.reduce((sum, child) => sum + child.visits, 0) + 1;
  const unvisited = children.find((child) => child.visits === 0);

  if (unvisited) {
    return unvisited;
  }

  return [...children].sort((left, right) => {
    const leftScore =
      left.value / left.visits + exploration * Math.sqrt(Math.log(totalVisits) / left.visits);
    const rightScore =
      right.value / right.visits + exploration * Math.sqrt(Math.log(totalVisits) / right.visits);
    return rightScore - leftScore;
  })[0];
}

function chooseMctsAction(
  state: BattleState,
  side: BattleSide,
  config: MctsConfig,
  rng: RandomSource
): BattleAction {
  const actions = listLegalActions(state, side);

  if (actions.length === 0) {
    return { kind: "switch", side, memberIndex: state.teams[side].activeIndex };
  }

  const children = actions.map((action) => ({ action, visits: 0, value: 0 }));

  for (let index = 0; index < config.iterations; index += 1) {
    const child = selectChild(children, config.exploration);
    const opponentAction = pickHeuristicAction(state, otherSide(side), rng);
    const actionA = side === "A" ? child.action : opponentAction;
    const actionB = side === "B" ? child.action : opponentAction;
    const nextState = applyTurn(state, actionA, actionB, rng);
    const reward = rollout(nextState, side, config, rng);
    child.visits += 1;
    child.value += reward;
  }

  return [...children].sort((left, right) => {
    const delta = right.value / Math.max(1, right.visits) - left.value / Math.max(1, left.visits);
    return delta !== 0 ? delta : JSON.stringify(left.action).localeCompare(JSON.stringify(right.action));
  })[0].action;
}

function collectUnmodeledEffects(teams: CombatantBuild[][]): string[] {
  const effects = new Set<string>();

  for (const team of teams) {
    for (const member of team) {
      for (const skill of member.allSkills) {
        for (const note of skill.unparsedEffectNotes ?? []) {
          effects.add(`${skill.name}：${note}`);
        }
      }
    }
  }

  return [...effects].sort((left, right) => left.localeCompare(right));
}

export function simulateBattle(
  teamA: CombatantBuild[],
  teamB: CombatantBuild[],
  config: MctsConfig
): SimulatedBattleResult {
  const rng = createRng(config.seed);
  let state = createInitialBattleState(teamA, teamB);

  while (!getWinner(state) && state.turn <= config.maxTurns) {
    const actionA = chooseMctsAction(state, "A", config, rng);
    const actionB = chooseMctsAction(state, "B", config, rng);
    state = applyTurn(state, actionA, actionB, rng);
  }

  const winner = getWinner(state);
  const remainingHpA = remainingHpRatio(state, "A");
  const remainingHpB = remainingHpRatio(state, "B");

  return {
    winner:
      winner ??
      (remainingHpA === remainingHpB
        ? undefined
        : remainingHpA > remainingHpB
          ? "A"
          : "B"),
    turns: state.turn - 1,
    scoreA: evaluateForSide(state, "A"),
    scoreB: evaluateForSide(state, "B"),
    remainingHpA,
    remainingHpB,
    events: state.events,
    unmodeledEffects: collectUnmodeledEffects([teamA, teamB]),
  };
}

export const DEFAULT_MCTS_CONFIG: MctsConfig = {
  seed: 20260515,
  iterations: 14,
  rolloutDepth: 6,
  maxTurns: 18,
  exploration: 1.2,
};
