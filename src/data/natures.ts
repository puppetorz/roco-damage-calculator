import type { Nature, StatKey } from "../types/battle";

const statLabels: Record<StatKey, string> = {
  hp: "生命",
  atk: "物攻",
  spa: "魔攻",
  def: "物防",
  spd: "魔防",
  spe: "速度",
};

const natureStatKeys: StatKey[] = ["hp", "atk", "spa", "def", "spd", "spe"];

const generatedNatures = natureStatKeys.flatMap((upKey) => {
  return natureStatKeys
    .filter((downKey) => downKey !== upKey)
    .map<Nature>((downKey) => ({
      id: `${upKey}_up_${downKey}_down`,
      name: `${statLabels[upKey]} +20%，${statLabels[downKey]} -10%`,
      modifiers: {
        [upKey]: 0.2,
        [downKey]: -0.1,
      },
    }));
});

export const natures: Nature[] = [
  {
    id: "neutral",
    name: "无性格修正",
    modifiers: {},
  },
  ...generatedNatures,
];
