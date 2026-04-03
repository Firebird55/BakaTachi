import { NumericSOV } from "util/sorts";
import { GPTClientImplementation } from "lib/types";
import { COLOUR_SET, GPTStrings } from "tachi-common";
import LampCell from "components/tables/cells/LampCell";
import MillionsScoreCell from "components/tables/cells/MillionsScoreCell";
import PIUJudgementCell from "components/tables/cells/PIUJudgementCell";
import RatingCell from "components/tables/cells/RatingCell";
import { GetEnumColour } from "lib/game-implementations";
import React from "react";

const PIU_ENUM_COLOURS: GPTClientImplementation<GPTStrings["piu"]>["enumColours"] = {
	grade: {
		"NO GRADE": COLOUR_SET.gray,
		F: COLOUR_SET.gray,
		D: COLOUR_SET.maroon,
		C: COLOUR_SET.red,
		B: COLOUR_SET.purple,
		A: COLOUR_SET.blue,
		"A PLUS": COLOUR_SET.vibrantBlue,
		AA: COLOUR_SET.green,
		"AA PLUS": COLOUR_SET.vibrantGreen,
		AAA: COLOUR_SET.gold,
		"AAA PLUS": COLOUR_SET.vibrantYellow,
		S: COLOUR_SET.orange,
		"S PLUS": COLOUR_SET.vibrantOrange,
		SS: COLOUR_SET.teal,
		"SS PLUS": COLOUR_SET.vibrantPink,
		SSS: COLOUR_SET.white,
		"SSS PLUS": COLOUR_SET.white,
	},
	lamp: {
		FAILED: COLOUR_SET.vibrantRed,
		CLEAR: COLOUR_SET.green,
		"ROUGH GAME": COLOUR_SET.purple,
		"FAIR GAME": COLOUR_SET.blue,
		"TALENTED GAME": COLOUR_SET.vibrantBlue,
		"MARVELOUS GAME": COLOUR_SET.gold,
		"SUPERB GAME": COLOUR_SET.teal,
		"EXTREME GAME": COLOUR_SET.vibrantOrange,
		"ULTIMATE GAME": COLOUR_SET.vibrantPink,
		"PERFECT GAME": COLOUR_SET.white,
	},
};

const PIU_HEADERS: GPTClientImplementation<GPTStrings["piu"]>["scoreHeaders"] = [
	["Score", "Score", NumericSOV((x) => x.scoreData.score)],
	["Judgements", "Hits", NumericSOV((x) => x.scoreData.score)],
	["Lamp", "Lamp", NumericSOV((x) => x.scoreData.enumIndexes.lamp)],
];

const PIU_CORE_CELLS: GPTClientImplementation<GPTStrings["piu"]>["scoreCoreCells"] = ({ sc }) => (
	<>
		<MillionsScoreCell
			score={sc.scoreData.score}
			grade={sc.scoreData.grade}
			colour={GetEnumColour(sc, "grade")}
		/>
		<PIUJudgementCell score={sc} />
		<LampCell lamp={sc.scoreData.lamp} colour={GetEnumColour(sc, "lamp")} />
	</>
);

const PIU_RATING_CELL: GPTClientImplementation<GPTStrings["piu"]>["ratingCell"] = ({
	sc,
	rating,
}) => <RatingCell score={sc} rating={rating} />;

const PIU_BASE_IMPL: GPTClientImplementation<GPTStrings["piu"]> = {
	sessionImportantScoreCount: 20,
	difficultyColours: {
		CHART: COLOUR_SET.gray,
	},
	enumColours: PIU_ENUM_COLOURS,
	enumIcons: {
		grade: "sort-alpha-up",
		lamp: "lightbulb",
	},
	classColours: {},
	ratingSystems: [],
	ratingAlgNameOverrides: {
		score: {
			pendingRating: "Pending Rating",
		},
		session: {
			pendingRating: "Pending Rating",
		},
		profile: {
			pendingRating: "Pending Rating",
		},
	},
	scoreHeaders: PIU_HEADERS,
	scoreCoreCells: PIU_CORE_CELLS,
	ratingCell: PIU_RATING_CELL,
};

export const PIU_SINGLE_IMPL: GPTClientImplementation<"piu:Single"> = PIU_BASE_IMPL;
export const PIU_DOUBLE_IMPL: GPTClientImplementation<"piu:Double"> = PIU_BASE_IMPL;
