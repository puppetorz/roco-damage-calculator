export type ElementName =
  | "草"
  | "火"
  | "水"
  | "光"
  | "土"
  | "冰"
  | "龙"
  | "电"
  | "毒"
  | "虫"
  | "武"
  | "翼"
  | "萌"
  | "幽"
  | "恶"
  | "普通"
  | "幻"
  | "机械";

export type TypeChart = Record<string, Record<string, number>>;

export const ELEMENTS = [
  "草",
  "火",
  "水",
  "光",
  "土",
  "冰",
  "龙",
  "电",
  "毒",
  "虫",
  "武",
  "翼",
  "萌",
  "幽",
  "恶",
  "普通",
  "幻",
  "机械",
] as const satisfies readonly ElementName[];

export const elementAliases: Record<string, ElementName> = {
  普: "普通",
  普通: "普通",
  普通系: "普通",
  机: "机械",
  机械: "机械",
  机械系: "机械",
  恶魔: "恶",
  恶魔系: "恶",
  草系: "草",
  火系: "火",
  水系: "水",
  光系: "光",
  土系: "土",
  地: "土",
  地系: "土",
  冰系: "冰",
  龙系: "龙",
  电系: "电",
  毒系: "毒",
  虫系: "虫",
  武系: "武",
  翼系: "翼",
  萌系: "萌",
  幽系: "幽",
  幽灵: "幽",
  幽灵系: "幽",
  幻系: "幻",
};

const singleDefenseRows: Record<ElementName, number[]> = {
  草: [1, 2, 0.5, 0.5, 0.5, 2, 1, 0.5, 2, 2, 1, 2, 1, 1, 1, 1, 1, 1],
  火: [0.5, 1, 2, 1, 2, 0.5, 1, 1, 1, 0.5, 1, 1, 0.5, 1, 1, 1, 1, 0.5],
  水: [2, 0.5, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5],
  光: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0.5, 1, 0.5, 1],
  土: [2, 0.5, 2, 1, 1, 2, 1, 0.5, 0.5, 1, 2, 0.5, 1, 1, 1, 0.5, 1, 2],
  冰: [1, 2, 0.5, 0.5, 2, 0.5, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2],
  龙: [0.5, 0.5, 0.5, 1, 1, 2, 2, 0.5, 1, 1, 1, 0.5, 2, 1, 1, 1, 1, 1],
  电: [1, 1, 1, 1, 2, 1, 1, 0.5, 1, 1, 1, 0.5, 1, 1, 1, 1, 1, 0.5],
  毒: [0.5, 1, 1, 1, 2, 1, 1, 1, 0.5, 0.5, 0.5, 1, 0.5, 1, 2, 1, 2, 1],
  虫: [0.5, 2, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 2, 1, 1, 1, 1, 1, 1],
  武: [1, 1, 1, 1, 0.5, 1, 1, 1, 1, 0.5, 1, 2, 2, 1, 0.5, 1, 2, 1],
  翼: [0.5, 1, 1, 1, 1, 2, 1, 2, 1, 0.5, 0.5, 1, 1, 1, 1, 1, 1, 1],
  萌: [1, 1, 1, 1, 1, 1, 1, 1, 2, 0.5, 0.5, 1, 1, 1, 2, 1, 1, 2],
  幽: [1, 1, 1, 2, 1, 1, 1, 1, 0.5, 0.5, 0.5, 1, 1, 2, 2, 0.5, 1, 1],
  恶: [1, 1, 1, 2, 1, 1, 1, 1, 1, 2, 2, 1, 2, 0.5, 0.5, 1, 1, 1],
  普通: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 0.5, 1, 1, 1, 1],
  幻: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0.5, 1, 1, 2, 1, 1, 0.5, 1],
  机械: [0.5, 2, 2, 1, 1, 0.5, 0.5, 1, 0.5, 0.5, 2, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5],
};

function toDefenseKey(elements: readonly ElementName[]): string {
  return elements.join("/");
}

function capWorldDualMultiplier(value: number): number {
  // 图片表中的双属性克制不出现传统 4 倍；目前先按单属性倍率相乘后封顶为 3。
  return Math.min(3, Number(value.toFixed(2)));
}

function createTypeChart(): TypeChart {
  const chart: TypeChart = Object.fromEntries(
    ELEMENTS.map((attackElement) => [attackElement, {}])
  );

  for (const defender of ELEMENTS) {
    for (const [attackIndex, attackElement] of ELEMENTS.entries()) {
      chart[attackElement][defender] = singleDefenseRows[defender][attackIndex];
    }
  }

  for (const firstDefender of ELEMENTS) {
    for (const secondDefender of ELEMENTS) {
      const defenseKey = toDefenseKey([firstDefender, secondDefender]);
      for (const attackElement of ELEMENTS) {
        chart[attackElement][defenseKey] = capWorldDualMultiplier(
          chart[attackElement][firstDefender] * chart[attackElement][secondDefender]
        );
      }
    }
  }

  return chart;
}

export const typeChart = createTypeChart();
