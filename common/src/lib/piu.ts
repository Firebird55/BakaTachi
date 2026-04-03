export const PIU_VERSION_KEYS = ["XX", "Phoenix"] as const;

export type PIUVersionKey = (typeof PIU_VERSION_KEYS)[number];

const PIU_SHORT_CUT_SUFFIX = " - SHORT CUT -";
const PIU_FULL_SONG_SUFFIX = " - FULL SONG -";

function StripExistingPIUCutMarker(title: string, cut: string | null | undefined) {
	const trimmedTitle = title.trim();

	switch (cut) {
		case "Short Cut":
			return trimmedTitle.replace(/\s*-?\s*SHORT CUT(?:\s*-\s*)?$/iu, "").trim();
		case "Full Song":
			return trimmedTitle
				.replace(/\s*-?\s*FULL SONG(?:\s+MIX)?(?:\s*-\s*)?$/iu, "")
				.trim();
		default:
			return trimmedTitle;
	}
}

export function GetPIUCutSuffix(cut: string | null | undefined) {
	switch (cut) {
		case "Short Cut":
			return PIU_SHORT_CUT_SUFFIX;
		case "Full Song":
			return PIU_FULL_SONG_SUFFIX;
		default:
			return "";
	}
}

export function ApplyPIUCutSuffix(title: string, cut: string | null | undefined) {
	const trimmedTitle = StripExistingPIUCutMarker(title, cut);
	const suffix = GetPIUCutSuffix(cut);

	if (suffix === "") {
		return trimmedTitle;
	}

	const upperTitle = trimmedTitle.toUpperCase();

	if (upperTitle.endsWith(suffix.trim())) {
		return trimmedTitle;
	}

	return `${trimmedTitle}${suffix}`;
}

export function NormalizePIUTitle(title: string) {
	return title
		.normalize("NFKC")
		.replace(/[‐-―]/gu, "-")
		.replace(/\s*\/\s*/gu, " / ")
		.replace(/\s+/gu, " ")
		.replace(/\s*-\s*SHORT CUT(?:\s*-\s*)?/giu, PIU_SHORT_CUT_SUFFIX)
		.replace(/\s*-\s*FULL SONG(?:\s*-\s*)?/giu, PIU_FULL_SONG_SUFFIX)
		.trim()
		.toUpperCase();
}

export function GetPIUPlaytypeShort(playtype: string) {
	switch (playtype) {
		case "Single":
			return "S";
		case "Double":
			return "D";
		default:
			return playtype;
	}
}
