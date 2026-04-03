import { GetPIUTitleSearchCandidates } from "./piu";
import { CleanUpAfterTests } from "test-utils/cleanup";
import fs from "fs";
import path from "path";
import t from "tap";
import type { ChartDocument } from "tachi-common";

const PIU_CHART_FIXTURE = JSON.parse(
	fs.readFileSync(
		path.resolve(__dirname, "../../../../test-utils/mock-db/charts-piu.json"),
		"utf-8"
	)
) as Array<ChartDocument<"piu:Single" | "piu:Double">>;

t.teardown(CleanUpAfterTests);

t.test("GetPIUTitleSearchCandidates normalises GDPR workbook title quirks.", (t) => {
	t.ok(
		GetPIUTitleSearchCandidates("5argon / Rave'til the earth's end").includes(
			"5ARGON / RAVE 'TIL THE EARTH'S END"
		),
		"Should resolve apostrophe spacing differences."
	);

	t.ok(
		GetPIUTitleSearchCandidates("Quree / Broken Karma(PIU Edit)").includes(
			"QUREE / BROKEN KARMA (PIU EDIT)"
		),
		"Should resolve missing spaces before parentheses."
	);

	t.ok(
		GetPIUTitleSearchCandidates("DASU / 8 6 - FULL SONG -").includes("DASU / 86 - FULL SONG -"),
		"Should collapse split numeric titles."
	);

	t.ok(
		GetPIUTitleSearchCandidates("DM Ashura / Allegro Più Mosso").includes(
			"DM ASHURA / ALLEGRO PIU MOSSO"
		),
		"Should resolve accent differences."
	);

	t.ok(
		GetPIUTitleSearchCandidates("BanYa / ikos Post").includes("BANYA / CSIKOS POST"),
		"Should resolve known workbook typos."
	);

	t.ok(
		GetPIUTitleSearchCandidates("TatshMusicCircle / Sora no shirabe").includes(
			"TATSHMUSICCIRCLE / SORANO SHIRABE"
		),
		"Should resolve known romanised title variants."
	);

	t.ok(
		GetPIUTitleSearchCandidates("BanYa / Love is a danger zone 2 (try to B.P.M.)").includes(
			"BANYA / LOVE IS A DANGER ZONE (TRY TO B.P.M.)"
		),
		"Should resolve known workbook title variants."
	);

	t.ok(
		GetPIUTitleSearchCandidates(
			"バクステ外神田一丁目\nBakusute Sotokanda Icchome / ヨロピク ピクヨロ！\nYoropiku Pikuyoro !"
		).includes("YOROPIKU PIKUYORO!"),
		"Should resolve multilingual workbook titles down to the English title."
	);

	t.end();
});

t.test("PIU chart seeds should canonicalise XX/Phoenix rerates.", (t) => {
	t.equal(PIU_CHART_FIXTURE.length, 4843, "Should collapse rerated PIU charts to 4843 docs.");

	const reratedCharts = PIU_CHART_FIXTURE.filter((chart) => {
		const xx = chart.data.versionInfo.XX;
		const phoenix = chart.data.versionInfo.Phoenix;

		return xx && phoenix && xx.level !== phoenix.level;
	});

	t.equal(reratedCharts.length, 715, "Should capture all 715 XX/Phoenix rerates.");

	const seenVersionKeys = new Set<string>();

	for (const chart of PIU_CHART_FIXTURE) {
		for (const version of chart.versions) {
			const versionInfo = chart.data.versionInfo[version];

			t.ok(versionInfo, `Chart ${chart.chartID} should have version info for ${version}.`);

			const key = `${version}|${chart.songID}|${chart.playtype}|${versionInfo!.level}`;
			t.notOk(
				seenVersionKeys.has(key),
				`Should not duplicate a same-version PIU chart at ${key}.`
			);
			seenVersionKeys.add(key);
		}
	}

	const superFantasyRerate = PIU_CHART_FIXTURE.find((chart) => chart.data.sourceChartID === 1699);

	t.hasStrict(superFantasyRerate, {
		chartID: "2842951845e49a4ba4c2bf3d99f00bfcfe689b33",
		songID: 288,
		playtype: "Double",
		level: "12",
		versions: ["XX", "Phoenix"],
		data: {
			sourceChartID: 1699,
			versionInfo: {
				XX: { level: "11" },
				Phoenix: { level: "12" },
			},
		},
	});

	t.end();
});
