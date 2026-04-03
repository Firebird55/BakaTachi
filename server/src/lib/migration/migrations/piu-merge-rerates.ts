/* eslint-disable no-await-in-loop */
import crypto from "crypto";
import db from "external/mongo/db";
import UpdateScore from "lib/score-mutation/update-score";
import type { Migration } from "utils/types";
import type { ChartDocument } from "tachi-common";

function MakeLegacyPIUChartID(sourceChartID: number, playtype: "Single" | "Double", level: string) {
	return crypto.createHash("sha1").update(`piu:${sourceChartID}:${playtype}:${level}`).digest("hex");
}

function GetPIURerateMappings(charts: Array<ChartDocument<"piu:Single" | "piu:Double">>) {
	const mappings = new Map<string, string>();

	for (const chart of charts) {
		const xx = chart.data.versionInfo.XX;
		const phoenix = chart.data.versionInfo.Phoenix;

		if (!xx || !phoenix || xx.level === phoenix.level) {
			continue;
		}

		const oldChartID = MakeLegacyPIUChartID(chart.data.sourceChartID, chart.playtype, xx.level);

		if (oldChartID !== chart.chartID) {
			mappings.set(oldChartID, chart.chartID);
		}
	}

	return mappings;
}

const migration: Migration = {
	id: "piu-merge-rerates",
	up: async () => {
		const charts = (await db.charts.piu.find({})) as Array<ChartDocument<"piu:Single" | "piu:Double">>;
		const mappings = GetPIURerateMappings(charts);

		for (const [oldChartID, newChartID] of mappings.entries()) {
			const scores = await db.scores.find({
				game: "piu",
				chartID: oldChartID,
			});

			for (const score of scores) {
				await UpdateScore(score, { ...score, chartID: newChartID });
			}
		}
	},
	down: () => {
		throw new Error(`Cannot undo migration.`);
	},
};

export default migration;
