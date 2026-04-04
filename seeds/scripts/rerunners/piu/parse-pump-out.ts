// @ts-nocheck
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { WriteCollection } from "../../util";
import { ApplyPIUCutSuffix, NormalizePIUTitle } from "../../../../common/src/lib/piu";
import type { ChartDocument, SongDocument } from "tachi-common";
import type { PIUVersionKey } from "../../../../common/src/lib/piu";

const logger = {
	info: (message: string) => console.info(`[parse-pump-out] ${message}`),
	warn: (message: string) => console.warn(`[parse-pump-out] ${message}`),
};

const DEFAULT_SOURCE_DIR =
	process.env.PIU_DUMP_DIR ??
	"C:/Users/Boazb/Google Drive/Arcade/Pump/Database export new Dec 23, 2025";

// Pump Out's latest Prime 2 snapshot currently exposes v2.05.0 as version 143.
const TARGET_VERSIONS = {
	Prime2: 143,
	XX: 176,
	Phoenix: 199,
} as const;

const TARGET_VERSION_ORDER: Record<PIUVersionKey, number> = {
	Prime2: 0,
	XX: 1,
	Phoenix: 2,
};

interface VersionedLog {
	versionId: number;
	operationId: number;
}

interface SongRow {
	songId: number;
	cutId: number;
	internalTitle: string;
}

interface SongVersionRow extends VersionedLog {
	songId: number;
}

interface SongTitleRow {
	songId: number;
	songTitleId: number;
	languageId: number;
	title: string;
}

interface SongTitleVersionRow extends VersionedLog {
	songTitleId: number;
}

interface SongArtistRow {
	songId: number;
	artistId: number;
	prefix: string;
	sortOrder: number;
}

interface ArtistRow {
	artistId: number;
	internalTitle: string;
}

interface SongCardRow {
	songCardId: number;
	songId: number;
	path: string;
	sortOrder: number;
}

interface SongCardVersionRow extends VersionedLog {
	songCardId: number;
}

interface SongGameIdentifierRow {
	songGameIdentifierId: number;
	songId: number;
	gameIdentifier: string;
}

interface SongGameIdentifierVersionRow extends VersionedLog {
	songGameIdentifierId: number;
}

interface ChartRow {
	chartId: number;
	songId: number;
}

interface ChartVersionRow extends VersionedLog {
	chartId: number;
}

interface ChartRatingRow {
	chartRatingId: number;
	chartId: number;
	modeId: number;
	difficultyId: number;
}

interface ChartRatingVersionRow extends VersionedLog {
	chartRatingId: number;
}

interface ChartLabelRow {
	chartLabelId: number;
	chartId: number;
	labelId: number;
}

interface ChartLabelVersionRow extends VersionedLog {
	chartLabelId: number;
}

interface ChartStepmakerRow {
	chartId: number;
	stepmakerId: number;
	prefix: string;
	sortOrder: number;
}

interface StepmakerRow {
	stepmakerId: number;
	internalTitle: string;
}

interface CutRow {
	cutId: number;
	internalTitle: "Arcade" | "Short Cut" | "Remix" | "Full Song";
}

interface DifficultyRow {
	difficultyId: number;
	value: number | null;
}

interface ModeRow {
	modeId: number;
	internalTitle: string;
}

interface OperationRow {
	operationId: number;
	internalTitle: string;
}

interface AncestorRow {
	versionId: number;
	ancestorId: number;
	ancestorSortOrder: number;
}

interface LabelRow {
	labelId: number;
	internalTitle: string;
}

interface EffectiveSongState {
	englishTitle: string | null;
	gameIdentifier: string | null;
	songCardPath: string | null;
	versionKey: PIUVersionKey;
}

interface EffectiveChartState {
	labels: string[];
	level: string;
	levelNum: number;
	playtype: "Single" | "Double";
	sourceChartID: number;
	sourceChartRatingID: number;
	sourceDifficultyID: number;
	sourceModeID: number;
	stepmaker: string | null;
	songId: number;
	versionKey: PIUVersionKey;
}

interface VersionedChartState {
	level: string;
	levelNum: number;
	sourceChartID: number;
	sourceChartRatingID: number;
	sourceDifficultyID: number;
	sourceModeID: number;
}

function ReadJSON<T>(sourceDir: string, filename: string): T {
	const parsed = JSON.parse(fs.readFileSync(path.join(sourceDir, filename), "utf-8"));

	return (parsed ?? []) as T;
}

function MapByID<T extends Record<string, unknown>, K extends keyof T>(rows: T[], key: K) {
	return new Map(rows.map((row) => [row[key], row]));
}

function GroupBy<T extends Record<string, unknown>, K extends keyof T>(rows: T[], key: K) {
	const map = new Map<T[K], T[]>();

	for (const row of rows) {
		const value = row[key];
		const existing = map.get(value);

		if (existing) {
			existing.push(row);
		} else {
			map.set(value, [row]);
		}
	}

	return map;
}

function Dedup<T>(values: T[]) {
	return [...new Set(values)];
}

function LatestLogForTarget<T extends { versionId: number }>(
	logs: T[] | undefined,
	targetVersionId: number,
	ancestorSortOrders: Map<number, Map<number, number>>
) {
	if (!logs) {
		return null;
	}

	const ancestors = ancestorSortOrders.get(targetVersionId);

	if (!ancestors) {
		return null;
	}

	let latest: T | null = null;
	let latestSortOrder = -Infinity;

	for (const log of logs) {
		const ancestorSortOrder = ancestors.get(log.versionId);

		if (ancestorSortOrder === undefined || ancestorSortOrder < latestSortOrder) {
			continue;
		}

		latest = log;
		latestSortOrder = ancestorSortOrder;
	}

	return latest;
}

function IsDeleted(log: VersionedLog | null, operationNames: Map<number, string>) {
	if (!log) {
		return true;
	}

	return operationNames.get(log.operationId) === "DELETE";
}

function MakeChartID(sourceChartID: number, playtype: "Single" | "Double", level: string) {
	return crypto.createHash("sha1").update(`piu:${sourceChartID}:${playtype}:${level}`).digest("hex");
}

function MakeArtistString(
	songArtists: SongArtistRow[] | undefined,
	artistByID: Map<number, ArtistRow>
) {
	if (!songArtists || songArtists.length === 0) {
		return "Unknown Artist";
	}

	let artistString = "";

	for (const [index, songArtist] of songArtists
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.entries()) {
		const artist = artistByID.get(songArtist.artistId)?.internalTitle ?? "Unknown Artist";
		const prefix = songArtist.prefix?.trim() ?? "";

		if (index === 0) {
			artistString = artist;
			continue;
		}

		switch (prefix.toLowerCase()) {
			case "&":
			case "+":
			case "x":
			case "/":
				artistString += ` ${prefix} ${artist}`;
				break;
			case "feat":
			case "feat.":
				artistString += ` feat. ${artist}`;
				break;
			case "ft":
			case "ft.":
				artistString += ` ft. ${artist}`;
				break;
			default:
				artistString += prefix.length > 0 ? ` ${prefix} ${artist}` : `, ${artist}`;
				break;
		}
	}

	return artistString.trim();
}

function SplitPIUCutSuffix(title: string) {
	if (title.endsWith(" - SHORT CUT -")) {
		return {
			baseTitle: title.slice(0, -" - SHORT CUT -".length).trim(),
			cutSuffix: " - SHORT CUT -",
		};
	}

	if (title.endsWith(" - FULL SONG -")) {
		return {
			baseTitle: title.slice(0, -" - FULL SONG -".length).trim(),
			cutSuffix: " - FULL SONG -",
		};
	}

	return {
		baseTitle: title.trim(),
		cutSuffix: "",
	};
}

function MakePIUTitleAliases(rawTitle: string, cut: string) {
	const adjustedTitle = ApplyPIUCutSuffix(rawTitle, cut);
	const aliases = new Set<string>([adjustedTitle]);
	const { baseTitle, cutSuffix } = SplitPIUCutSuffix(adjustedTitle);

	if (baseTitle.endsWith(".")) {
		aliases.add(`${baseTitle.slice(0, -1).trim()}${cutSuffix}`);
	}

	const parenFeatMatch = baseTitle.match(/^(.*)\s+\(feat\.\s+(.+)\)$/iu);

	if (parenFeatMatch) {
		aliases.add(`${parenFeatMatch[1]!.trim()} feat. ${parenFeatMatch[2]!.trim()}${cutSuffix}`);
	}

	const plainFeatMatch = baseTitle.match(/^(.*)\s+feat\.\s+(.+)$/iu);

	if (plainFeatMatch) {
		aliases.add(`${plainFeatMatch[1]!.trim()} (feat. ${plainFeatMatch[2]!.trim()})${cutSuffix}`);
	}

	return [...aliases];
}

function ResolveLatestSongState(
	versionKey: PIUVersionKey,
	songId: number,
	songTitlesBySong: Map<number, SongTitleRow[]>,
	songTitleVersionsByTitle: Map<number, SongTitleVersionRow[]>,
	songCardsBySong: Map<number, SongCardRow[]>,
	songCardVersionsByCard: Map<number, SongCardVersionRow[]>,
	songGameIdentifiersBySong: Map<number, SongGameIdentifierRow[]>,
	songGameIdentifierVersionsByID: Map<number, SongGameIdentifierVersionRow[]>,
	ancestorSortOrders: Map<number, Map<number, number>>,
	operationNames: Map<number, string>
): EffectiveSongState {
	const targetVersionId = TARGET_VERSIONS[versionKey];

	const englishTitleCandidates = (songTitlesBySong.get(songId) ?? []).filter(
		(songTitle) => songTitle.languageId === 22
	);

	let englishTitle: string | null = null;
	let englishTitleSortOrder = -Infinity;

	for (const songTitle of englishTitleCandidates) {
		const latestLog = LatestLogForTarget(
			songTitleVersionsByTitle.get(songTitle.songTitleId),
			targetVersionId,
			ancestorSortOrders
		);

		if (IsDeleted(latestLog, operationNames)) {
			continue;
		}

		const sortOrder = ancestorSortOrders.get(targetVersionId)?.get(latestLog.versionId) ?? -Infinity;

		if (sortOrder >= englishTitleSortOrder) {
			englishTitle = songTitle.title;
			englishTitleSortOrder = sortOrder;
		}
	}

	let songCardPath: string | null = null;
	let songCardSortOrder = Infinity;
	let songCardVersionSortOrder = -Infinity;

	for (const songCard of songCardsBySong.get(songId) ?? []) {
		const latestLog = LatestLogForTarget(
			songCardVersionsByCard.get(songCard.songCardId),
			targetVersionId,
			ancestorSortOrders
		);

		if (IsDeleted(latestLog, operationNames)) {
			continue;
		}

		const versionSortOrder =
			ancestorSortOrders.get(targetVersionId)?.get(latestLog.versionId) ?? -Infinity;

		if (
			songCard.sortOrder < songCardSortOrder ||
			(songCard.sortOrder === songCardSortOrder && versionSortOrder >= songCardVersionSortOrder)
		) {
			songCardPath = songCard.path;
			songCardSortOrder = songCard.sortOrder;
			songCardVersionSortOrder = versionSortOrder;
		}
	}

	let gameIdentifier: string | null = null;
	let gameIdentifierSortOrder = -Infinity;

	for (const identifier of songGameIdentifiersBySong.get(songId) ?? []) {
		const latestLog = LatestLogForTarget(
			songGameIdentifierVersionsByID.get(identifier.songGameIdentifierId),
			targetVersionId,
			ancestorSortOrders
		);

		if (IsDeleted(latestLog, operationNames)) {
			continue;
		}

		const sortOrder = ancestorSortOrders.get(targetVersionId)?.get(latestLog.versionId) ?? -Infinity;

		if (sortOrder >= gameIdentifierSortOrder) {
			gameIdentifier = identifier.gameIdentifier;
			gameIdentifierSortOrder = sortOrder;
		}
	}

	return {
		englishTitle,
		gameIdentifier,
		songCardPath,
		versionKey,
	};
}

function main() {
	if (!fs.existsSync(DEFAULT_SOURCE_DIR)) {
		throw new Error(
			`Could not find Pump Out dump directory at ${DEFAULT_SOURCE_DIR}. Set PIU_DUMP_DIR if this lives somewhere else.`
		);
	}

	logger.info(`Reading Pump Out dump from ${DEFAULT_SOURCE_DIR}.`);

	const songs = ReadJSON<SongRow[]>(DEFAULT_SOURCE_DIR, "song.json");
	const songVersions = ReadJSON<SongVersionRow[]>(DEFAULT_SOURCE_DIR, "songVersion.json");
	const songTitles = ReadJSON<SongTitleRow[]>(DEFAULT_SOURCE_DIR, "songTitle.json");
	const songTitleVersions = ReadJSON<SongTitleVersionRow[]>(
		DEFAULT_SOURCE_DIR,
		"songTitleVersion.json"
	);
	const artists = ReadJSON<ArtistRow[]>(DEFAULT_SOURCE_DIR, "artist.json");
	const songArtists = ReadJSON<SongArtistRow[]>(DEFAULT_SOURCE_DIR, "songArtist.json");
	const songCards = ReadJSON<SongCardRow[]>(DEFAULT_SOURCE_DIR, "songCard.json");
	const songCardVersions = ReadJSON<SongCardVersionRow[]>(
		DEFAULT_SOURCE_DIR,
		"songCardVersion.json"
	);
	const songGameIdentifiers = ReadJSON<SongGameIdentifierRow[]>(
		DEFAULT_SOURCE_DIR,
		"songGameIdentifier.json"
	);
	const songGameIdentifierVersions = ReadJSON<SongGameIdentifierVersionRow[]>(
		DEFAULT_SOURCE_DIR,
		"songGameIdentifierVersion.json"
	);
	const charts = ReadJSON<ChartRow[]>(DEFAULT_SOURCE_DIR, "chart.json");
	const chartVersions = ReadJSON<ChartVersionRow[]>(DEFAULT_SOURCE_DIR, "chartVersion.json");
	const chartRatings = ReadJSON<ChartRatingRow[]>(DEFAULT_SOURCE_DIR, "chartRating.json");
	const chartRatingVersions = ReadJSON<ChartRatingVersionRow[]>(
		DEFAULT_SOURCE_DIR,
		"chartRatingVersion.json"
	);
	const chartLabels = ReadJSON<ChartLabelRow[]>(DEFAULT_SOURCE_DIR, "chartLabel.json");
	const chartLabelVersions = ReadJSON<ChartLabelVersionRow[]>(
		DEFAULT_SOURCE_DIR,
		"chartLabelVersion.json"
	);
	const chartStepmakers = ReadJSON<ChartStepmakerRow[]>(DEFAULT_SOURCE_DIR, "chartStepmaker.json");
	const stepmakers = ReadJSON<StepmakerRow[]>(DEFAULT_SOURCE_DIR, "stepmaker.json");
	const cuts = ReadJSON<CutRow[]>(DEFAULT_SOURCE_DIR, "cut.json");
	const difficulties = ReadJSON<DifficultyRow[]>(DEFAULT_SOURCE_DIR, "difficulty.json");
	const modes = ReadJSON<ModeRow[]>(DEFAULT_SOURCE_DIR, "mode.json");
	const operations = ReadJSON<OperationRow[]>(DEFAULT_SOURCE_DIR, "operation.json");
	const labels = ReadJSON<LabelRow[]>(DEFAULT_SOURCE_DIR, "label.json");
	const ancestors = ReadJSON<AncestorRow[]>(DEFAULT_SOURCE_DIR, "_derived_versionAncestor.json");

	const songByID = MapByID(songs, "songId");
	const artistByID = MapByID(artists, "artistId");
	const cutByID = MapByID(cuts, "cutId");
	const difficultyByID = MapByID(difficulties, "difficultyId");
	const modeByID = MapByID(modes, "modeId");
	const labelByID = MapByID(labels, "labelId");
	const stepmakerByID = MapByID(stepmakers, "stepmakerId");
	const operationNames = new Map(operations.map((operation) => [operation.operationId, operation.internalTitle]));

	const songVersionsBySong = GroupBy(songVersions, "songId");
	const songTitlesBySong = GroupBy(songTitles, "songId");
	const songTitleVersionsByTitle = GroupBy(songTitleVersions, "songTitleId");
	const songArtistsBySong = GroupBy(songArtists, "songId");
	const songCardsBySong = GroupBy(songCards, "songId");
	const songCardVersionsByCard = GroupBy(songCardVersions, "songCardId");
	const songGameIdentifiersBySong = GroupBy(songGameIdentifiers, "songId");
	const songGameIdentifierVersionsByID = GroupBy(songGameIdentifierVersions, "songGameIdentifierId");
	const chartVersionsByChart = GroupBy(chartVersions, "chartId");
	const chartRatingsByChart = GroupBy(chartRatings, "chartId");
	const chartRatingVersionsByRating = GroupBy(chartRatingVersions, "chartRatingId");
	const chartLabelsByChart = GroupBy(chartLabels, "chartId");
	const chartLabelVersionsByLabel = GroupBy(chartLabelVersions, "chartLabelId");
	const chartStepmakersByChart = GroupBy(chartStepmakers, "chartId");

	const ancestorSortOrders = new Map<number, Map<number, number>>();

	for (const ancestor of ancestors) {
		const existing = ancestorSortOrders.get(ancestor.versionId);

		if (existing) {
			existing.set(ancestor.ancestorId, ancestor.ancestorSortOrder);
		} else {
			ancestorSortOrders.set(
				ancestor.versionId,
				new Map([[ancestor.ancestorId, ancestor.ancestorSortOrder]])
			);
		}
	}

	const effectiveCharts: EffectiveChartState[] = [];
	const excludedDifficultyRows: string[] = [];
	const songStatesBySong = new Map<number, EffectiveSongState[]>();

	for (const versionKey of Object.keys(TARGET_VERSIONS) as PIUVersionKey[]) {
		const targetVersionId = TARGET_VERSIONS[versionKey];

		const activeSongIDs = new Set<number>();

		for (const song of songs) {
			const latestLog = LatestLogForTarget(
				songVersionsBySong.get(song.songId),
				targetVersionId,
				ancestorSortOrders
			);

			if (!IsDeleted(latestLog, operationNames)) {
				activeSongIDs.add(song.songId);
			}
		}

		for (const songId of activeSongIDs) {
			const state = ResolveLatestSongState(
				versionKey,
				songId,
				songTitlesBySong,
				songTitleVersionsByTitle,
				songCardsBySong,
				songCardVersionsByCard,
				songGameIdentifiersBySong,
				songGameIdentifierVersionsByID,
				ancestorSortOrders,
				operationNames
			);

			const existingStates = songStatesBySong.get(songId);

			if (existingStates) {
				existingStates.push(state);
			} else {
				songStatesBySong.set(songId, [state]);
			}
		}

		for (const chart of charts) {
			const latestChartLog = LatestLogForTarget(
				chartVersionsByChart.get(chart.chartId),
				targetVersionId,
				ancestorSortOrders
			);

			if (IsDeleted(latestChartLog, operationNames) || !activeSongIDs.has(chart.songId)) {
				continue;
			}

			const availableRatings = chartRatingsByChart.get(chart.chartId) ?? [];
			let effectiveRating: ChartRatingRow | null = null;
			let effectiveRatingSortOrder = -Infinity;

			for (const rating of availableRatings) {
				const latestRatingLog = LatestLogForTarget(
					chartRatingVersionsByRating.get(rating.chartRatingId),
					targetVersionId,
					ancestorSortOrders
				);

				if (IsDeleted(latestRatingLog, operationNames)) {
					continue;
				}

				const ratingSortOrder =
					ancestorSortOrders.get(targetVersionId)?.get(latestRatingLog.versionId) ?? -Infinity;

				if (ratingSortOrder >= effectiveRatingSortOrder) {
					effectiveRating = rating;
					effectiveRatingSortOrder = ratingSortOrder;
				}
			}

			if (!effectiveRating) {
				continue;
			}

			const difficulty = difficultyByID.get(effectiveRating.difficultyId);
			const mode = modeByID.get(effectiveRating.modeId);

			if (!difficulty || !mode) {
				continue;
			}

			if (difficulty.value === null) {
				excludedDifficultyRows.push(
					`chartId=${chart.chartId}, chartRatingId=${effectiveRating.chartRatingId}, difficultyId=${difficulty.difficultyId}, version=${versionKey}, mode=${mode.internalTitle}`
				);
				continue;
			}

			if (mode.internalTitle !== "Single" && mode.internalTitle !== "Double") {
				continue;
			}

			const labelsForChart = (chartLabelsByChart.get(chart.chartId) ?? [])
				.filter((chartLabel) => {
					const latestChartLabelLog = LatestLogForTarget(
						chartLabelVersionsByLabel.get(chartLabel.chartLabelId),
						targetVersionId,
						ancestorSortOrders
					);

					return !IsDeleted(latestChartLabelLog, operationNames);
				})
				.map((chartLabel) => labelByID.get(chartLabel.labelId)?.internalTitle)
				.filter((label): label is string => label !== undefined)
				.sort();

			const stepmaker = Dedup(
				(chartStepmakersByChart.get(chart.chartId) ?? [])
					.slice()
					.sort((a, b) => a.sortOrder - b.sortOrder)
					.map((chartStepmaker) => {
						const stepmakerName =
							stepmakerByID.get(chartStepmaker.stepmakerId)?.internalTitle ?? "Unknown";

						return `${chartStepmaker.prefix ?? ""}${stepmakerName}`.trim();
					})
					.filter((value) => value.length > 0)
			).join(", ");

			effectiveCharts.push({
				labels: labelsForChart,
				level: difficulty.value.toString(),
				levelNum: difficulty.value,
				playtype: mode.internalTitle,
				sourceChartID: chart.chartId,
				sourceChartRatingID: effectiveRating.chartRatingId,
				sourceDifficultyID: effectiveRating.difficultyId,
				sourceModeID: effectiveRating.modeId,
				stepmaker: stepmaker.length > 0 ? stepmaker : null,
				songId: chart.songId,
				versionKey,
			});
		}
	}

	if (excludedDifficultyRows.length > 0) {
		logger.warn(
			`Excluded PIU chart ratings with null difficulty values: ${excludedDifficultyRows.join(
				"; "
			)}.`
		);
	}

	const songIDsInScope = Dedup(effectiveCharts.map((chart) => chart.songId)).sort((a, b) => a - b);
	const songDocuments: SongDocument<"piu">[] = [];

	for (const songId of songIDsInScope) {
		const sourceSong = songByID.get(songId);

		if (!sourceSong) {
			continue;
		}

		const cut = cutByID.get(sourceSong.cutId)?.internalTitle ?? "Arcade";
		const artist = MakeArtistString(songArtistsBySong.get(songId), artistByID);
		const states = (songStatesBySong.get(songId) ?? []).sort(
			(a, b) => TARGET_VERSION_ORDER[a.versionKey] - TARGET_VERSION_ORDER[b.versionKey]
		);
		const latestState = states[states.length - 1];

		const canonicalTitle = MakePIUTitleAliases(
			latestState?.englishTitle ?? sourceSong.internalTitle,
			cut
		)[0]!;

		const aliases = new Set<string>();

		for (const state of states) {
			for (const rawTitle of Dedup(
				[state.englishTitle, sourceSong.internalTitle].filter(
					(title): title is string => title !== null && title.length > 0
				)
			)) {
				for (const adjustedTitle of MakePIUTitleAliases(rawTitle, cut)) {
					aliases.add(adjustedTitle);
					aliases.add(`${artist} / ${adjustedTitle}`);
				}
			}
		}

		aliases.add(canonicalTitle);
		aliases.add(`${artist} / ${canonicalTitle}`);

		const allHumanAliases = [...aliases];

		songDocuments.push({
			altTitles: allHumanAliases.filter((alias) => alias !== canonicalTitle).sort(),
			artist,
			data: {
				cut,
				englishTitle: latestState?.englishTitle ?? null,
				gameIdentifier: latestState?.gameIdentifier ?? null,
				internalTitle: sourceSong.internalTitle,
				labels: [],
				songCardPath: latestState?.songCardPath ?? null,
				sourceSongID: sourceSong.songId,
			},
			id: sourceSong.songId,
			searchTerms: Dedup(allHumanAliases.map((alias) => NormalizePIUTitle(alias))).sort(),
			title: canonicalTitle,
		});
	}

	const chartGroups = new Map<string, EffectiveChartState[]>();

	for (const chart of effectiveCharts) {
		const key = `${chart.songId}|${chart.playtype}|${chart.sourceChartID}`;
		const existing = chartGroups.get(key);

		if (existing) {
			existing.push(chart);
		} else {
			chartGroups.set(key, [chart]);
		}
	}

	const chartDocuments: ChartDocument<"piu:Single" | "piu:Double">[] = [];

	for (const group of chartGroups.values()) {
		const sortedGroup = group
			.slice()
			.sort((a, b) => TARGET_VERSION_ORDER[a.versionKey] - TARGET_VERSION_ORDER[b.versionKey]);
		const newestChart = sortedGroup[sortedGroup.length - 1];

		const versions = Dedup(sortedGroup.map((chart) => chart.versionKey)).sort(
			(a, b) => TARGET_VERSION_ORDER[a] - TARGET_VERSION_ORDER[b]
		);
		const versionInfo = Object.fromEntries(
			sortedGroup.map((chart) => [
				chart.versionKey,
				{
					level: chart.level,
					levelNum: chart.levelNum,
					sourceChartID: chart.sourceChartID,
					sourceChartRatingID: chart.sourceChartRatingID,
					sourceDifficultyID: chart.sourceDifficultyID,
					sourceModeID: chart.sourceModeID,
				} satisfies VersionedChartState,
			])
		) as Partial<Record<PIUVersionKey, VersionedChartState>>;

		chartDocuments.push({
			chartID: MakeChartID(newestChart.sourceChartID, newestChart.playtype, newestChart.level),
			data: {
				labels: newestChart.labels,
				sourceChartID: newestChart.sourceChartID,
				sourceChartRatingID: newestChart.sourceChartRatingID,
				sourceDifficultyID: newestChart.sourceDifficultyID,
				sourceModeID: newestChart.sourceModeID,
				stepmaker: newestChart.stepmaker,
				versionInfo,
			},
			difficulty: newestChart.level,
			isPrimary: true,
			level: newestChart.level,
			levelNum: newestChart.levelNum,
			playtype: newestChart.playtype,
			songID: newestChart.songId,
			versions,
		});
	}

	const seenChartIDs = new Set<string>();

	for (const chart of chartDocuments) {
		if (seenChartIDs.has(chart.chartID)) {
			throw new Error(`Duplicate PIU chartID generated: ${chart.chartID}.`);
		}

		seenChartIDs.add(chart.chartID);
	}

	logger.info(
		`Writing ${songDocuments.length} Pump It Up songs and ${chartDocuments.length} Pump It Up charts.`
	);

	WriteCollection("songs-piu.json", songDocuments);
	WriteCollection("charts-piu.json", chartDocuments);
}

main();
