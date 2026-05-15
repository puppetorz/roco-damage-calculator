import { pvpLineups } from "../src/data/pvpLineups";
import { spirits } from "../src/data/spirits";
import type { CombatantBuild, IndividualValues, StatKey } from "../src/types/battle";
import { DEFAULT_MCTS_CONFIG, simulateBattle } from "../src/utils/battleSimulator";
import { createCombatantBuild } from "../src/utils/combatantBuilder";
import {
  DEFAULT_INDIVIDUAL_VALUES,
  PERFECT_IV_VALUE,
  STAT_KEYS,
} from "../src/utils/statCalculator";

const spiritById = new Map(spirits.map((spirit) => [spirit.id, spirit]));

function createIvs(keys: StatKey[]): IndividualValues {
  const selected = new Set(keys.slice(0, 3));

  return STAT_KEYS.reduce((values, key) => {
    values[key] = selected.has(key) ? PERFECT_IV_VALUE : 0;
    return values;
  }, { ...DEFAULT_INDIVIDUAL_VALUES });
}

function createTeam(lineupIndex: number): CombatantBuild[] {
  const lineup = pvpLineups[lineupIndex];

  if (!lineup) {
    throw new Error(`找不到阵容索引 ${lineupIndex}`);
  }

  return lineup.members
    .map((member) => {
      const spirit = member.spiritId ? spiritById.get(member.spiritId) : undefined;
      return spirit
        ? createCombatantBuild(spirit, {
            natureId: member.natureId,
            individualValues: createIvs(member.individualKeys),
            skillIds: member.skillIds,
          })
        : undefined;
    })
    .filter((build): build is CombatantBuild => Boolean(build))
    .slice(0, 6);
}

const teamA = createTeam(0);
const teamB = createTeam(1);

if (teamA.length !== 6 || teamB.length !== 6) {
  throw new Error("固定 smoke 对局需要两个完整的 6 人阵容。");
}

const result = simulateBattle(teamA, teamB, {
  ...DEFAULT_MCTS_CONFIG,
  seed: 20260515,
  iterations: 10,
  rolloutDepth: 5,
  maxTurns: 16,
});

console.log(
  JSON.stringify(
    {
      winner: result.winner,
      turns: result.turns,
      remainingHpA: result.remainingHpA,
      remainingHpB: result.remainingHpB,
      firstEvents: result.events.slice(0, 12),
      unmodeledEffects: result.unmodeledEffects.slice(0, 20),
    },
    null,
    2
  )
);
