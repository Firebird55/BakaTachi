import { IsNullish } from "util/misc";
import React from "react";
import { COLOUR_SET, PBScoreDocument, ScoreDocument } from "tachi-common";

export default function PIUJudgementCell({
	score,
}: {
	score: ScoreDocument<"piu:Single" | "piu:Double"> | PBScoreDocument<"piu:Single" | "piu:Double">;
}) {
	const judgements = score.scoreData.judgements;

	if (
		IsNullish(judgements.perfect) ||
		IsNullish(judgements.great) ||
		IsNullish(judgements.good) ||
		IsNullish(judgements.bad) ||
		IsNullish(judgements.miss)
	) {
		return <td>No Data.</td>;
	}

	return (
		<td>
			<strong>
				<span style={{ color: COLOUR_SET.white }}>{judgements.perfect}</span>-
				<span style={{ color: COLOUR_SET.gold }}>{judgements.great}</span>-
				<span style={{ color: COLOUR_SET.blue }}>{judgements.good}</span>-
				<span style={{ color: COLOUR_SET.orange }}>{judgements.bad}</span>-
				<span style={{ color: COLOUR_SET.red }}>{judgements.miss}</span>
			</strong>
		</td>
	);
}
