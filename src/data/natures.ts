import type { Nature } from "../types/battle";

export const natures: Nature[] = [
  {
    id: "neutral",
    name: "无性格修正",
    modifiers: {},
  },
  {
    id: "atk_up_def_down",
    name: "物攻 +20%，物防 -10%",
    modifiers: {
      atk: 0.2,
      def: -0.1,
    },
  },
  {
    id: "atk_up_spa_down",
    name: "物攻 +20%，魔攻 -10%",
    modifiers: {
      atk: 0.2,
      spa: -0.1,
    },
  },
  {
    id: "spa_up_atk_down",
    name: "魔攻 +20%，物攻 -10%",
    modifiers: {
      spa: 0.2,
      atk: -0.1,
    },
  },
  {
    id: "def_up_spe_down",
    name: "物防 +20%，速度 -10%",
    modifiers: {
      def: 0.2,
      spe: -0.1,
    },
  },
  {
    id: "spd_up_atk_down",
    name: "魔防 +20%，物攻 -10%",
    modifiers: {
      spd: 0.2,
      atk: -0.1,
    },
  },
  {
    id: "spe_up_def_down",
    name: "速度 +20%，物防 -10%",
    modifiers: {
      spe: 0.2,
      def: -0.1,
    },
  },
  {
    id: "spe_up_spa_down",
    name: "速度 +20%，魔攻 -10%",
    modifiers: {
      spe: 0.2,
      spa: -0.1,
    },
  },
];
