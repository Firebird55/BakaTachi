require("ts-node/register");

const { ResolvePIUSongAndChartOnTitle } = require("../server/src/lib/score-import/import-types/common/piu.ts");

async function main() {
	const samples = [
		{
			identifier: "DM Ashura / Allegro Più Mosso",
			difficulty: "17",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "DASU / 8 6",
			difficulty: "16",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "DASU / 8 6 - FULL SONG -",
			difficulty: "21",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "5argon / Rave'til the earth's end",
			difficulty: "15",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "Brandy / The Festival of Ghost2 (Sneak)",
			difficulty: "16",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "MAX / Kasou Shinja仮装信者",
			difficulty: "16",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "バクステ外神田一丁目 \nBakusute Sotokanda Icchome / ヨロピク ピクヨロ！\nYoropiku Pikuyoro !",
			difficulty: "16",
			playtype: "Single",
			version: "Phoenix",
		},
		{
			identifier: "Nato / Nyarlathotep",
			difficulty: "0",
			playtype: "Single",
			version: "Phoenix",
		},
	];

	for (const sample of samples) {
		const result = await ResolvePIUSongAndChartOnTitle({
			game: "piu",
			...sample,
		});

		console.log(`=== ${sample.identifier} ===`);
		console.log(
			JSON.stringify(
				result && {
					songID: result.song.id,
					title: result.song.title,
					chartID: result.chart.chartID,
					difficulty: result.chart.difficulty,
					playtype: result.chart.playtype,
					versions: result.chart.versions,
				},
				null,
				2
			)
		);
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
