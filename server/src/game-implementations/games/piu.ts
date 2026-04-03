import { GoalFmtScore, GoalOutOfFmtScore } from "./_common";
import { CreatePBMergeFor } from "game-implementations/utils/pb-merge";
import { FmtNum } from "tachi-common";
import type { GPTServerImplementation } from "game-implementations/types";

const PIU_IMPL_BASE: GPTServerImplementation<"piu:Single" | "piu:Double"> = {
	chartSpecificValidators: {},
	derivers: {},
	scoreCalcs: {
		pendingRating: () => null,
	},
	sessionCalcs: {
		pendingRating: () => null,
	},
	profileCalcs: {
		pendingRating: async () => null,
	},
	classDerivers: {},
	goalCriteriaFormatters: {
		score: GoalFmtScore,
	},
	goalOutOfFormatters: {
		score: GoalOutOfFmtScore,
	},
	goalProgressFormatters: {
		score: (pb) => FmtNum(pb.scoreData.score),
		grade: (pb) => pb.scoreData.grade,
		lamp: (pb) => pb.scoreData.lamp,
	},
	pbMergeFunctions: [
		CreatePBMergeFor("largest", "enumIndexes.lamp", "Best Lamp", (base, score) => {
			base.scoreData.lamp = score.scoreData.lamp;
		}),
	],
	defaultMergeRefName: "Best Score",
	scoreValidators: [],
};

export const PIU_SINGLE_IMPL: GPTServerImplementation<"piu:Single"> = PIU_IMPL_BASE;
export const PIU_DOUBLE_IMPL: GPTServerImplementation<"piu:Double"> = PIU_IMPL_BASE;
