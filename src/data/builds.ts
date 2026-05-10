import {
  generatedBuilds,
  generatedRecommendedIndividualKeys,
} from "./generated/builds.generated";
import type { CommonBuild, StatKey } from "../types/battle";

export const builds: CommonBuild[] = generatedBuilds;

export const recommendedIndividualKeys: Record<string, StatKey[]> =
  generatedRecommendedIndividualKeys;
