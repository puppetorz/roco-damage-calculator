import { generatedSkills } from "../src/data/generated/skills.generated";
import type {
  BattleAction,
  BattleEffect,
  BattleSide,
  CombatantBuild,
  DamageSkill,
  IndividualValues,
  Nature,
  Skill,
  Spirit,
  StatModifierValues,
} from "../src/types/battle";
import {
  applyBattleTurn,
  createInitialBattleState,
  listLegalActions,
} from "../src/utils/battleSimulator";

const neutralNature: Nature = {
  id: "test-neutral",
  name: "test-neutral",
  modifiers: {},
};

const defaultIvs: IndividualValues = {
  hp: 31,
  atk: 31,
  spa: 31,
  def: 31,
  spd: 31,
  spe: 31,
};

const zeroModifiers: StatModifierValues = {
  hp: 0,
  atk: 0,
  spa: 0,
  def: 0,
  spd: 0,
  spe: 0,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function skill(name: string, options: Partial<Skill> = {}): Skill {
  return {
    id: `test-${name}`,
    name,
    element: "normal",
    category: "status",
    power: 0,
    energyCost: 0,
    stableDamage: false,
    parsedEffects: [],
    unparsedEffectNotes: [],
    ...options,
  };
}

function damageSkill(name: string, options: Partial<DamageSkill> = {}): DamageSkill {
  return skill(name, {
    category: "physical",
    power: 100,
    stableDamage: false,
    ...options,
  }) as DamageSkill;
}

function effect<T extends BattleEffect>(effect: T): T {
  return effect;
}

function spirit(id: string, name: string, spe: number): Spirit {
  return {
    id,
    name,
    elements: ["normal"],
    baseStats: {
      hp: 100,
      atk: 100,
      spa: 100,
      def: 100,
      spd: 100,
      spe,
    },
  };
}

function build(id: string, name: string, spe: number, allSkills: Skill[]): CombatantBuild {
  const damageSkills = allSkills.filter(
    (candidate): candidate is DamageSkill =>
      (candidate.category === "physical" || candidate.category === "magical") &&
      candidate.power > 0
  );

  assert(damageSkills.length > 0, `${name} needs at least one damage skill`);

  return {
    spirit: spirit(id, name, spe),
    nature: neutralNature,
    individualValues: defaultIvs,
    skills: damageSkills,
    allSkills,
    actualStats: {
      hp: 500,
      atk: 180,
      spa: 180,
      def: 120,
      spd: 120,
      spe,
    },
  };
}

function use(side: BattleSide, skillId: string): BattleAction {
  return { kind: "useSkill", side, skillId };
}

function switchTo(side: BattleSide, memberIndex: number): BattleAction {
  return { kind: "switch", side, memberIndex };
}

function findGeneratedSkill(label: string, name: string): Skill {
  const found = generatedSkills.find((candidate) => candidate.name === name);
  assert(found, `Missing generated skill: ${label}`);
  return found;
}

function countGeneratedEffects(name: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const found = findGeneratedSkill(name, name);

  for (const parsedEffect of found.parsedEffects ?? []) {
    counts[parsedEffect.kind] = (counts[parsedEffect.kind] ?? 0) + 1;
  }

  return counts;
}

function verifyGeneratedKeySkills(): void {
  const requirements: Array<[string, string[]]> = [
    ["\u5148\u53d1\u5236\u4eba", ["priorityModifier"]],
    ["\u98ce\u5899", ["priorityModifier", "damageReduction", "responseWindow"]],
    ["\u55dc\u75db", ["damageReduction", "responseWindow", "statModifier"]],
    ["\u786c\u95e8", ["responseWindow", "interrupt"]],
    ["\u6709\u6548\u9884\u9632", ["priorityModifier", "damageReduction", "responseWindow"]],
    ["\u542c\u6865", ["damageReduction", "responseWindow"]],
    ["\u622a\u62f3", ["responseWindow", "interrupt"]],
    ["\u65a9\u65ad", ["responseWindow", "interrupt"]],
    ["\u8ffd\u6253", ["hitCountModifier", "responseWindow"]],
    ["\u6c34\u5203", ["responseWindow", "permanentEnergyCostModifier"]],
    ["\u5929\u6d2a", ["responseWindow", "permanentEnergyCostModifier"]],
    ["\u80fd\u91cf\u5203", ["permanentPowerModifier"]],
    ["\u843d\u96f7", ["permanentPowerModifier", "entryCounter"]],
    ["\u711a\u70e7\u70d9\u5370", ["dispel"]],
    ["\u503e\u6cfb", ["dispel"]],
    ["\u52a0\u5927\u529f\u7387", ["energyDelta", "switch"]],
    ["\u9b54\u80fd\u7206", ["dynamicPowerOverride"]],
    ["\u5f57\u661f", ["powerLossByMissingHp", "selfFaintAfterUse"]],
    ["\u5149\u5408\u4f5c\u7528", ["termMark", "endTurnEnergyFromMark"]],
    ["\u6253\u6e7f", ["termMark"]],
    ["\u4f11\u606f\u56de\u590d", ["percentHeal"]],
    ["\u751c\u5fc3\u7eed\u822a", ["termMark", "percentHeal", "energyDelta"]],
    ["\u8d85\u5bfc", ["temporaryEnergyCostOnFirstAction"]],
    ["\u68d8\u523a", ["termMark"]],
    ["\u56de\u65cb\u8e22", ["powerMultiplierIfOpponentSwitched"]],
    ["\u9e23\u6c99\u9677\u9631", ["defenseGapPowerOverride"]],
  ];

  for (const [name, kinds] of requirements) {
    const counts = countGeneratedEffects(name);
    for (const kind of kinds) {
      assert(counts[kind] > 0, `${name} should include ${kind}`);
    }
  }

  const refraction = findGeneratedSkill("refraction", "\u6298\u5c04");
  const refractionTriggers = (refraction.parsedEffects ?? []).filter(
    (parsedEffect) => parsedEffect.trigger?.kind === "carriedSkillElement"
  );
  const refractionElements = new Set(
    refractionTriggers.map((parsedEffect) =>
      parsedEffect.trigger?.kind === "carriedSkillElement" ? parsedEffect.trigger.element : ""
    )
  );
  assert(refractionElements.size === 18, "Refraction should keep 18 element trigger entries");
}

function verifyPriority(): void {
  const quick = damageSkill("quick-priority", {
    parsedEffects: [
      effect({
        kind: "priorityModifier",
        target: "self",
        amount: 1,
        rawText: "priority +1",
        simulated: true,
      }),
    ],
  });
  const heavy = damageSkill("heavy-hit");
  const state = createInitialBattleState(
    [build("slow", "slow", 80, [quick])],
    [build("fast", "fast", 240, [heavy])]
  );

  const next = applyBattleTurn(state, use("A", quick.id), use("B", heavy.id));
  const firstSkillEvent = next.events.find((event) => event.action === "useSkill");

  assert(firstSkillEvent?.side === "A", "priority skill should act before faster opponent");
  assert(firstSkillEvent.priority === 1, "priority event should record priority value");
}

function verifyDefenseAndResponse(): void {
  const guard = skill("guard", {
    category: "defense",
    parsedEffects: [
      effect({
        kind: "damageReduction",
        target: "self",
        rate: 0.5,
        rawText: "damage -50%",
        simulated: true,
      }),
      effect({
        kind: "responseWindow",
        target: "self",
        responseKind: "attack",
        rawText: "respond attack",
        simulated: true,
      }),
    ],
  });
  const heavy = damageSkill("heavy-hit");
  const state = createInitialBattleState(
    [build("guard", "guard", 100, [guard, heavy])],
    [build("attacker", "attacker", 180, [heavy])]
  );

  const next = applyBattleTurn(state, use("A", guard.id), use("B", heavy.id));

  assert(
    next.events.some((event) => event.reducedDamage && event.reducedDamage > 0),
    "defense skill should reduce incoming damage"
  );
  assert(
    next.events.some((event) => event.respondedSkill === heavy.name),
    "response window should record responded skill"
  );
}

function verifyInterrupt(): void {
  const hardCounter = skill("hard-counter", {
    category: "defense",
    parsedEffects: [
      effect({
        kind: "responseWindow",
        target: "self",
        responseKind: "attack",
        rawText: "respond attack",
        simulated: true,
      }),
      effect({
        kind: "interrupt",
        target: "opponent",
        rawText: "\u5e94\u5bf9\u653b\u51fb\uff1a\u6253\u65ad",
        simulated: true,
      }),
    ],
  });
  const heavy = damageSkill("heavy-hit");
  const state = createInitialBattleState(
    [build("counter", "counter", 100, [hardCounter, heavy])],
    [build("attacker", "attacker", 180, [heavy])]
  );

  const next = applyBattleTurn(state, use("A", hardCounter.id), use("B", heavy.id));

  assert(
    next.events.some((event) => event.interrupted && event.respondedSkill === heavy.name),
    "interrupt response should stop incoming skill"
  );
}

function verifyPermanentEnergyCost(): void {
  const waterBlade = damageSkill("water-blade", {
    energyCost: 8,
    parsedEffects: [
      effect({
        kind: "responseWindow",
        target: "self",
        responseKind: "attack",
        rawText: "respond attack",
        simulated: true,
      }),
      effect({
        kind: "permanentEnergyCostModifier",
        target: "self",
        amount: -4,
        rawText: "\u5e94\u5bf9\u653b\u51fb\uff1a\u672c\u6280\u80fd\u80fd\u8017\u6c38\u4e45-4",
        simulated: true,
      }),
    ],
  });
  const heavy = damageSkill("heavy-hit");
  const state = createInitialBattleState(
    [build("water", "water", 220, [waterBlade])],
    [build("attacker", "attacker", 180, [heavy])]
  );

  const next = applyBattleTurn(state, use("A", waterBlade.id), use("B", heavy.id));
  const modifier = next.teams.A.members[0].skillEnergyCostModifiers[waterBlade.id];

  assert(
    modifier === -4,
    `response success should persist skill energy cost modifier, got ${modifier ?? "undefined"}`
  );
  assert(
    next.events.some((event) => event.energyChange === -4 && event.permanentChange),
    "permanent energy change should be explained in events"
  );
}

function verifyDispelAndDetachSwitch(): void {
  const heavy = damageSkill("heavy-hit");
  const dispel = skill("dispel", {
    parsedEffects: [
      effect({
        kind: "dispel",
        target: "opponent",
        rawText: "dispel marks",
        simulated: true,
      }),
    ],
  });
  const detach = skill("detach", {
    parsedEffects: [
      effect({
        kind: "energyDelta",
        target: "self",
        amount: 2,
        rawText: "restore 2 energy",
        simulated: true,
      }),
      effect({
        kind: "switch",
        target: "self",
        rawText: "detach and switch",
        simulated: true,
      }),
    ],
  });

  const state = createInitialBattleState(
    [build("utility", "utility", 160, [dispel, detach, heavy]), build("bench", "bench", 120, [heavy])],
    [build("marked", "marked", 120, [heavy])]
  );
  state.teams.B.members[0].marks.test = 3;

  const afterDispel = applyBattleTurn(state, use("A", dispel.id), use("B", heavy.id));
  assert(afterDispel.teams.B.members[0].marks.test === undefined, "dispel should remove marks");
  assert(
    afterDispel.events.some((event) => event.dispelledMarks === 3),
    "dispel event should record removed mark count"
  );

  const afterDetach = applyBattleTurn(afterDispel, use("A", detach.id), use("B", heavy.id));
  assert(afterDetach.teams.A.activeIndex === 1, "detach switch should move to a bench member");
  assert(
    afterDetach.events.some((event) => event.action === "switch" && event.side === "A"),
    "detach switch should emit switch event"
  );
}

function verifyMagicBlastDynamicPower(): void {
  const magicBlast = damageSkill("magic-blast", {
    power: 1,
    energyCost: 0,
    parsedEffects: [
      effect({
        kind: "dynamicPowerOverride",
        target: "self",
        powerByEnergy: [46, 71, 91, 111, 136, 156, 166, 181, 191, 201, 211],
        rawText: "consume all energy",
        simulated: true,
      }),
    ],
  });
  const idle = skill("idle");
  const expectedPowerByEnergy = new Map([
    [0, 46],
    [1, 71],
    [5, 156],
    [10, 211],
  ]);

  for (const [energy, expectedPower] of expectedPowerByEnergy) {
    const state = createInitialBattleState(
      [build(`blast-${energy}`, `blast-${energy}`, 160, [magicBlast])],
      [build(`idle-${energy}`, `idle-${energy}`, 100, [idle, damageSkill(`tap-${energy}`)])]
    );
    state.teams.A.members[0].energy = energy;

    const next = applyBattleTurn(state, use("A", magicBlast.id), use("B", idle.id));
    const event = next.events.find((item) => item.skillName === magicBlast.name);

    assert(event?.dynamicPower === expectedPower, `magic blast at ${energy} energy should use ${expectedPower} power`);
    assert(next.teams.A.members[0].energy === 0, "magic blast should consume all energy");
  }
}

function verifyCometPowerAndSelfFaint(): void {
  const comet = damageSkill("comet", {
    power: 240,
    parsedEffects: [
      effect({
        kind: "powerLossByMissingHp",
        target: "self",
        stepPercent: 5,
        amountPerStep: 10,
        minimumPower: 0,
        rawText: "missing hp power loss",
        simulated: true,
      }),
      effect({
        kind: "selfFaintAfterUse",
        target: "self",
        rawText: "self faint",
        simulated: true,
      }),
    ],
  });
  const idle = skill("idle");
  const cases = [
    { hp: 500, expectedPower: 240 },
    { hp: 375, expectedPower: 190 },
    { hp: 250, expectedPower: 140 },
  ];

  for (const item of cases) {
    const state = createInitialBattleState(
      [build(`comet-${item.hp}`, `comet-${item.hp}`, 160, [comet])],
      [build(`idle-${item.hp}`, `idle-${item.hp}`, 100, [idle, damageSkill(`tap-${item.hp}`)])]
    );
    state.teams.A.members[0].hp = item.hp;

    const next = applyBattleTurn(state, use("A", comet.id), use("B", idle.id));
    const event = next.events.find((battleEvent) => battleEvent.skillName === comet.name && battleEvent.action === "useSkill");

    assert(event?.dynamicPower === item.expectedPower, `comet at hp ${item.hp} should use ${item.expectedPower} power`);
    assert(next.teams.A.members[0].fainted, "comet user should faint after use");
    assert(
      next.events.some((battleEvent) => battleEvent.selfFaintedAfterUse),
      "comet self faint should be explained in events"
    );
  }
}

function verifyRecoveryAndTermMarks(): void {
  const rest = skill("rest", {
    parsedEffects: [
      effect({
        kind: "percentHeal",
        target: "self",
        percent: 0.3,
        rawText: "heal 30%",
        simulated: true,
      }),
    ],
  });
  const photosynthesis = skill("photosynthesis", {
    parsedEffects: [
      effect({
        kind: "termMark",
        target: "self",
        term: "\u5149\u5408",
        stacks: 1,
        rawText: "gain photosynthesis",
        simulated: true,
      }),
    ],
  });
  const wet = skill("wet", {
    parsedEffects: [
      effect({
        kind: "termMark",
        target: "self",
        term: "\u6e7f\u6da6",
        stacks: 1,
        rawText: "gain wet",
        simulated: true,
      }),
    ],
  });
  const expensive = damageSkill("expensive", { energyCost: 3 });
  const idle = skill("idle");

  const restState = createInitialBattleState(
    [build("rest-user", "rest-user", 160, [rest, expensive])],
    [build("idle-rest", "idle-rest", 100, [idle, damageSkill("tap-rest")])]
  );
  restState.teams.A.members[0].hp = 250;
  const afterRest = applyBattleTurn(restState, use("A", rest.id), use("B", idle.id));
  assert(afterRest.teams.A.members[0].hp === 400, "rest should recover 30% max hp");

  const photoState = createInitialBattleState(
    [build("photo-user", "photo-user", 160, [photosynthesis, expensive])],
    [build("idle-photo", "idle-photo", 100, [idle, damageSkill("tap-photo")])]
  );
  photoState.teams.A.members[0].energy = 4;
  const afterPhoto = applyBattleTurn(photoState, use("A", photosynthesis.id), use("B", idle.id));
  assert(afterPhoto.teams.A.members[0].marks["\u5149\u5408"] === 1, "photosynthesis should add term mark");
  assert(afterPhoto.teams.A.members[0].energy === 5, "photosynthesis should restore 1 energy at end turn");

  const wetState = createInitialBattleState(
    [build("wet-user", "wet-user", 160, [wet, expensive])],
    [build("idle-wet", "idle-wet", 100, [idle, damageSkill("tap-wet")])]
  );
  wetState.teams.A.members[0].energy = 2;
  const afterWet = applyBattleTurn(wetState, use("A", wet.id), use("B", idle.id));
  assert(afterWet.teams.A.members[0].marks["\u6e7f\u6da6"] === 1, "wet should add term mark");
  assert(
    listLegalActionIds(afterWet, "A").includes(expensive.id),
    "wet mark should reduce all skill energy costs by 1"
  );
}

function listLegalActionIds(state: ReturnType<typeof createInitialBattleState>, side: BattleSide): string[] {
  return listLegalActions(state, side)
    .filter((action): action is Extract<BattleAction, { kind: "useSkill" }> => action.kind === "useSkill")
    .map((action) => action.skillId);
}

function verifyEndTurnStatusRules(): void {
  const idle = skill("idle");
  const state = createInitialBattleState(
    [build("status-user", "status-user", 160, [idle, damageSkill("tap-status-a")])],
    [build("status-target", "status-target", 100, [idle, damageSkill("tap-status-b")])]
  );
  state.teams.A.members[0].statuses.burn = 3;
  state.teams.A.members[0].statuses.poison = 2;

  const next = applyBattleTurn(state, use("A", idle.id), use("B", idle.id));

  assert(next.teams.A.members[0].hp === 500 - 60, "burn and poison should use LCX end-turn rates");
  assert(next.teams.A.members[0].statuses.burn === 1, "burn should decay by half rounded up");
}

function verifyBurstTemporaryCost(): void {
  const burst = damageSkill("burst", {
    energyCost: 3,
    parsedEffects: [
      effect({
        kind: "temporaryEnergyCostOnFirstAction",
        target: "self",
        amount: -1,
        rawText: "burst cost -1",
        simulated: true,
      }),
    ],
  });
  const idle = skill("idle");
  const state = createInitialBattleState(
    [build("burst-user", "burst-user", 160, [burst])],
    [build("idle-burst", "idle-burst", 100, [idle, damageSkill("tap-burst")])]
  );
  state.teams.A.members[0].energy = 2;

  assert(listLegalActionIds(state, "A").includes(burst.id), "burst should make first action temporarily affordable");
  const next = applyBattleTurn(state, use("A", burst.id), use("B", idle.id));

  assert(next.teams.A.members[0].hasUsedFirstAction, "burst first action should be consumed after action starts");
  assert(next.teams.A.members[0].energy === 0, "burst temporary cost reduction should only affect current action");
  assert(
    next.events.some((battleEvent) => battleEvent.temporaryEnergyCost === -1),
    "burst cost reduction should be explained in events"
  );
}

function verifyThornEntryHazard(): void {
  const idle = skill("idle");
  const tap = damageSkill("tap");
  const state = createInitialBattleState(
    [build("active", "active", 160, [idle, tap]), build("thorned", "thorned", 120, [idle, tap])],
    [build("opponent", "opponent", 100, [idle, tap])]
  );
  state.teams.A.members[1].marks["\u68d8\u523a"] = 2;

  const afterSwitch = applyBattleTurn(state, switchTo("A", 1), use("B", idle.id));
  assert(afterSwitch.teams.A.members[1].hp === 500 - 60, "thorn should deal 6% max hp per stack on non-automatic entry");
  assert(afterSwitch.teams.A.members[1].marks["\u68d8\u523a"] === 2, "thorn should not consume stacks");

  const autoState = createInitialBattleState(
    [build("doomed", "doomed", 160, [idle, tap]), build("auto-thorned", "auto-thorned", 120, [idle, tap])],
    [build("finisher", "finisher", 100, [damageSkill("finisher", { power: 999 })])]
  );
  autoState.teams.A.members[0].hp = 1;
  autoState.teams.A.members[1].marks["\u68d8\u523a"] = 2;
  const afterAuto = applyBattleTurn(autoState, use("A", idle.id), use("B", "test-finisher"));
  assert(afterAuto.teams.A.activeIndex === 1, "faint should auto-switch to bench");
  assert(afterAuto.teams.A.members[1].hp === 500, "thorn should not trigger on automatic faint replacement");
}

function verifySwitchPunishPower(): void {
  const spinKick = damageSkill("spin-kick", {
    power: 100,
    parsedEffects: [
      effect({
        kind: "powerMultiplierIfOpponentSwitched",
        target: "self",
        multiplier: 2,
        rawText: "opponent switched: power x2",
        simulated: true,
      }),
    ],
  });
  const idle = skill("idle");
  const state = createInitialBattleState(
    [build("kicker", "kicker", 160, [spinKick])],
    [build("target-a", "target-a", 100, [idle, damageSkill("tap-a")]), build("target-b", "target-b", 90, [idle, damageSkill("tap-b")])]
  );

  const next = applyBattleTurn(state, use("A", spinKick.id), switchTo("B", 1));
  const event = next.events.find((battleEvent) => battleEvent.skillName === spinKick.name && battleEvent.action === "useSkill");

  assert(event?.dynamicPower === 200, "switch punish skill should double power when opponent switched this turn");
}

function verifyDefenseGapPowerTable(): void {
  const sandTrap = damageSkill("sand-trap", {
    power: 1,
    parsedEffects: [
      effect({
        kind: "defenseGapPowerOverride",
        target: "self",
        table: [
          { min: -999999, max: -1, power: 60 },
          { min: 0, max: 14, power: 100 },
          { min: 120, max: 134, power: 194 },
          { min: 135, power: 200 },
        ],
        rawText: "defense gap power",
        simulated: true,
      }),
    ],
  });
  const idle = skill("idle");
  const attacker = build("sand-user", "sand-user", 160, [sandTrap]);
  const defender = build("sand-target", "sand-target", 100, [idle, damageSkill("tap-sand")]);
  attacker.actualStats.def = 250;
  defender.actualStats.def = 120;
  const state = createInitialBattleState([attacker], [defender]);

  const next = applyBattleTurn(state, use("A", sandTrap.id), use("B", idle.id));
  const event = next.events.find((battleEvent) => battleEvent.skillName === sandTrap.name && battleEvent.action === "useSkill");

  assert(event?.dynamicPower === 194, "defense gap 120-134 should use 194 power");
}

verifyGeneratedKeySkills();
verifyPriority();
verifyDefenseAndResponse();
verifyInterrupt();
verifyPermanentEnergyCost();
verifyDispelAndDetachSwitch();
verifyMagicBlastDynamicPower();
verifyCometPowerAndSelfFaint();
verifyRecoveryAndTermMarks();
verifyEndTurnStatusRules();
verifyBurstTemporaryCost();
verifyThornEntryHazard();
verifySwitchPunishPower();
verifyDefenseGapPowerTable();

console.log("PVP battle rule smoke checks passed.");
