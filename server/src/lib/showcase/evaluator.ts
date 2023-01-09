import db from "external/mongo/db";
import { GetFolderChartIDs } from "utils/folder";
import type {
	integer,
	ShowcaseStatDetails,
	ShowcaseStatChart,
	ShowcaseStatFolder,
} from "tachi-common";

export function EvaluateShowcaseStat(
	details: ShowcaseStatDetails,
	userID: integer
): Promise<{
	value: number | null;
	outOf?: number;
}> {
	switch (details.mode) {
		case "chart":
			return EvaluateShowcaseChartStat(details, userID);
		case "folder":
			return EvaluateShowcaseFolderStat(details, userID);

		default:
			// @ts-expect-error This should never happen anyway -- this ignore ignores a 'never' result.
			throw new Error(`Invalid mode of ${details.mode} as details mode?`);
	}
}

async function EvaluateShowcaseChartStat(details: ShowcaseStatChart, userID: integer) {
	// requires special handling
	if (details.property === "playcount") {
		return { value: await db.scores.count({ chartID: details.chartID, userID }) };
	}

	const mongoProp = PropToMongoProp(details.property);

	const pb = await db["personal-bests"].findOne(
		{ chartID: details.chartID, userID },
		{ projection: { [mongoProp]: 1 } }
	);

	if (!pb) {
		return { value: null };
	}

	const scProp = PropToScoreDataProp(details.property);

	return { value: pb.scoreData[scProp] };
}

async function EvaluateShowcaseFolderStat(details: ShowcaseStatFolder, userID: integer) {
	let chartIDs;

	if (Array.isArray(details.folderID)) {
		chartIDs = (await Promise.all(details.folderID.map(GetFolderChartIDs))).flat(1);
	} else {
		chartIDs = await GetFolderChartIDs(details.folderID);
	}

	const mongoProp = PropToMongoProp(details.property);

	const value = await db["personal-bests"].count({
		userID,

		// @optimisable - This is slightly inefficent, maybe we can use relational-style querying?
		chartID: { $in: chartIDs },
		[mongoProp]: { $gte: details.gte },
	});

	return { value, outOf: chartIDs.length };
}

function PropToMongoProp(prop: "grade" | "lamp" | "percent" | "score") {
	switch (prop) {
		case "score":
			return "scoreData.score";
		case "lamp":
			return "scoreData.lampIndex";
		case "grade":
			return "scoreData.gradeIndex";
		case "percent":
			return [`scoreData.${gptConfig.defaultMetric}`];
	}
}

function PropToScoreDataProp(prop: "grade" | "lamp" | "percent" | "score") {
	switch (prop) {
		case "score":
			return "score";
		case "lamp":
			return "lampIndex";
		case "grade":
			return "gradeIndex";
		case "percent":
			return "percent";
	}
}
