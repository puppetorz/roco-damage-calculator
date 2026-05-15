import type {
  AdvancedTeamRecommendation,
  CombatantBuild,
  MctsConfig,
  SelfPlayTeamResult,
  SimulatedBattleResult,
  TeamScore,
} from "../types/battle";
import { DEFAULT_MCTS_CONFIG, simulateBattle } from "./battleSimulator";

export type SelfPlayOptions = {
  seedTeams: TeamScore[];
  candidateBuilds: CombatantBuild[];
  outputCount: number;
  mctsConfig?: Partial<MctsConfig>;
  maxTeams?: number;
  gamesPerPair?: number;
};

type TournamentTeam = {
  id: string;
  team: CombatantBuild[];
  seedScore: number;
  source: string;
};

type MutableResult = {
  team: TournamentTeam;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  remainingHp: number;
  keyBattles: SimulatedBattleResult[];
  opponents: Record<string, number>;
};

function createTeamId(team: CombatantBuild[]): string {
  return team
    .map((member) => member.spirit.id)
    .sort()
    .join("|");
}

function createTeamName(team: CombatantBuild[]): string {
  return team.map((member) => member.spirit.name).join(" / ");
}

function uniqueTeams(teams: TournamentTeam[]): TournamentTeam[] {
  const seen = new Set<string>();
  const result: TournamentTeam[] = [];

  for (const team of teams) {
    const key = createTeamId(team.team);
    if (seen.has(key) || team.team.length !== 6) {
      continue;
    }

    seen.add(key);
    result.push({ ...team, id: key });
  }

  return result;
}

function mutateTeam(
  base: TeamScore,
  candidates: CombatantBuild[],
  offset: number
): TournamentTeam | undefined {
  const members = base.members.map((member) => member.build);
  const existing = new Set(members.map((member) => member.spirit.id));
  const replacement = candidates.filter((candidate) => !existing.has(candidate.spirit.id))[
    offset
  ];

  if (!replacement) {
    return undefined;
  }

  const weakestIndex = base.members
    .map((member, index) => ({ index, score: member.averageScore }))
    .sort((left, right) => left.score - right.score)[0].index;
  const nextMembers = [...members];
  nextMembers[weakestIndex] = replacement;

  return {
    id: createTeamId(nextMembers),
    team: nextMembers,
    seedScore: base.score * 0.98,
    source: `mutated:${offset + 1}`,
  };
}

function createTournamentTeams(
  seedTeams: TeamScore[],
  candidates: CombatantBuild[],
  maxTeams: number
): TournamentTeam[] {
  const directTeams = seedTeams.map((team, index) => ({
    id: createTeamId(team.members.map((member) => member.build)),
    team: team.members.map((member) => member.build),
    seedScore: team.score,
    source: `beam:${index + 1}`,
  }));
  const mutatedTeams = seedTeams.flatMap((team) =>
    [0, 1].map((offset) => mutateTeam(team, candidates, offset)).filter(Boolean)
  ) as TournamentTeam[];

  return uniqueTeams([...directTeams, ...mutatedTeams]).slice(0, maxTeams);
}

function expectedScore(leftElo: number, rightElo: number): number {
  return 1 / (1 + 10 ** ((rightElo - leftElo) / 400));
}

function updateElo(left: MutableResult, right: MutableResult, leftScore: number): void {
  const k = 26;
  const rightScore = 1 - leftScore;
  const leftExpected = expectedScore(left.elo, right.elo);
  const rightExpected = expectedScore(right.elo, left.elo);

  left.elo += k * (leftScore - leftExpected);
  right.elo += k * (rightScore - rightExpected);
}

function recordGame(
  left: MutableResult,
  right: MutableResult,
  battle: SimulatedBattleResult
): void {
  const leftScore = battle.winner === "A" ? 1 : battle.winner === "B" ? 0 : 0.5;
  updateElo(left, right, leftScore);

  left.games += 1;
  right.games += 1;
  left.remainingHp += battle.remainingHpA;
  right.remainingHp += battle.remainingHpB;
  left.opponents[right.team.id] = leftScore;
  right.opponents[left.team.id] = 1 - leftScore;

  if (leftScore === 1) {
    left.wins += 1;
    right.losses += 1;
  } else if (leftScore === 0) {
    right.wins += 1;
    left.losses += 1;
  } else {
    left.draws += 1;
    right.draws += 1;
  }

  if (left.keyBattles.length < 4) {
    left.keyBattles.push(battle);
  }

  if (right.keyBattles.length < 4) {
    right.keyBattles.push({
      ...battle,
      winner:
        battle.winner === "A" ? "B" : battle.winner === "B" ? "A" : undefined,
      scoreA: battle.scoreB,
      scoreB: battle.scoreA,
      remainingHpA: battle.remainingHpB,
      remainingHpB: battle.remainingHpA,
    });
  }
}

function collectUnmodeledEffects(team: CombatantBuild[]): string[] {
  const notes = new Set<string>();

  for (const member of team) {
    for (const skill of member.allSkills) {
      for (const note of skill.unparsedEffectNotes ?? []) {
        notes.add(`${skill.name}：${note}`);
      }
    }
  }

  return [...notes].sort((left, right) => left.localeCompare(right));
}

function createReasons(result: MutableResult): string[] {
  const members = result.team.team;
  const speedLine = members
    .map((member) => member.actualStats.spe)
    .sort((left, right) => right - left)
    .slice(0, 3)
    .join(" / ");
  const winRate = result.games > 0 ? ((result.wins + result.draws * 0.5) / result.games) * 100 : 0;

  return [
    `MCTS 自博弈胜率 ${winRate.toFixed(1)}%`,
    `Elo ${result.elo.toFixed(0)}`,
    `速度线 ${speedLine}`,
    `来自 ${result.team.source}，初筛 ${result.team.seedScore.toFixed(1)} 分`,
  ];
}

function createWeaknesses(result: MutableResult, allResults: Map<string, MutableResult>): string[] {
  const losses = Object.entries(result.opponents)
    .filter(([, score]) => score < 0.5)
    .map(([teamId, score]) => ({
      teamId,
      score,
      name: createTeamName(allResults.get(teamId)?.team.team ?? []),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 3);
  const unmodeledCount = collectUnmodeledEffects(result.team.team).length;

  return [
    ...losses.map((loss) => `对 ${loss.name || loss.teamId} 胜率偏低`),
    ...(unmodeledCount > 0 ? [`${unmodeledCount} 个技能效果暂未完整模拟`] : []),
  ];
}

export function runSelfPlayTournament(
  options: SelfPlayOptions
): AdvancedTeamRecommendation {
  const mctsConfig: MctsConfig = {
    ...DEFAULT_MCTS_CONFIG,
    ...options.mctsConfig,
  };
  const teams = createTournamentTeams(
    options.seedTeams,
    options.candidateBuilds,
    options.maxTeams ?? 10
  );
  const results = new Map<string, MutableResult>(
    teams.map((team) => [
      team.id,
      {
        team,
        elo: 1500 + team.seedScore * 0.2,
        wins: 0,
        losses: 0,
        draws: 0,
        games: 0,
        remainingHp: 0,
        keyBattles: [],
        opponents: {},
      },
    ])
  );
  const gamesPerPair = options.gamesPerPair ?? 2;
  let seed = mctsConfig.seed;

  for (let leftIndex = 0; leftIndex < teams.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < teams.length; rightIndex += 1) {
      const left = results.get(teams[leftIndex].id)!;
      const right = results.get(teams[rightIndex].id)!;

      for (let game = 0; game < gamesPerPair; game += 1) {
        const swapped = game % 2 === 1;
        const battle = simulateBattle(
          swapped ? right.team.team : left.team.team,
          swapped ? left.team.team : right.team.team,
          {
            ...mctsConfig,
            seed: seed++,
          }
        );

        recordGame(
          swapped ? right : left,
          swapped ? left : right,
          battle
        );
      }
    }
  }

  const sorted = [...results.values()].sort((left, right) => right.elo - left.elo);
  const finalResults: SelfPlayTeamResult[] = sorted
    .slice(0, options.outputCount)
    .map((result, index) => ({
      teamId: result.team.id,
      rank: index + 1,
      elo: result.elo,
      wins: result.wins,
      losses: result.losses,
      draws: result.draws,
      games: result.games,
      averageRemainingHp: result.games > 0 ? result.remainingHp / result.games : 0,
      team: result.team.team,
      reasons: createReasons(result),
      weaknesses: createWeaknesses(result, results),
      keyBattles: result.keyBattles,
      unmodeledEffects: collectUnmodeledEffects(result.team.team),
    }));
  const matchupMatrix = Object.fromEntries(
    sorted.map((result) => [result.team.id, result.opponents])
  );
  const unmodeledEffects = [
    ...new Set(finalResults.flatMap((result) => result.unmodeledEffects)),
  ].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    source: "https://wiki.biligame.com/rocom/阵容一览 + https://wiki.biligame.com/rocom/技能筛选",
    mctsConfig,
    candidates: teams.map((team) => team.id),
    matchupMatrix,
    teams: finalResults,
    unmodeledEffects,
  };
}
