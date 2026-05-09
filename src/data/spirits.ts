import type { Spirit } from "../types/battle";

export const spirits: Spirit[] = [
  {
    id: "physical_test_attacker",
    name: "物攻测试精灵",
    elements: ["火"],
    baseStats: {
      hp: 120,
      atk: 150,
      spa: 80,
      def: 100,
      spd: 90,
      spe: 100,
    },
  },
  {
    id: "magical_test_attacker",
    name: "魔攻测试精灵",
    elements: ["水"],
    baseStats: {
      hp: 110,
      atk: 75,
      spa: 150,
      def: 90,
      spd: 100,
      spe: 105,
    },
  },
  {
    id: "defense_test_spirit",
    name: "防守测试精灵",
    elements: ["草"],
    baseStats: {
      hp: 120,
      atk: 90,
      spa: 90,
      def: 100,
      spd: 100,
      spe: 80,
    },
  },
  {
    id: "speed_formula_test",
    name: "速度公式验证精灵",
    elements: ["普通"],
    baseStats: {
      hp: 100,
      atk: 100,
      spa: 100,
      def: 100,
      spd: 100,
      spe: 92,
    },
  },
];
