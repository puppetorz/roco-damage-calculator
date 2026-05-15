import { spirits } from "../data/spirits";
import type {
  CombatantBuild,
  DamageSkill,
  MatchupScore,
  TeamMemberScore,
  TeamScore,
  TeamSearchOptions,
  TeamSearchResult,
} from "../types/battle";
import { calculateDamage } from "./damageCalculator";
import {
  createCombatantBuild,
  getStabMultiplier,
  getTraitRules,
} from "./combatantBuilder";
import {
  createDefaultBattleModifierState,
  resolveDamageInput,
} from "./damageResolver";
import { parseSkillRules } from "./effectRuleParser";
import { createSkillEffectRules } from "./skillEffectRules";
import { calculateTypeMultiplier } from "./typeCalculator";

const DEFAULT_TEAM_SIZE = 6;
const DEFAULT_BEAM_WIDTH = 64;
const BEST_MATCHUP_COUNT = 3;
const WORST_MATCHUP_COUNT = 3;
const MAX_CANDIDATE_LIMIT = 80;
const MAX_ENVIRONMENT_SIZE = 80;

type MatchupReader = (attacker: CombatantBuild, defender: CombatantBuild) => MatchupScore;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampSearchCount(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(1, Math.round(value)));
}

function compareByScore<T extends { score: number }>(left: T, right: T): number {
  return right.score - left.score;
}

function compareBuildById(left: CombatantBuild, right: CombatantBuild): number {
  return left.spirit.id.localeCompare(right.spirit.id);
}

function getAverageUsageWeight(
  members: CombatantBuild[],
  usageWeights: Record<string, number> | undefined
): number {
  if (!usageWeights) {
    return 0;
  }

  return average(members.map((member) => usageWeights[member.spirit.id] ?? 0));
}

function getAverageSynergy(
  members: CombatantBuild[],
  teammateSynergy: Record<string, Record<string, number>> | undefined
): number {
  if (!teammateSynergy || members.length < 2) {
    return 0;
  }

  const values: number[] = [];

  for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
      const leftId = members[leftIndex].spirit.id;
      const rightId = members[rightIndex].spirit.id;
      values.push(
        teammateSynergy[leftId]?.[rightId] ??
          teammateSynergy[rightId]?.[leftId] ??
          0
      );
    }
  }

  return average(values);
}

function getSkillDamage(
  attacker: CombatantBuild,
  defender: CombatantBuild,
  skill: DamageSkill
) {
  const typeResult = calculateTypeMultiplier(skill.element, defender.spirit.elements);
  const resolved = resolveDamageInput({
    skill,
    attackerStats: attacker.actualStats,
    defenderStats: defender.actualStats,
    stabMultiplier: getStabMultiplier(attacker.spirit, skill),
    typeMultiplier: typeResult.multiplier,
    state: createDefaultBattleModifierState(),
    rules: [
      ...parseSkillRules(skill),
      ...createSkillEffectRules(skill, attacker.allSkills),
      ...getTraitRules(attacker.spirit),
    ],
  });

  return {
    typeMultiplier: typeResult.multiplier,
    damageResult: calculateDamage(resolved.input),
  };
}

export function scoreMatchup(
  attacker: CombatantBuild,
  defender: CombatantBuild
): MatchupScore {
  const scoredSkills = attacker.skills.map((skill) => {
    const { typeMultiplier, damageResult } = getSkillDamage(attacker, defender, skill);
    const speedAdvantage = attacker.actualStats.spe >= defender.actualStats.spe;
    const killPressure =
      damageResult.damage >= defender.actualStats.hp
        ? 35
        : damageResult.hpPercent >= 70
          ? 18
          : damageResult.hpPercent >= 40
            ? 8
            : 0;
    const typeScore = Math.max(-8, (typeMultiplier - 1) * 14);
    const speedScore = speedAdvantage ? 8 : -4;
    const score =
      Math.min(125, damageResult.hpPercent) +
      killPressure +
      typeScore +
      speedScore;

    return {
      attackerId: attacker.spirit.id,
      defenderId: defender.spirit.id,
      bestSkill: skill,
      damage: damageResult.damage,
      hpPercent: damageResult.hpPercent,
      typeMultiplier,
      speedAdvantage,
      killPressure,
      score,
    };
  });

  return scoredSkills.sort((left, right) => {
    const scoreDelta = right.score - left.score;
    return scoreDelta !== 0 ? scoreDelta : left.bestSkill.id.localeCompare(right.bestSkill.id);
  })[0];
}

function createMatchupReader(): MatchupReader {
  const cache = new Map<string, MatchupScore>();

  return (attacker, defender) => {
    const key = `${attacker.spirit.id}->${defender.spirit.id}`;
    const cached = cache.get(key);

    if (cached) {
      return cached;
    }

    const score = scoreMatchup(attacker, defender);
    cache.set(key, score);
    return score;
  };
}

function createAllCandidateBuilds(): CombatantBuild[] {
  return spirits
    .map((spirit) => createCombatantBuild(spirit))
    .filter((build): build is CombatantBuild => Boolean(build))
    .sort(compareBuildById);
}

function calculateQuickBuildScore(build: CombatantBuild): number {
  const primaryAttack = Math.max(build.actualStats.atk, build.actualStats.spa);
  const bulk = build.actualStats.hp + build.actualStats.def + build.actualStats.spd;
  const skillPower = Math.max(...build.skills.map((skill) => skill.power));
  const elementBreadth = new Set(build.skills.map((skill) => skill.element)).size;

  return (
    primaryAttack * 0.35 +
    bulk * 0.18 +
    build.actualStats.spe * 0.26 +
    skillPower * 0.12 +
    elementBreadth * 8
  );
}

function createMemberScore(
  build: CombatantBuild,
  environment: CombatantBuild[],
  readMatchup: MatchupReader
): TeamMemberScore {
  const outgoing = environment
    .filter((defender) => defender.spirit.id !== build.spirit.id)
    .map((defender) => readMatchup(build, defender));
  const incoming = environment
    .filter((attacker) => attacker.spirit.id !== build.spirit.id)
    .map((attacker) => readMatchup(attacker, build));
  const outgoingAverage = average(outgoing.map((item) => item.score));
  const incomingDanger = average(incoming.map((item) => Math.min(125, item.hpPercent)));
  const averageScore = outgoingAverage - incomingDanger * 0.22;
  const bestMatchups = [...outgoing].sort(compareByScore).slice(0, BEST_MATCHUP_COUNT);
  const worstMatchups = [...incoming]
    .sort((left, right) => right.hpPercent - left.hpPercent)
    .slice(0, WORST_MATCHUP_COUNT);

  return {
    build,
    averageScore,
    bestMatchups,
    worstMatchups,
    role: getRoleLabel(build, averageScore),
  };
}

function getRoleLabel(build: CombatantBuild, averageScore: number): string {
  const primaryAttack = Math.max(build.actualStats.atk, build.actualStats.spa);
  const bulk = build.actualStats.hp + build.actualStats.def + build.actualStats.spd;

  if (build.actualStats.spe >= 270 && averageScore >= 70) {
    return "高速压制";
  }

  if (primaryAttack >= 260) {
    return "爆发输出";
  }

  if (bulk >= 900) {
    return "厚度支点";
  }

  return "均衡补盲";
}

function getTeamElementPenalty(members: CombatantBuild[]): number {
  const elementCounts = new Map<string, number>();

  for (const member of members) {
    for (const element of member.spirit.elements) {
      elementCounts.set(element, (elementCounts.get(element) ?? 0) + 1);
    }
  }

  return [...elementCounts.values()].reduce((penalty, count) => {
    return count > 2 ? penalty + (count - 2) * 8 : penalty;
  }, 0);
}

function getTeamCoverage(
  members: CombatantBuild[],
  environment: CombatantBuild[],
  readMatchup: MatchupReader
): { score: number; covered: number; bestByDefender: MatchupScore[] } {
  const bestByDefender = environment.map((defender) => {
    return members
      .filter((member) => member.spirit.id !== defender.spirit.id)
      .map((member) => readMatchup(member, defender))
      .sort(compareByScore)[0];
  });
  const validBest = bestByDefender.filter(
    (score): score is MatchupScore => Boolean(score)
  );
  const covered = validBest.filter(
    (matchup) => matchup.hpPercent >= 70 || matchup.typeMultiplier > 1
  ).length;
  const score =
    average(validBest.map((matchup) => Math.min(125, matchup.hpPercent))) +
    (covered / Math.max(1, environment.length)) * 25;

  return { score, covered, bestByDefender: validBest };
}

function getTeamWeakness(
  members: CombatantBuild[],
  environment: CombatantBuild[],
  readMatchup: MatchupReader
): { penalty: number; weaknesses: string[] } {
  const weaknessRows = environment.map((attacker) => {
    const dangerousHits = members
      .filter((member) => member.spirit.id !== attacker.spirit.id)
      .map((member) => readMatchup(attacker, member))
      .filter((matchup) => matchup.hpPercent >= 70 || matchup.typeMultiplier > 1);
    const pressure = average(dangerousHits.map((matchup) => matchup.hpPercent));

    return {
      attacker,
      dangerousCount: dangerousHits.length,
      pressure,
      penalty: dangerousHits.length * 7 + Math.max(0, pressure - 80) * 0.25,
    };
  });

  const sorted = weaknessRows
    .filter((row) => row.dangerousCount >= 2)
    .sort((left, right) => right.penalty - left.penalty);

  return {
    penalty: average(weaknessRows.map((row) => row.penalty)),
    weaknesses: sorted
      .slice(0, 4)
      .map((row) => `${row.attacker.spirit.name} 可威胁 ${row.dangerousCount} 位`),
  };
}

function evaluateTeam(
  members: CombatantBuild[],
  environment: CombatantBuild[],
  memberScoreMap: Map<string, TeamMemberScore>,
  readMatchup: MatchupReader,
  usageWeights?: Record<string, number>,
  teammateSynergy?: Record<string, Record<string, number>>
): TeamScore {
  const memberScores = members.map((member) => memberScoreMap.get(member.spirit.id)!);
  const memberAverage = average(memberScores.map((member) => member.averageScore));
  const coverage = getTeamCoverage(members, environment, readMatchup);
  const weakness = getTeamWeakness(members, environment, readMatchup);
  const speedThreshold = average(environment.map((build) => build.actualStats.spe));
  const speedScore =
    (members.filter((member) => member.actualStats.spe >= speedThreshold).length /
      members.length) *
    24;
  const diversityPenalty = getTeamElementPenalty(members);
  const usageScore = getAverageUsageWeight(members, usageWeights);
  const synergyScore = getAverageSynergy(members, teammateSynergy);
  const score =
    memberAverage * 0.42 +
    coverage.score * 0.46 +
    speedScore -
    weakness.penalty * 0.35 -
    diversityPenalty +
    usageScore +
    synergyScore;
  const strongestCoverage = coverage.bestByDefender
    .sort(compareByScore)
    .slice(0, 3)
    .map((matchup) => {
      return (
        environment.find((build) => build.spirit.id === matchup.defenderId)?.spirit
          .name ?? matchup.defenderId
      );
    });

  return {
    members: memberScores,
    score,
    coverageScore: coverage.score,
    weaknessPenalty: weakness.penalty + diversityPenalty,
    speedScore,
    reasons: createTeamReasons(
      members,
      coverage.covered,
      environment.length,
      strongestCoverage,
      usageScore,
      synergyScore
    ),
    weaknesses: weakness.weaknesses,
  };
}

function createTeamReasons(
  members: CombatantBuild[],
  covered: number,
  environmentSize: number,
  strongestCoverage: string[],
  usageScore = 0,
  synergyScore = 0
): string[] {
  const roles = new Map<string, number>();

  for (const member of members) {
    const role = getRoleLabel(member, 0);
    roles.set(role, (roles.get(role) ?? 0) + 1);
  }

  const reasons = [
    `覆盖 ${covered}/${environmentSize} 个环境对位`,
    `速度线 ${members
      .map((member) => member.actualStats.spe)
      .sort((left, right) => right - left)
      .slice(0, 3)
      .join(" / ")}`,
    `定位 ${[...roles.entries()].map(([role, count]) => `${role}x${count}`).join("、")}`,
    strongestCoverage.length > 0
      ? `高压对位 ${strongestCoverage.join("、")}`
      : "高压对位不足，建议扩大候选池",
  ];

  if (usageScore > 0) {
    reasons.push(`环境使用率加权 +${usageScore.toFixed(1)}`);
  }

  if (synergyScore > 0) {
    reasons.push(`常见队友协同 +${synergyScore.toFixed(1)}`);
  }

  return reasons;
}

function createTeamKey(members: CombatantBuild[]): string {
  return members
    .map((member) => member.spirit.id)
    .sort()
    .join("|");
}

export function searchBestTeams(options: TeamSearchOptions): TeamSearchResult {
  const candidateLimit = clampSearchCount(
    options.candidateLimit,
    36,
    MAX_CANDIDATE_LIMIT
  );
  const outputCount = clampSearchCount(options.outputCount, 3, 10);
  const environmentSize = clampSearchCount(
    options.environmentSize,
    30,
    MAX_ENVIRONMENT_SIZE
  );
  const teamSize = clampSearchCount(options.teamSize ?? DEFAULT_TEAM_SIZE, 6, 6);
  const beamWidth = clampSearchCount(
    options.beamWidth ?? DEFAULT_BEAM_WIDTH,
    DEFAULT_BEAM_WIDTH,
    160
  );
  const allCandidates = (options.candidates ?? createAllCandidateBuilds()).sort(
    compareBuildById
  );
  const quickRanked = [...allCandidates].sort((left, right) => {
    const scoreDelta =
      calculateQuickBuildScore(right) +
      (options.usageWeights?.[right.spirit.id] ?? 0) -
      (calculateQuickBuildScore(left) + (options.usageWeights?.[left.spirit.id] ?? 0));
    return scoreDelta !== 0 ? scoreDelta : compareBuildById(left, right);
  });
  const environment = (options.environment ?? quickRanked).slice(
    0,
    Math.min(environmentSize, options.environment?.length ?? quickRanked.length)
  );
  const readMatchup = createMatchupReader();
  const preliminaryScores = allCandidates.map((build) =>
    createMemberScore(build, environment, readMatchup)
  );
  const candidates = preliminaryScores
    .sort((left, right) => {
      const scoreDelta =
        right.averageScore +
        (options.usageWeights?.[right.build.spirit.id] ?? 0) -
        (left.averageScore + (options.usageWeights?.[left.build.spirit.id] ?? 0));
      return scoreDelta !== 0 ? scoreDelta : compareBuildById(left.build, right.build);
    })
    .slice(0, Math.min(candidateLimit, preliminaryScores.length))
    .map((score) => score.build)
    .sort(compareBuildById);
  const memberScoreMap = new Map(
    candidates.map((build) => [
      build.spirit.id,
      createMemberScore(build, environment, readMatchup),
    ])
  );
  let beam: TeamScore[] = candidates.map((candidate) =>
    evaluateTeam(
      [candidate],
      environment,
      memberScoreMap,
      readMatchup,
      options.usageWeights,
      options.teammateSynergy
    )
  );

  beam = beam.sort(compareByScore).slice(0, beamWidth);

  for (let size = 2; size <= teamSize; size += 1) {
    const nextTeams = new Map<string, TeamScore>();

    for (const partial of beam) {
      const existingIds = new Set(
        partial.members.map((member) => member.build.spirit.id)
      );

      for (const candidate of candidates) {
        if (existingIds.has(candidate.spirit.id)) {
          continue;
        }

        const members = [...partial.members.map((member) => member.build), candidate];
        const key = createTeamKey(members);

        if (nextTeams.has(key)) {
          continue;
        }

        nextTeams.set(
          key,
          evaluateTeam(
            members,
            environment,
            memberScoreMap,
            readMatchup,
            options.usageWeights,
            options.teammateSynergy
          )
        );
      }
    }

    beam = [...nextTeams.values()].sort(compareByScore).slice(0, beamWidth);
  }

  return {
    candidates,
    environment,
    teams: beam.sort(compareByScore).slice(0, outputCount),
  };
}
