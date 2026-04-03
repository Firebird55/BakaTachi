import {
	AmbiguousTitleFailure,
	InvalidScoreFailure,
} from "../../framework/common/converter-failures";
import { EscapeStringRegexp } from "utils/misc";
import db from "external/mongo/db";
import { FindChartWithPTDF } from "utils/queries/charts";
import { NormalizePIUTitle } from "tachi-common";
import type {
	ChartDocument,
	MatchTypeResolverWithDifficulty,
	ProvidedMetrics,
	SongDocument,
	Versions,
} from "tachi-common";

const PIU_GRADE_MAP = {
	F: "F",
	D: "D",
	C: "C",
	B: "B",
	A: "A",
	"A PLUS": "A PLUS",
	AA: "AA",
	"AA PLUS": "AA PLUS",
	AAA: "AAA",
	"AAA PLUS": "AAA PLUS",
	S: "S",
	"S PLUS": "S PLUS",
	SS: "SS",
	"SS PLUS": "SS PLUS",
	SSS: "SSS",
	"SSS PLUS": "SSS PLUS",
} as const satisfies Record<string, ProvidedMetrics["piu:Single"]["grade"]>;

const PIU_PLATE_MAP = {
	"ROUGH GAME": "ROUGH GAME",
	"FAIR GAME": "FAIR GAME",
	"TALENTED GAME": "TALENTED GAME",
	"MARVELOUS GAME": "MARVELOUS GAME",
	"SUPERB GAME": "SUPERB GAME",
	"EXTREME GAME": "EXTREME GAME",
	"ULTIMATE GAME": "ULTIMATE GAME",
	"PERFECT GAME": "PERFECT GAME",
} as const satisfies Record<string, Exclude<ProvidedMetrics["piu:Single"]["lamp"], "FAILED" | "CLEAR">>;

const PIU_GDPR_ALIAS_GROUPS = [
	{
		sources: ["5argon / Rave'til the earth's end", "Rave'til the earth's end"],
		targets: ["5argon / Rave 'til the Earth's End", "Rave 'til the Earth's End"],
	},
	{
		sources: ["BanYa / ikos Post", "ikos Post"],
		targets: ["BanYa / Csikos Post", "Csikos Post"],
	},
	{
		sources: [
			"Koharu feat. Senyata / Telling Fortune Fllower",
			"Telling Fortune Fllower",
		],
		targets: [
			"Koharu feat. Renyata / Telling Fortune Flower",
			"Telling Fortune Flower",
		],
	},
	{
		sources: [
			"BanYa / Love is a danger zone 2 (try to B.P.M.)",
			"Love is a danger zone 2 (try to B.P.M.)",
		],
		targets: [
			"BanYa / Love is a danger zone (try to B.P.M.)",
			"Love is a danger zone (try to B.P.M.)",
		],
	},
	{
		sources: ["BanYa / Tream Vook of the war", "Tream Vook of the war"],
		targets: ["BanYa / Tream Vook of the war REMIX", "Tream Vook of the war REMIX"],
	},
	{
		sources: ["BanYa / X-Tream", "X-Tream"],
		targets: ["BanYa / X Treme", "X Treme"],
	},
	{
		sources: ["MAX / Kasou Shinja仮装信者", "Kasou Shinja仮装信者"],
		targets: ["MAX / Kasou Shinja", "Kasou Shinja"],
	},
	{
		sources: [
			"TatshMusicCircle / Sora no shirabe",
			"Sora no shirabe",
		],
		targets: ["TatshMusicCircle / Sorano Shirabe", "Sorano Shirabe"],
	},
	{
		sources: [
			"Aragon / Visual Dream2 (In Fiction)",
			"Visual Dream2 (In Fiction)",
		],
		targets: ["Aragon / Visual Dream II (In Fiction)", "Visual Dream II (In Fiction)"],
	},
] as const;

const PIU_GDPR_ALIAS_MAP = new Map(
	PIU_GDPR_ALIAS_GROUPS.flatMap(({ sources, targets }) => {
		const normalisedTargets = [...new Set(targets.map((target) => NormalizePIUTitle(target)))];

		return sources.map((source) => [NormalizePIUTitle(source), normalisedTargets] as const);
	})
);

function NormalisePIUGradeKey(rawGrade: string) {
	return rawGrade
		.trim()
		.toUpperCase()
		.replace(/^\(F\)/u, "")
		.replace(/^BREAKED\s+/u, "")
		.replace(/\+/gu, " PLUS")
		.replace(/\s+/gu, " ")
		.trim();
}

function StripPIUDiacritics(value: string) {
	return value.normalize("NFKD").replace(/\p{M}/gu, "");
}

function GetPIUTextFragments(identifier: string) {
	const fragments: string[] = [];
	const seen = new Set<string>();

	const push = (value: string) => {
		const trimmed = value.trim();

		if (trimmed.length === 0 || seen.has(trimmed)) {
			return;
		}

		seen.add(trimmed);
		fragments.push(trimmed);
	};

	push(identifier);
	push(identifier.replace(/\r?\n/gu, " "));

	for (const line of identifier.split(/\r?\n/gu)) {
		push(line);
	}

	for (const fragment of [...fragments]) {
		const parts = fragment.split(/\s\/\s/gu).map((part) => part.trim()).filter(Boolean);

		if (parts.length > 1) {
			push(parts[parts.length - 1]!);
		}
	}

	return fragments;
}

function GetPIUTextVariants(fragment: string) {
	const variants: string[] = [];
	const seen = new Set<string>();

	const push = (value: string) => {
		const trimmed = value.trim();

		if (trimmed.length === 0 || seen.has(trimmed)) {
			return;
		}

		seen.add(trimmed);
		variants.push(trimmed);
	};

	const compactWhitespace = fragment.replace(/\r?\n/gu, " ").replace(/\s+/gu, " ").trim();
	const compactPunctuation = compactWhitespace.replace(/\s+([!?.,;:])/gu, "$1");
	const spacedParens = compactPunctuation
		.replace(/(?<=\S)\(/gu, " (")
		.replace(/\(\s+/gu, "(")
		.replace(/\s+\)/gu, ")");
	const withoutTrailingPeriods = compactPunctuation.replace(/\.+$/u, "");
	const diacriticless = StripPIUDiacritics(spacedParens);
	const mergedDigits = diacriticless.replace(/(?<=\d)\s+(?=\d)/gu, "");
	const spacedAlphaNumeric = mergedDigits
		.replace(/(?<=\p{L})(?=\d)/gu, " ")
		.replace(/(?<=\d)(?=\p{L})/gu, " ");

	push(fragment);
	push(compactWhitespace);
	push(compactPunctuation);
	push(spacedParens);
	push(withoutTrailingPeriods);
	push(StripPIUDiacritics(compactWhitespace));
	push(diacriticless);
	push(mergedDigits);
	push(spacedAlphaNumeric);
	push(spacedAlphaNumeric.replace(/\.+$/u, ""));

	return variants;
}

export function GetPIUTitleSearchCandidates(identifier: string) {
	const candidates: string[] = [];
	const seen = new Set<string>();

	const push = (value: string) => {
		const normalised = NormalizePIUTitle(value);

		if (normalised.length === 0 || seen.has(normalised)) {
			return;
		}

		seen.add(normalised);
		candidates.push(normalised);
	};

	for (const fragment of GetPIUTextFragments(identifier)) {
		for (const variant of GetPIUTextVariants(fragment)) {
			push(variant);

			for (const knownAlias of PIU_GDPR_ALIAS_MAP.get(NormalizePIUTitle(variant)) ?? []) {
				if (!seen.has(knownAlias)) {
					seen.add(knownAlias);
					candidates.push(knownAlias);
				}
			}
		}
	}

	return candidates;
}

export function ParsePIUVersion(rawVersion: string | null | undefined): Versions["piu:Single"] {
	const version = rawVersion?.trim().toUpperCase();

	switch (version) {
		case "XX":
			return "XX";
		case "PHOENIX":
			return "Phoenix";
		default:
			throw new InvalidScoreFailure(
				`Unsupported PIU version '${rawVersion ?? ""}'. Expected XX or Phoenix.`
			);
	}
}

export function ParsePIUPlaytype(rawPlaytype: string | null | undefined) {
	const playtype = rawPlaytype?.trim().toUpperCase();

	switch (playtype) {
		case "S":
		case "SINGLE":
			return "Single" as const;
		case "D":
		case "DOUBLE":
			return "Double" as const;
		default:
			return null;
	}
}

export function NormalisePIUGrade(
	rawGrade: string | null | undefined
): ProvidedMetrics["piu:Single"]["grade"] {
	if (rawGrade === null || rawGrade === undefined || rawGrade.trim() === "") {
		return "NO GRADE";
	}

	const normalised = NormalisePIUGradeKey(rawGrade);
	const mapped = PIU_GRADE_MAP[normalised as keyof typeof PIU_GRADE_MAP];

	if (mapped) {
		return mapped;
	}

	throw new InvalidScoreFailure(`Unsupported PIU grade '${rawGrade}'.`);
}

export function NormalisePIULamp(
	rawGrade: string | null | undefined,
	rawPlate: string | null | undefined,
	score: number
): ProvidedMetrics["piu:Single"]["lamp"] {
	const plate = rawPlate?.trim().toUpperCase() ?? "";

	if (plate.length > 0) {
		const mappedPlate = PIU_PLATE_MAP[plate as keyof typeof PIU_PLATE_MAP];

		if (!mappedPlate) {
			throw new InvalidScoreFailure(`Unsupported PIU plate '${rawPlate}'.`);
		}

		return mappedPlate;
	}

	const upperGrade = rawGrade?.trim().toUpperCase() ?? "";

	if (upperGrade.startsWith("(F)") || upperGrade.startsWith("BREAKED ") || score === 0) {
		return "FAILED";
	}

	return "CLEAR";
}

export function ParsePIUTimeAchieved(rawTimeAchieved: string | null | undefined) {
	if (rawTimeAchieved === null || rawTimeAchieved === undefined || rawTimeAchieved.trim() === "") {
		return null;
	}

	const trimmed = rawTimeAchieved.trim();

	if (/^\d+$/u.test(trimmed)) {
		const numeric = Number(trimmed);

		if (!Number.isSafeInteger(numeric) || numeric < 0) {
			throw new InvalidScoreFailure(`Invalid PIU timeAchieved '${rawTimeAchieved}'.`);
		}

		return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
	}

	const parsed = Date.parse(trimmed);

	if (Number.isNaN(parsed)) {
		throw new InvalidScoreFailure(`Invalid PIU timeAchieved '${rawTimeAchieved}'.`);
	}

	return parsed;
}

export async function FindPIUChartWithVersionedDifficulty(
	songID: number,
	playtype: "Single" | "Double",
	difficulty: string,
	version: Versions["piu:Single"] | null
) {
	if (version === null) {
		return FindChartWithPTDF("piu", songID, playtype, difficulty) as Promise<
			ChartDocument<"piu:Single" | "piu:Double"> | null
		>;
	}

	return db.charts.piu.findOne({
		songID,
		playtype,
		versions: version,
		[`data.versionInfo.${version}.level`]: difficulty,
	}) as Promise<ChartDocument<"piu:Single" | "piu:Double"> | null>;
}

export async function ResolvePIUSongAndChartOnTitle(
	resolver: MatchTypeResolverWithDifficulty & {
		game: "piu";
		playtype: "Single" | "Double";
		version: Versions["piu:Single"] | null;
	}
): Promise<{ song: SongDocument<"piu">; chart: ChartDocument<"piu:Single" | "piu:Double"> } | null> {
	const regexArtist = resolver.artist
		? new RegExp(`^${EscapeStringRegexp(resolver.artist)}$`, "iu")
		: null;

	let songs: SongDocument<"piu">[] = [];

	for (const identifierCandidate of GetPIUTitleSearchCandidates(resolver.identifier)) {
		songs = await db.songs.piu.find(
			{
				searchTerms: identifierCandidate,
				...(regexArtist ? { artist: { $regex: regexArtist } } : {}),
			},
			{
				limit: 32,
			}
		);

		if (songs.length > 0) {
			break;
		}
	}

	if (songs.length === 0) {
		return null;
	}

	const matches: Array<{
		song: SongDocument<"piu">;
		chart: ChartDocument<"piu:Single" | "piu:Double">;
	}> = [];

	for (const song of songs) {
		const chart = await FindPIUChartWithVersionedDifficulty(
			song.id,
			resolver.playtype,
			resolver.difficulty,
			resolver.version
		);

		if (chart) {
			matches.push({
				song,
				chart: chart as ChartDocument<"piu:Single" | "piu:Double">,
			});
		}
	}

	if (matches.length === 0) {
		return null;
	}

	if (matches.length > 1) {
		throw new AmbiguousTitleFailure(
			resolver.identifier,
			resolver.artist
				? `Multiple PIU songs matched '${resolver.identifier}' by '${resolver.artist}' on ${resolver.playtype} ${resolver.difficulty}${resolver.version ? ` (${resolver.version})` : ""}.`
				: `Multiple PIU songs matched '${resolver.identifier}' on ${resolver.playtype} ${resolver.difficulty}${resolver.version ? ` (${resolver.version})` : ""}.`
		);
	}

	return matches[0]!;
}
