import { GPT_PB_DEFAULT_REF_NAMES, GPT_PB_MERGE_FNS } from "./mergers/mergers";
import { CreateScoreCalcData } from "../calculated-data/score";
import { CreateEnumIndexes } from "../score-importing/derivers";
import db from "external/mongo/db";
import { GetEveryonesRivalIDs } from "lib/rivals/rivals";
import { GetGPTConfig, GetGamePTConfig } from "tachi-common";
import type { KtLogger } from "lib/logger/logger";
import type { BulkWriteUpdateOneOperation, FilterQuery } from "mongodb";
import type {
	GPTString,
	Game,
	PBScoreDocument,
	Playtype,
	ScoreDocument,
	integer,
	ChartDocument,
} from "tachi-common";

export type PBScoreDocumentNoRank<GPT extends GPTString = GPTString> = Omit<
	PBScoreDocument<GPT>,
	"rankingData"
>;

/**
 * Create a PB document for this user on this chart. Optionally, provide an "As Of"
 * timestamp to constrain the generated PB to only one before the provided time.
 */
export async function CreatePBDoc(
	gpt: GPTString,
	userID: integer,
	chart: ChartDocument,
	logger: KtLogger,
	asOfTimestamp?: number
) {
	const chartID = chart.chartID;

	const query: FilterQuery<ScoreDocument> = {
		userID,
		chartID,
	};

	if (asOfTimestamp !== undefined) {
		query.timeAchieved = { $lt: asOfTimestamp };
	}

	const gptConfig = GetGPTConfig(gpt);

	const defaultMetricPB = await db.scores.findOne(query, {
		sort: {
			[`scoreData.${gptConfig.defaultMetric}`]: -1,
		},
	});

	if (!defaultMetricPB) {
		if (asOfTimestamp !== undefined) {
			// if we were constraining the PB on a timestamp, this is likely to happen.
			// ignore it.
			return;
		}

		logger.warn(
			`User ${userID} has no scores on chart, but a PB was attempted to be created?`,
			{
				chartID,
				userID,
			}
		);
		return;
	}

	const pbDoc: PBScoreDocumentNoRank = {
		composedFrom: [
			{
				name: GPT_PB_DEFAULT_REF_NAMES[gpt],
				scoreID: defaultMetricPB.scoreID,
			},
		],
		chartID: defaultMetricPB.chartID,
		userID,
		songID: defaultMetricPB.songID,
		highlight: defaultMetricPB.highlight,
		timeAchieved: defaultMetricPB.timeAchieved,
		game: defaultMetricPB.game,
		playtype: defaultMetricPB.playtype,
		isPrimary: defaultMetricPB.isPrimary,
		scoreData: defaultMetricPB.scoreData,
		calculatedData: defaultMetricPB.calculatedData,
	};

	const mergeFunctions = GPT_PB_MERGE_FNS[gpt];

	for (const mergeFn of mergeFunctions) {
		// these must happen in sync.
		// eslint-disable-next-line no-await-in-loop
		const ref = await mergeFn(
			userID,
			defaultMetricPB.chartID,
			asOfTimestamp ?? null,
			// silly cast because of potential GPT incompatibilities.
			// sorry!
			pbDoc as any
		);

		if (ref) {
			pbDoc.composedFrom.push(ref);
		}
	}

	// update any enum indexes that might've been altered
	const { indexes, optionalIndexes } = CreateEnumIndexes(gpt, pbDoc.scoreData, logger);

	pbDoc.scoreData.enumIndexes = indexes;
	pbDoc.scoreData.optional.enumIndexes = optionalIndexes;

	// Recalc info about this score (incase things have changed).
	pbDoc.calculatedData = CreateScoreCalcData(pbDoc.game, pbDoc.scoreData, chart);

	// finally, return our full pbDoc, that does NOT have the ranking props.
	// (We will add those later)
	return pbDoc;
}

/**
 * Updates rankings on a given chart.
 */
export async function UpdateChartRanking(game: Game, playtype: Playtype, chartID: string) {
	const gptConfig = GetGamePTConfig(game, playtype);

	const scores = await db["personal-bests"].find(
		{ chartID },
		{
			sort: {
				[`scoreData.${gptConfig.defaultMetric}`]: -1,
				timeAchieved: 1,
			},
		}
	);

	const allRivals = await GetEveryonesRivalIDs(game, playtype);

	const bwrite: Array<BulkWriteUpdateOneOperation<PBScoreDocument>> = [];

	let rank = 0;

	// what users have we saw so far? used for rivalRanking calculations
	const seenUserIDs: Array<integer> = [];

	for (const score of scores) {
		rank++;
		seenUserIDs.push(score.userID);

		const thisUsersRivals = allRivals[score.userID];

		let rivalRank: integer | null = null;

		if (thisUsersRivals && thisUsersRivals.length > 0) {
			rivalRank = thisUsersRivals.filter((e) => seenUserIDs.includes(e)).length + 1;
		}

		bwrite.push({
			updateOne: {
				filter: { chartID: score.chartID, userID: score.userID },
				update: {
					$set: {
						rankingData: {
							rank,
							outOf: scores.length,
							rivalRank,
						},
					},
				},
			},
		});
	}

	// If a score is deleted such that the chart is now empty of
	// scores, the below statement will crash with no op specified.
	if (bwrite.length === 0) {
		return;
	}

	await db["personal-bests"].bulkWrite(bwrite, { ordered: false });
}
