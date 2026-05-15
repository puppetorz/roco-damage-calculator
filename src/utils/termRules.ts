import type { BattleMemberState } from "../types/battle";

export type TermRule = {
  term: string;
  category: "mark" | "negative" | "weather" | "other";
  sourceUrl: string;
  simulated: "full" | "partial" | "recorded";
  details: string;
};

export const LCX_TERMS_SOURCE_URL = "https://wiki.lcx.cab/lk/get_terms_data.php";

export const TERM_RULES: TermRule[] = [
  {
    term: "光合",
    category: "mark",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "每回合每层恢复1点能量。",
  },
  {
    term: "湿润",
    category: "mark",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "每层湿润印记使所有技能能耗-1。",
  },
  {
    term: "棘刺",
    category: "mark",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "非自动换人入场时每层造成6%最大生命值伤害，触发后层数保留。",
  },
  {
    term: "中毒",
    category: "negative",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "回合结束时每层造成3%最大生命伤害；属性克制暂不单独展开。",
  },
  {
    term: "灼烧",
    category: "negative",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "回合结束时每层造成2%最大生命伤害，并衰减一半向上取整，至少1层。",
  },
  {
    term: "冻结",
    category: "negative",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "partial",
    details: "行动失败近似已模拟；冻结生命不可用暂未完整模拟。",
  },
  {
    term: "萌化",
    category: "negative",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "partial",
    details: "状态层数已记录；种族值退化暂未完整模拟。",
  },
  {
    term: "折返",
    category: "other",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "释放后返回背包并替换入场。",
  },
  {
    term: "迅捷",
    category: "other",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "partial",
    details: "作为先手近似参与行动排序；换人入场立即释放暂未完整模拟。",
  },
  {
    term: "应对",
    category: "other",
    sourceUrl: LCX_TERMS_SOURCE_URL,
    simulated: "full",
    details: "若敌方本回合技能类型匹配，则触发应对窗口和后续效果。",
  },
];

export const TERM_MARKS = {
  photosynthesis: "光合",
  wet: "湿润",
  cute: "萌化",
  thorn: "棘刺",
} as const;

export function getTermMarkStacks(member: BattleMemberState, term: string): number {
  return member.marks[term] ?? 0;
}

export function getWetEnergyCostReduction(member: BattleMemberState): number {
  return getTermMarkStacks(member, TERM_MARKS.wet);
}

export function getPhotosynthesisEnergyGain(member: BattleMemberState): number {
  return getTermMarkStacks(member, TERM_MARKS.photosynthesis);
}

export function getTermRule(term: string): TermRule | undefined {
  return TERM_RULES.find((rule) => rule.term === term);
}
