import { FmtNum } from "../../utils/util";
import { zodNonNegativeInt } from "../config-utils";
import { p } from "prudence";
import { z } from "zod";
import type { INTERNAL_GAME_CONFIG, INTERNAL_GAME_PT_CONFIG } from "../../types/internals";

export const PIU_CONF = {
	name: "Pump It Up",
	playtypes: ["Single", "Double"],
	songData: z.strictObject({
		cut: z.enum(["Arcade", "Short Cut", "Remix", "Full Song"]),
		englishTitle: z.nullable(z.string()),
		gameIdentifier: z.nullable(z.string()),
		internalTitle: z.string(),
		labels: z.array(z.string()),
		songCardPath: z.nullable(z.string()),
		sourceSongID: zodNonNegativeInt,
	}),
} as const satisfies INTERNAL_GAME_CONFIG;

const PIU_GRADE_VALUES = [
	"NO GRADE",
	"F",
	"D",
	"C",
	"B",
	"A",
	"A PLUS",
	"AA",
	"AA PLUS",
	"AAA",
	"AAA PLUS",
	"S",
	"S PLUS",
	"SS",
	"SS PLUS",
	"SSS",
	"SSS PLUS",
] as const;

const PIU_LAMP_VALUES = [
	"FAILED",
	"CLEAR",
	"ROUGH GAME",
	"FAIR GAME",
	"TALENTED GAME",
	"MARVELOUS GAME",
	"SUPERB GAME",
	"EXTREME GAME",
	"ULTIMATE GAME",
	"PERFECT GAME",
] as const;

const PIU_VERSIONED_CHART_DATA = z.strictObject({
	level: z.string(),
	levelNum: zodNonNegativeInt,
	sourceChartID: zodNonNegativeInt,
	sourceChartRatingID: zodNonNegativeInt,
	sourceDifficultyID: zodNonNegativeInt,
	sourceModeID: zodNonNegativeInt,
});

const PIU_GPT_CONF = {
	providedMetrics: {
		score: {
			type: "INTEGER",
			validate: p.isBetween(0, 9_999_999),
			formatter: FmtNum,
			description: "The Pump It Up score value.",
		},
		grade: {
			type: "ENUM",
			values: PIU_GRADE_VALUES,
			minimumRelevantValue: "A",
			description:
				"The grade this score achieved. Some sources omit this, in which case we store NO GRADE.",
		},
		lamp: {
			type: "ENUM",
			values: PIU_LAMP_VALUES,
			minimumRelevantValue: "CLEAR",
			description: "The clear state or plate this score achieved.",
		},
	},

	derivedMetrics: {},

	optionalMetrics: {
		maxCombo: {
			type: "INTEGER",
			validate: p.isBoundedInteger(0, 9_999_999),
			formatter: FmtNum,
			description: "The maximum combo reached during this score.",
		},
	},

	defaultMetric: "score",
	preferredDefaultEnum: "lamp",

	scoreRatingAlgs: {
		pendingRating: {
			description:
				"Placeholder rating while official Pump It Up score rating support is still pending.",
		},
	},
	sessionRatingAlgs: {
		pendingRating: {
			description:
				"Placeholder session rating while official Pump It Up score rating support is still pending.",
		},
	},
	profileRatingAlgs: {
		pendingRating: {
			description:
				"Placeholder profile rating while official Pump It Up score rating support is still pending.",
			associatedScoreAlgs: ["pendingRating"],
		},
	},

	defaultScoreRatingAlg: "pendingRating",
	defaultSessionRatingAlg: "pendingRating",
	defaultProfileRatingAlg: "pendingRating",

	difficulties: {
		type: "DYNAMIC",
	},

	classes: {},

	orderedJudgements: ["perfect", "great", "good", "bad", "miss"],

	versions: {
		Prime2: "Prime2",
		XX: "XX",
		Phoenix: "Phoenix",
	},

	chartData: z.strictObject({
		labels: z.array(z.string()),
		sourceChartID: zodNonNegativeInt,
		sourceChartRatingID: zodNonNegativeInt,
		sourceDifficultyID: zodNonNegativeInt,
		sourceModeID: zodNonNegativeInt,
		stepmaker: z.nullable(z.string()),
		versionInfo: z.strictObject({
			Prime2: PIU_VERSIONED_CHART_DATA.optional(),
			XX: PIU_VERSIONED_CHART_DATA.optional(),
			Phoenix: PIU_VERSIONED_CHART_DATA.optional(),
		}),
	}),

	preferences: z.strictObject({}),
	scoreMeta: z.strictObject({}),

	supportedMatchTypes: ["songTitle", "tachiSongID"],
} as const satisfies INTERNAL_GAME_PT_CONFIG;

export const PIU_SINGLE_CONF = PIU_GPT_CONF;
export const PIU_DOUBLE_CONF = PIU_GPT_CONF;
