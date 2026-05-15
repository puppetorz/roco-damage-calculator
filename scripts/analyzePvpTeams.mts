import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { pvpLineups } from "../src/data/pvpLineups";
import { skills } from "../src/data/skills";
import { spirits } from "../src/data/spirits";
import type {
  AdvancedTeamRecommendation,
  CombatantBuild,
  IndividualValues,
  PvpLineup,
  StatKey,
  UsageStats,
} from "../src/types/battle";
import { createCombatantBuild, isDamageSkill } from "../src/utils/combatantBuilder";
import { searchBestTeams } from "../src/utils/teamAi";
import {
  DEFAULT_INDIVIDUAL_VALUES,
  PERFECT_IV_VALUE,
  STAT_KEYS,
} from "../src/utils/statCalculator";
import { runSelfPlayTournament } from "../src/utils/teamSelfPlay";
import { LCX_TERMS_SOURCE_URL, TERM_RULES } from "../src/utils/termRules";

type CountMap = Record<string, number>;

type SpiritUsageProfile = {
  spiritId: string;
  count: number;
  skillCounts: CountMap;
  natureCounts: CountMap;
  individualCounts: CountMap;
  teammateCounts: CountMap;
};

const root = process.cwd();
const reportPath = join(root, "pvp-team-ai-report.md");
const resultPath = join(root, "pvp-team-ai-result.json");
const spiritById = new Map(spirits.map((spirit) => [spirit.id, spirit]));
const skillById = new Map(skills.map((skill) => [skill.id, skill]));

function addCount(target: CountMap, key: string | undefined, amount = 1): void {
  if (!key) {
    return;
  }

  target[key] = (target[key] ?? 0) + amount;
}

function getTopEntries(target: CountMap, limit: number): Array<[string, number]> {
  return Object.entries(target)
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    })
    .slice(0, limit);
}

function getTopKey(target: CountMap): string | undefined {
  return getTopEntries(target, 1)[0]?.[0];
}

function createEmptyProfile(spiritId: string): SpiritUsageProfile {
  return {
    spiritId,
    count: 0,
    skillCounts: {},
    natureCounts: {},
    individualCounts: {},
    teammateCounts: {},
  };
}

function createIvsFromKeyString(value: string | undefined): IndividualValues {
  const keys = new Set(
    (value ?? "")
      .split("/")
      .map((key) => key.trim())
      .filter((key): key is StatKey => STAT_KEYS.includes(key as StatKey))
      .slice(0, 3)
  );

  return STAT_KEYS.reduce((ivs, key) => {
    ivs[key] = keys.has(key) ? PERFECT_IV_VALUE : 0;
    return ivs;
  }, { ...DEFAULT_INDIVIDUAL_VALUES });
}

function createIndividualKeyString(keys: StatKey[]): string {
  return [...new Set(keys)].slice(0, 3).join("/");
}

function collectUsageStats(lineups: PvpLineup[]) {
  const profiles = new Map<string, SpiritUsageProfile>();

  for (const lineup of lineups) {
    const memberIds = lineup.members
      .map((member) => member.spiritId)
      .filter((spiritId): spiritId is string => Boolean(spiritId));

    for (const member of lineup.members) {
      if (!member.spiritId) {
        continue;
      }

      const profile =
        profiles.get(member.spiritId) ?? createEmptyProfile(member.spiritId);
      profile.count += 1;

      for (const skillId of member.skillIds) {
        addCount(profile.skillCounts, skillId);
      }

      addCount(profile.natureCounts, member.natureId);
      addCount(profile.individualCounts, createIndividualKeyString(member.individualKeys));

      for (const teammateId of memberIds) {
        if (teammateId !== member.spiritId) {
          addCount(profile.teammateCounts, teammateId);
        }
      }

      profiles.set(member.spiritId, profile);
    }
  }

  return profiles;
}

function buildUsageStats(
  lineups: PvpLineup[],
  profiles: Map<string, SpiritUsageProfile>
): UsageStats {
  return {
    lineupCount: lineups.length,
    spiritUsage: Object.fromEntries(
      [...profiles.values()].map((profile) => [profile.spiritId, profile.count])
    ),
    skillUsageBySpirit: Object.fromEntries(
      [...profiles.values()].map((profile) => [profile.spiritId, profile.skillCounts])
    ),
    natureUsageBySpirit: Object.fromEntries(
      [...profiles.values()].map((profile) => [profile.spiritId, profile.natureCounts])
    ),
    individualUsageBySpirit: Object.fromEntries(
      [...profiles.values()].map((profile) => [
        profile.spiritId,
        profile.individualCounts,
      ])
    ),
    teammateUsage: Object.fromEntries(
      [...profiles.values()].map((profile) => [profile.spiritId, profile.teammateCounts])
    ),
  };
}

function createCandidateBuild(profile: SpiritUsageProfile): CombatantBuild | undefined {
  const spirit = spiritById.get(profile.spiritId);
  if (!spirit) {
    return undefined;
  }

  const skillIds = getTopEntries(profile.skillCounts, 4).map(([skillId]) => skillId);
  const individualValues = createIvsFromKeyString(getTopKey(profile.individualCounts));

  return createCombatantBuild(spirit, {
    natureId: getTopKey(profile.natureCounts),
    individualValues,
    skillIds,
  });
}

function createUsageWeights(profiles: Map<string, SpiritUsageProfile>): Record<string, number> {
  const maxCount = Math.max(...[...profiles.values()].map((profile) => profile.count), 1);

  return Object.fromEntries(
    [...profiles.values()].map((profile) => [
      profile.spiritId,
      (profile.count / maxCount) * 24,
    ])
  );
}

function createTeammateSynergy(
  profiles: Map<string, SpiritUsageProfile>
): Record<string, Record<string, number>> {
  const maxCount = Math.max(
    ...[...profiles.values()].flatMap((profile) =>
      Object.values(profile.teammateCounts)
    ),
    1
  );

  return Object.fromEntries(
    [...profiles.values()].map((profile) => [
      profile.spiritId,
      Object.fromEntries(
        Object.entries(profile.teammateCounts).map(([teammateId, count]) => [
          teammateId,
          (count / maxCount) * 10,
        ])
      ),
    ])
  );
}

function getCommonSkillNames(profile: SpiritUsageProfile, limit = 4): string[] {
  return getTopEntries(profile.skillCounts, limit).map(([skillId, count]) => {
    const skill = skillById.get(skillId);
    const suffix = skill && isDamageSkill(skill) ? "伤害" : "机制";
    return `${skill?.name ?? skillId}x${count}(${suffix})`;
  });
}

function getSpiritName(spiritId: string): string {
  return spiritById.get(spiritId)?.name ?? spiritId;
}

function getTeamMatrixLabel(
  advanced: AdvancedTeamRecommendation,
  teamId: string
): string {
  const recommended = advanced.teams.find((team) => team.teamId === teamId);
  if (recommended) {
    return `推荐${recommended.rank}`;
  }

  const candidateIndex = advanced.candidates.indexOf(teamId);
  if (candidateIndex >= 0) {
    return `候选${candidateIndex + 1}`;
  }

  return teamId.slice(0, 16);
}

function getSkillCoverage(skill: { parsedEffects?: { simulated: boolean }[]; unparsedEffectNotes?: string[] }) {
  const simulated = (skill.parsedEffects ?? []).filter((effect) => effect.simulated).length;
  const unmodeled = skill.unparsedEffectNotes?.length ?? 0;

  if (simulated > 0 && unmodeled === 0) {
    return "已完整模拟";
  }

  if (simulated > 0) {
    return "部分模拟";
  }

  if (unmodeled > 0) {
    return "未模拟";
  }

  return "无特殊规则";
}

function summarizeTeamCoverage(team: CombatantBuild[]): string {
  const counts = new Map<string, number>();

  for (const member of team) {
    for (const skill of member.allSkills) {
      const coverage = getSkillCoverage(skill);
      counts.set(coverage, (counts.get(coverage) ?? 0) + 1);
    }
  }

  return ["已完整模拟", "部分模拟", "未模拟", "无特殊规则"]
    .map((label) => `${label} ${counts.get(label) ?? 0}`)
    .join("，");
}

function getCoverageSkillNames(team: CombatantBuild[], coverage: string): string[] {
  return [
    ...new Set(
      team.flatMap((member) =>
        member.allSkills
          .filter((skill) => getSkillCoverage(skill) === coverage)
          .map((skill) => skill.name)
      )
    ),
  ].slice(0, 10);
}

function groupUnmodeledEffects(effects: string[]) {
  const groups = {
    approximate: [] as string[],
    partial: [] as string[],
    unmodeled: [] as string[],
  };

  for (const item of effects) {
    if (/近似|少量生命/.test(item)) {
      groups.approximate.push(item);
      continue;
    }

    if (/萌化|冻结|暂未完整模拟/.test(item)) {
      groups.partial.push(item);
      continue;
    }

    groups.unmodeled.push(item);
  }

  return groups;
}

function renderReport(options: {
  lineups: PvpLineup[];
  profiles: Map<string, SpiritUsageProfile>;
  seedResult: ReturnType<typeof searchBestTeams>;
  advanced: AdvancedTeamRecommendation;
}) {
  const topSpirits = getTopEntries(
    Object.fromEntries(
      [...options.profiles.values()].map((profile) => [profile.spiritId, profile.count])
    ),
    20
  );
  const unresolvedSpiritNames = [
    ...new Set(options.lineups.flatMap((lineup) => lineup.unresolvedSpiritNames)),
  ];
  const unresolvedSkillNames = [
    ...new Set(
      options.lineups.flatMap((lineup) =>
        lineup.members.flatMap((member) => member.unresolvedSkillNames)
      )
    ),
  ];

  const refraction = skills.find((skill) => skill.name === "折射");
  const refractionElementEntries =
    refraction?.effectEntries?.filter((entry) => /系[:：]/.test(entry)) ?? [];
  const teamsWithRefraction = options.advanced.teams.filter((team) =>
    team.team.some((member) =>
      member.allSkills.some((skill) => skill.name === "折射")
    )
  );
  const unmodeledGroups = groupUnmodeledEffects(options.advanced.unmodeledEffects);
  const lines = [
    "# PVP 阵容 AI v5 研究报告",
    "",
    "## 数据与算法",
    "",
    `- 阵容样本：${options.lineups.length}`,
    `- 已匹配常用精灵：${options.profiles.size}`,
    `- 初筛队伍：${options.seedResult.teams.length}`,
    `- MCTS 候选队伍：${options.advanced.candidates.length}`,
    `- 推荐队伍：${options.advanced.teams.length}`,
    `- MCTS 参数：iterations=${options.advanced.mctsConfig.iterations}，rolloutDepth=${options.advanced.mctsConfig.rolloutDepth}，maxTurns=${options.advanced.mctsConfig.maxTurns}，seed=${options.advanced.mctsConfig.seed}`,
    `- 未匹配精灵名：${unresolvedSpiritNames.length}`,
    `- 未匹配技能名：${unresolvedSkillNames.length}`,
    `- 未完全模拟技能效果：${options.advanced.unmodeledEffects.length}`,
    `- 术语规则来源：${LCX_TERMS_SOURCE_URL}`,
    "",
    "## 常用精灵 Top 20",
    ...topSpirits.map(
      ([spiritId, count], index) => `${index + 1}. ${getSpiritName(spiritId)}：${count}`
    ),
    "",
    "## 推荐阵容 Elo 排名",
  ];

  options.advanced.teams.forEach((team) => {
    lines.push("", `### 推荐 ${team.rank}：Elo ${team.elo.toFixed(0)}，战绩 ${team.wins}-${team.losses}-${team.draws}`);
    lines.push(
      `- 阵容：${team.team.map((member) => member.spirit.name).join(" / ")}`
    );
    lines.push(`- 推荐理由：${team.reasons.join("；")}`);
    lines.push(
      `- 主要短板：${team.weaknesses.length > 0 ? team.weaknesses.join("；") : "暂无集中短板"}`
    );
    lines.push(`- 平均剩余血量：${(team.averageRemainingHp * 100).toFixed(1)}%`);
    lines.push(`- 规则覆盖：${summarizeTeamCoverage(team.team)}`);
    lines.push(
      `- 未模拟重点：${getCoverageSkillNames(team.team, "未模拟").join("、") || "无"}`
    );

    for (const member of team.team) {
      const profile = options.profiles.get(member.spirit.id);
      lines.push(
        `- ${member.spirit.name}：${profile ? getCommonSkillNames(profile).join("、") : "无统计"}`
      );
    }

    const battle =
      team.keyBattles.find((item) => item.winner === "A") ?? team.keyBattles[0];
    if (battle) {
      lines.push(
        `- 代表对局：${battle.turns} 回合，结果 ${
          battle.winner === "A" ? "胜" : battle.winner === "B" ? "负" : "近似平局"
        }，剩余血量 ${(battle.remainingHpA * 100).toFixed(1)}% : ${(battle.remainingHpB * 100).toFixed(1)}%`
      );
      lines.push(
        `- 关键事件：${battle.events
          .filter((event) =>
            event.damage ||
            event.healing ||
            event.effect ||
            event.interrupted ||
            event.permanentChange ||
            event.respondedSkill ||
            event.dynamicPower ||
            event.selfFaintedAfterUse ||
            event.markChange ||
            event.termTriggered ||
            event.approximationNote
          )
          .slice(0, 5)
          .map((event) => event.message)
          .join("；") || "无显著事件"}`
      );
    }
  });

  lines.push("", "## 胜率矩阵");
  for (const team of options.advanced.teams) {
    const row = options.advanced.matchupMatrix[team.teamId] ?? {};
    const cells = Object.entries(row)
      .slice(0, 8)
      .map(([opponentId, score]) => {
        const label = getTeamMatrixLabel(options.advanced, opponentId);
        return `${label} ${(score * 100).toFixed(0)}%`;
      });
    lines.push(`- 推荐${team.rank}：${cells.length > 0 ? cells.join("，") : "无已记录对局"}`);
  }

  lines.push("", "## 折射与特殊效果");
  if (refractionElementEntries.length) {
    lines.push(`- 折射已导入 ${refractionElementEntries.length} 条系别触发效果：${refractionElementEntries.join("；")}`);
  } else {
    lines.push("- 折射详情未导入，请先运行 npm.cmd run import:skills。");
  }
  lines.push(
    teamsWithRefraction.length > 0
      ? `- 推荐结果中 ${teamsWithRefraction.length} 套阵容携带折射，MCTS 已按携带技能系别触发可模拟效果。`
      : "- 推荐结果中没有携带折射的阵容。"
  );

  lines.push("", "## 规则来源与近似说明");
  lines.push("- 魔能爆：按用户提供图片使用 0-10 能量威力表 46/71/91/111/136/156/166/181/191/201/211，超过 10 能量按 10 档封顶。");
  lines.push("- 彗星：按用户确认规则使用最大生命已损百分比扣威力，动作开始执行后无论结果如何使用者倒下。");
  lines.push("- 迸发：按用户确认规则，仅首次上场后的第一次技能行动获得本次临时减费；行动开始即消耗迸发。");
  lines.push("- 棘刺：按用户确认规则，非自动换人入场时每层造成 6% 最大生命伤害，触发后不消耗层数。");
  lines.push("- 回旋踢：按用户确认规则，敌方本回合发生非自动换人时本次威力翻倍。");
  lines.push("- 鸣沙陷阱：按用户提供图片使用实时物防差档位表覆盖技能威力。");
  lines.push(
    `- LCX 术语：${TERM_RULES.map((rule) => `${rule.term}(${rule.simulated})`).join("、")}`
  );

  lines.push("", "## 未完全模拟效果");
  lines.push("### 近似模拟");
  lines.push(unmodeledGroups.approximate.length > 0 ? unmodeledGroups.approximate.slice(0, 20).map((item) => `- ${item}`).join("\n") : "- 无");
  lines.push("### 部分模拟");
  lines.push(unmodeledGroups.partial.length > 0 ? unmodeledGroups.partial.slice(0, 20).map((item) => `- ${item}`).join("\n") : "- 无");
  lines.push("### 完全未模拟");
  lines.push(unmodeledGroups.unmodeled.length > 0 ? unmodeledGroups.unmodeled.slice(0, 40).map((item) => `- ${item}`).join("\n") : "- 无");

  lines.push("", "## 未匹配数据");
  lines.push(
    unresolvedSpiritNames.length > 0
      ? `- 精灵：${unresolvedSpiritNames.join("、")}`
      : "- 精灵：无"
  );
  lines.push(
    unresolvedSkillNames.length > 0
      ? `- 技能：${unresolvedSkillNames.join("、")}`
      : "- 技能：无"
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  if (pvpLineups.length === 0) {
    throw new Error("没有 PVP 阵容数据，请先运行 npm.cmd run import:pvp-lineups");
  }

  const profiles = collectUsageStats(pvpLineups);
  const candidateProfiles = [...profiles.values()]
    .filter((profile) => profile.count >= 1)
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      return countDelta !== 0 ? countDelta : getSpiritName(left.spiritId).localeCompare(getSpiritName(right.spiritId));
    });
  const candidateBuilds = candidateProfiles
    .map(createCandidateBuild)
    .filter((build): build is CombatantBuild => Boolean(build));
  const environment = candidateBuilds.slice(0, Math.min(40, candidateBuilds.length));
  const result = searchBestTeams({
    candidateLimit: Math.min(60, candidateBuilds.length),
    outputCount: 8,
    environmentSize: environment.length,
    beamWidth: 96,
    candidates: candidateBuilds,
    environment,
    usageWeights: createUsageWeights(profiles),
    teammateSynergy: createTeammateSynergy(profiles),
  });
  const advanced = runSelfPlayTournament({
    seedTeams: result.teams,
    candidateBuilds,
    outputCount: 5,
    maxTeams: 10,
    gamesPerPair: 2,
    mctsConfig: {
      seed: 20260515,
      iterations: 14,
      rolloutDepth: 6,
      maxTurns: 18,
      exploration: 1.2,
    },
  });
  const usageStats = buildUsageStats(pvpLineups, profiles);
  const report = renderReport({ lineups: pvpLineups, profiles, seedResult: result, advanced });
  const jsonResult = {
    generatedAt: new Date().toISOString(),
    source: advanced.source,
    mctsConfig: advanced.mctsConfig,
    usageStats,
    candidates: advanced.candidates,
    matchupMatrix: advanced.matchupMatrix,
    recommendations: advanced.teams.map((team) => ({
      rank: team.rank,
      elo: team.elo,
      record: {
        wins: team.wins,
        losses: team.losses,
        draws: team.draws,
        games: team.games,
      },
      averageRemainingHp: team.averageRemainingHp,
      spiritIds: team.team.map((member) => member.spirit.id),
      spiritNames: team.team.map((member) => member.spirit.name),
      reasons: team.reasons,
      weaknesses: team.weaknesses,
      unmodeledEffects: team.unmodeledEffects,
      keyBattles: team.keyBattles.map((battle) => ({
        winner: battle.winner,
        turns: battle.turns,
        remainingHpA: battle.remainingHpA,
        remainingHpB: battle.remainingHpB,
        events: battle.events.slice(0, 20),
      })),
      members: team.team.map((member) => {
        const profile = profiles.get(member.spirit.id);
        return {
          spiritId: member.spirit.id,
          spiritName: member.spirit.name,
          commonSkills: profile ? getCommonSkillNames(profile) : [],
          simulatedSkills: member.allSkills.map((skill) => ({
            skillId: skill.id,
            skillName: skill.name,
            ruleCoverage: getSkillCoverage(skill),
            effectEntries: skill.effectEntries ?? [],
            unparsedEffectNotes: skill.unparsedEffectNotes ?? [],
          })),
        };
      }),
    })),
    unmodeledEffects: advanced.unmodeledEffects,
  };

  await writeFile(reportPath, report, "utf8");
  await writeFile(resultPath, `${JSON.stringify(jsonResult, null, 2)}\n`, "utf8");

  console.log(`已输出 ${reportPath}`);
  console.log(`已输出 ${resultPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
