#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import struct
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SECTOR_SIZE = 512
EXT4_SUPERBLOCK_OFFSET = 1024
EXT4_SUPERBLOCK_SIZE = 1024
EXT4_EXTENTS_FL = 0x00080000
EXT4_EXTENT_HEADER_MAGIC = 0xF30A

DEFAULT_PUMPOUT_DIR = Path(
	os.environ.get(
		"PIU_DUMP_DIR",
		"C:/Users/Boazb/Google Drive/Arcade/Pump/Database export new Dec 23, 2025",
	)
)
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"
TARGET_VERSION_ID = 143


def read_json(path: Path) -> list[dict[str, Any]]:
	return json.loads(path.read_text("utf-8"))


def map_by_id(rows: list[dict[str, Any]], key: str) -> dict[Any, dict[str, Any]]:
	return {row[key]: row for row in rows}


def group_by(rows: list[dict[str, Any]], key: str) -> dict[Any, list[dict[str, Any]]]:
	grouped: dict[Any, list[dict[str, Any]]] = defaultdict(list)

	for row in rows:
		grouped[row[key]].append(row)

	return grouped


def dedup(values: list[Any]) -> list[Any]:
	seen: set[Any] = set()
	result: list[Any] = []

	for value in values:
		if value in seen:
			continue

		seen.add(value)
		result.append(value)

	return result


def latest_log_for_target(
	logs: list[dict[str, Any]] | None,
	target_version_id: int,
	ancestor_sort_orders: dict[int, dict[int, int]],
) -> dict[str, Any] | None:
	if not logs:
		return None

	ancestors = ancestor_sort_orders.get(target_version_id)

	if ancestors is None:
		return None

	latest: dict[str, Any] | None = None
	latest_sort_order = float("-inf")

	for log in logs:
		ancestor_sort_order = ancestors.get(log["versionId"])

		if ancestor_sort_order is None or ancestor_sort_order < latest_sort_order:
			continue

		latest = log
		latest_sort_order = ancestor_sort_order

	return latest


def is_deleted(log: dict[str, Any] | None, operation_names: dict[int, str]) -> bool:
	if log is None:
		return True

	operation_id = log.get("operationId")

	if operation_id is None:
		return False

	return operation_names.get(operation_id) == "DELETE"


def make_artist_string(
	song_artists: list[dict[str, Any]] | None,
	artist_by_id: dict[int, dict[str, Any]],
) -> str:
	if not song_artists:
		return "Unknown Artist"

	artist_string = ""

	for index, song_artist in enumerate(sorted(song_artists, key=lambda row: row["sortOrder"])):
		artist = artist_by_id.get(song_artist["artistId"], {}).get("internalTitle", "Unknown Artist")
		prefix = (song_artist.get("prefix") or "").strip()

		if index == 0:
			artist_string = artist
			continue

		prefix_lower = prefix.lower()

		if prefix_lower in {"&", "+", "x", "/"}:
			artist_string += f" {prefix} {artist}"
		elif prefix_lower in {"feat", "feat."}:
			artist_string += f" feat. {artist}"
		elif prefix_lower in {"ft", "ft."}:
			artist_string += f" ft. {artist}"
		else:
			artist_string += f" {prefix} {artist}" if prefix else f", {artist}"

	return artist_string.strip()


def resolve_latest_song_state(
	target_version_id: int,
	song_id: int,
	song_titles_by_song: dict[int, list[dict[str, Any]]],
	song_title_versions_by_title: dict[int, list[dict[str, Any]]],
	song_cards_by_song: dict[int, list[dict[str, Any]]],
	song_card_versions_by_card: dict[int, list[dict[str, Any]]],
	song_game_identifiers_by_song: dict[int, list[dict[str, Any]]],
	song_game_identifier_versions_by_id: dict[int, list[dict[str, Any]]],
	ancestor_sort_orders: dict[int, dict[int, int]],
	operation_names: dict[int, str],
) -> dict[str, Any]:
	english_title: str | None = None
	english_title_sort_order = float("-inf")

	for song_title in song_titles_by_song.get(song_id, []):
		if song_title["languageId"] != 22:
			continue

		latest_log = latest_log_for_target(
			song_title_versions_by_title.get(song_title["songTitleId"]),
			target_version_id,
			ancestor_sort_orders,
		)

		if is_deleted(latest_log, operation_names):
			continue

		sort_order = ancestor_sort_orders.get(target_version_id, {}).get(latest_log["versionId"], -10**9)

		if sort_order >= english_title_sort_order:
			english_title = song_title["title"]
			english_title_sort_order = sort_order

	song_card_path: str | None = None
	song_card_sort_order = float("inf")
	song_card_version_sort_order = float("-inf")

	for song_card in song_cards_by_song.get(song_id, []):
		latest_log = latest_log_for_target(
			song_card_versions_by_card.get(song_card["songCardId"]),
			target_version_id,
			ancestor_sort_orders,
		)

		if is_deleted(latest_log, operation_names):
			continue

		version_sort_order = ancestor_sort_orders.get(target_version_id, {}).get(
			latest_log["versionId"], -10**9
		)

		if (
			song_card["sortOrder"] < song_card_sort_order
			or (
				song_card["sortOrder"] == song_card_sort_order
				and version_sort_order >= song_card_version_sort_order
			)
		):
			song_card_path = song_card["path"]
			song_card_sort_order = song_card["sortOrder"]
			song_card_version_sort_order = version_sort_order

	game_identifier: str | None = None
	game_identifier_sort_order = float("-inf")

	for identifier in song_game_identifiers_by_song.get(song_id, []):
		latest_log = latest_log_for_target(
			song_game_identifier_versions_by_id.get(identifier["songGameIdentifierId"]),
			target_version_id,
			ancestor_sort_orders,
		)

		if is_deleted(latest_log, operation_names):
			continue

		sort_order = ancestor_sort_orders.get(target_version_id, {}).get(latest_log["versionId"], -10**9)

		if sort_order >= game_identifier_sort_order:
			game_identifier = identifier["gameIdentifier"]
			game_identifier_sort_order = sort_order

	return {
		"englishTitle": english_title,
		"gameIdentifier": game_identifier,
		"songCardPath": song_card_path,
	}


def build_prime2_raw_dump(pumpout_dir: Path, target_version_id: int) -> dict[str, Any]:
	songs = read_json(pumpout_dir / "song.json")
	song_versions = read_json(pumpout_dir / "songVersion.json")
	song_titles = read_json(pumpout_dir / "songTitle.json")
	song_title_versions = read_json(pumpout_dir / "songTitleVersion.json")
	artists = read_json(pumpout_dir / "artist.json")
	song_artists = read_json(pumpout_dir / "songArtist.json")
	song_cards = read_json(pumpout_dir / "songCard.json")
	song_card_versions = read_json(pumpout_dir / "songCardVersion.json")
	song_game_identifiers = read_json(pumpout_dir / "songGameIdentifier.json")
	song_game_identifier_versions = read_json(pumpout_dir / "songGameIdentifierVersion.json")
	charts = read_json(pumpout_dir / "chart.json")
	chart_versions = read_json(pumpout_dir / "chartVersion.json")
	chart_ratings = read_json(pumpout_dir / "chartRating.json")
	chart_rating_versions = read_json(pumpout_dir / "chartRatingVersion.json")
	chart_labels = read_json(pumpout_dir / "chartLabel.json")
	chart_label_versions = read_json(pumpout_dir / "chartLabelVersion.json")
	chart_stepmakers = read_json(pumpout_dir / "chartStepmaker.json")
	stepmakers = read_json(pumpout_dir / "stepmaker.json")
	cuts = read_json(pumpout_dir / "cut.json")
	difficulties = read_json(pumpout_dir / "difficulty.json")
	modes = read_json(pumpout_dir / "mode.json")
	operations = read_json(pumpout_dir / "operation.json")
	labels = read_json(pumpout_dir / "label.json")
	ancestors = read_json(pumpout_dir / "_derived_versionAncestor.json")
	versions = read_json(pumpout_dir / "version.json")
	mixes = read_json(pumpout_dir / "mix.json")

	song_by_id = map_by_id(songs, "songId")
	artist_by_id = map_by_id(artists, "artistId")
	cut_by_id = map_by_id(cuts, "cutId")
	difficulty_by_id = map_by_id(difficulties, "difficultyId")
	mode_by_id = map_by_id(modes, "modeId")
	label_by_id = map_by_id(labels, "labelId")
	stepmaker_by_id = map_by_id(stepmakers, "stepmakerId")
	version_by_id = map_by_id(versions, "versionId")
	mix_by_id = map_by_id(mixes, "mixId")
	operation_names = {row["operationId"]: row["internalTitle"] for row in operations}

	song_versions_by_song = group_by(song_versions, "songId")
	song_titles_by_song = group_by(song_titles, "songId")
	song_title_versions_by_title = group_by(song_title_versions, "songTitleId")
	song_artists_by_song = group_by(song_artists, "songId")
	song_cards_by_song = group_by(song_cards, "songId")
	song_card_versions_by_card = group_by(song_card_versions, "songCardId")
	song_game_identifiers_by_song = group_by(song_game_identifiers, "songId")
	song_game_identifier_versions_by_id = group_by(song_game_identifier_versions, "songGameIdentifierId")
	chart_versions_by_chart = group_by(chart_versions, "chartId")
	chart_ratings_by_chart = group_by(chart_ratings, "chartId")
	chart_rating_versions_by_rating = group_by(chart_rating_versions, "chartRatingId")
	chart_labels_by_chart = group_by(chart_labels, "chartId")
	chart_label_versions_by_label = group_by(chart_label_versions, "chartLabelId")
	chart_stepmakers_by_chart = group_by(chart_stepmakers, "chartId")

	ancestor_sort_orders: dict[int, dict[int, int]] = defaultdict(dict)

	for ancestor in ancestors:
		ancestor_sort_orders[ancestor["versionId"]][ancestor["ancestorId"]] = ancestor["ancestorSortOrder"]

	active_song_ids: set[int] = set()

	for song in songs:
		latest_log = latest_log_for_target(
			song_versions_by_song.get(song["songId"]),
			target_version_id,
			ancestor_sort_orders,
		)

		if not is_deleted(latest_log, operation_names):
			active_song_ids.add(song["songId"])

	rows: list[dict[str, Any]] = []

	for chart in charts:
		latest_chart_log = latest_log_for_target(
			chart_versions_by_chart.get(chart["chartId"]),
			target_version_id,
			ancestor_sort_orders,
		)

		if is_deleted(latest_chart_log, operation_names) or chart["songId"] not in active_song_ids:
			continue

		effective_rating: dict[str, Any] | None = None
		effective_rating_sort_order = float("-inf")

		for rating in chart_ratings_by_chart.get(chart["chartId"], []):
			latest_rating_log = latest_log_for_target(
				chart_rating_versions_by_rating.get(rating["chartRatingId"]),
				target_version_id,
				ancestor_sort_orders,
			)

			if is_deleted(latest_rating_log, operation_names):
				continue

			rating_sort_order = ancestor_sort_orders.get(target_version_id, {}).get(
				latest_rating_log["versionId"], -10**9
			)

			if rating_sort_order >= effective_rating_sort_order:
				effective_rating = rating
				effective_rating_sort_order = rating_sort_order

		if effective_rating is None:
			continue

		difficulty = difficulty_by_id.get(effective_rating["difficultyId"])
		mode = mode_by_id.get(effective_rating["modeId"])

		if not difficulty or not mode:
			continue

		if difficulty["value"] is None or mode["internalTitle"] not in {"Single", "Double"}:
			continue

		source_song = song_by_id.get(chart["songId"])

		if not source_song:
			continue

		song_state = resolve_latest_song_state(
			target_version_id,
			chart["songId"],
			song_titles_by_song,
			song_title_versions_by_title,
			song_cards_by_song,
			song_card_versions_by_card,
			song_game_identifiers_by_song,
			song_game_identifier_versions_by_id,
			ancestor_sort_orders,
			operation_names,
		)

		labels_for_chart = sorted(
			label_by_id[chart_label["labelId"]]["internalTitle"]
			for chart_label in chart_labels_by_chart.get(chart["chartId"], [])
			if label_by_id.get(chart_label["labelId"])
			and not is_deleted(
				latest_log_for_target(
					chart_label_versions_by_label.get(chart_label["chartLabelId"]),
					target_version_id,
					ancestor_sort_orders,
				),
				operation_names,
			)
		)

		stepmaker = ", ".join(
			dedup(
				[
					f"{(chart_stepmaker.get('prefix') or '').strip()} "
					f"{stepmaker_by_id.get(chart_stepmaker['stepmakerId'], {}).get('internalTitle', 'Unknown')}"
					.strip()
					for chart_stepmaker in sorted(
						chart_stepmakers_by_chart.get(chart["chartId"], []),
						key=lambda row: row["sortOrder"],
					)
					if (
						f"{(chart_stepmaker.get('prefix') or '').strip()} "
						f"{stepmaker_by_id.get(chart_stepmaker['stepmakerId'], {}).get('internalTitle', 'Unknown')}"
					)
					.strip()
				]
			)
		)

		version_row = version_by_id.get(target_version_id, {})
		mix_row = mix_by_id.get(version_row.get("mixId"))
		cut = cut_by_id.get(source_song["cutId"], {}).get("internalTitle", "Arcade")

		rows.append(
			{
				"artist": make_artist_string(song_artists_by_song.get(chart["songId"]), artist_by_id),
				"cut": cut,
				"gameIdentifier": song_state["gameIdentifier"],
				"imageTargetVersion": "Prime 2 v2.05.1",
				"internalTitle": source_song["internalTitle"],
				"labels": labels_for_chart,
				"level": str(difficulty["value"]),
				"levelNum": difficulty["value"],
				"mixName": mix_row.get("internalTitle") if mix_row else None,
				"playtype": mode["internalTitle"],
				"prime2ChartID": chart["chartId"],
				"prime2SongID": source_song["songId"],
				"songCardPath": song_state["songCardPath"],
				"songTitle": song_state["englishTitle"] or source_song["internalTitle"],
				"sourceChartRatingID": effective_rating["chartRatingId"],
				"sourceDifficultyID": effective_rating["difficultyId"],
				"sourceModeID": effective_rating["modeId"],
				"stepmaker": stepmaker or None,
				"versionId": target_version_id,
				"versionName": version_row.get("internalTitle"),
			}
		)

	rows.sort(
		key=lambda row: (
			row["prime2SongID"],
			row["playtype"],
			row["levelNum"],
			row["prime2ChartID"],
		)
	)

	return {
		"source": {
			"fallbackNote": (
				"Pump Out currently exposes Prime 2 v2.05.0 as the latest historical snapshot. "
				"The disk image inspection targets Prime 2 v2.05.1, but package-level DB extraction "
				"from the encrypted .bin chain is still pending."
			),
			"imageTargetVersion": "Prime 2 v2.05.1",
			"kind": "pumpout-json",
			"pumpoutDir": str(pumpout_dir),
			"targetVersionId": target_version_id,
			"targetVersionName": version_by_id.get(target_version_id, {}).get("internalTitle"),
			"mixName": mix_by_id.get(version_by_id.get(target_version_id, {}).get("mixId"), {}).get(
				"internalTitle"
			),
		},
		"rows": rows,
	}


class Ext4Volume:
	def __init__(self, image_path: Path, partition_offset: int):
		self.image_path = image_path
		self.partition_offset = partition_offset
		self._fp = image_path.open("rb")
		superblock = self._read(EXT4_SUPERBLOCK_OFFSET, EXT4_SUPERBLOCK_SIZE)
		magic = struct.unpack_from("<H", superblock, 0x38)[0]

		if magic != 0xEF53:
			raise ValueError(f"Partition at 0x{partition_offset:X} is not ext4.")

		self.block_size = 1024 << struct.unpack_from("<I", superblock, 0x18)[0]
		self.blocks_per_group = struct.unpack_from("<I", superblock, 0x20)[0]
		self.inodes_per_group = struct.unpack_from("<I", superblock, 0x28)[0]
		self.inode_size = struct.unpack_from("<H", superblock, 0x58)[0]
		self.desc_size = struct.unpack_from("<H", superblock, 0xFE)[0] or 32
		self.volume_name = (
			superblock[0x78:0x88].split(b"\x00", 1)[0].decode("utf-8", errors="ignore")
		)

		desc_table_block = 2 if self.block_size == 1024 else 1
		self.desc_table_offset = self._block_offset(desc_table_block)

	def close(self) -> None:
		self._fp.close()

	def _read(self, offset: int, size: int) -> bytes:
		self._fp.seek(self.partition_offset + offset)
		return self._fp.read(size)

	def _block_offset(self, block_number: int) -> int:
		return block_number * self.block_size

	def _read_block(self, block_number: int) -> bytes:
		return self._read(self._block_offset(block_number), self.block_size)

	def _read_group_desc(self, group_index: int) -> bytes:
		return self._read(self.desc_table_offset + group_index * self.desc_size, self.desc_size)

	def _read_inode(self, inode_number: int) -> dict[str, Any]:
		group_index = (inode_number - 1) // self.inodes_per_group
		inode_index = (inode_number - 1) % self.inodes_per_group
		group_desc = self._read_group_desc(group_index)
		inode_table_low = struct.unpack_from("<I", group_desc, 0x08)[0]
		inode_table_high = struct.unpack_from("<I", group_desc, 0x28)[0] if self.desc_size >= 0x2C else 0
		inode_table_block = inode_table_low | (inode_table_high << 32)
		inode_offset = self._block_offset(inode_table_block) + inode_index * self.inode_size
		inode_bytes = self._read(inode_offset, self.inode_size)
		size_lo = struct.unpack_from("<I", inode_bytes, 0x04)[0]
		size_high = struct.unpack_from("<I", inode_bytes, 0x6C)[0] if self.inode_size >= 0x70 else 0

		return {
			"bytes": inode_bytes,
			"flags": struct.unpack_from("<I", inode_bytes, 0x20)[0],
			"mode": struct.unpack_from("<H", inode_bytes, 0x00)[0],
			"mtime": struct.unpack_from("<I", inode_bytes, 0x10)[0],
			"size": size_lo | (size_high << 32),
		}

	def _collect_extents(self, header_bytes: bytes) -> list[tuple[int, int, int]]:
		magic, entries, _, depth, _ = struct.unpack_from("<HHHHI", header_bytes, 0)

		if magic != EXT4_EXTENT_HEADER_MAGIC:
			raise ValueError("Unsupported non-extent inode encountered.")

		extents: list[tuple[int, int, int]] = []

		if depth == 0:
			for index in range(entries):
				offset = 12 + index * 12
				ee_block, ee_len, ee_start_hi, ee_start_lo = struct.unpack_from("<IHHI", header_bytes, offset)
				extent_length = ee_len & 0x7FFF
				extent_start = ee_start_lo | (ee_start_hi << 32)
				extents.append((ee_block, extent_length, extent_start))

			return extents

		for index in range(entries):
			offset = 12 + index * 12
			_, leaf_lo, leaf_hi, _ = struct.unpack_from("<IIHH", header_bytes, offset)
			leaf_block = leaf_lo | (leaf_hi << 32)
			extents.extend(self._collect_extents(self._read_block(leaf_block)))

		return extents

	def _read_inode_data(self, inode_number: int) -> bytes:
		inode = self._read_inode(inode_number)

		if not (inode["flags"] & EXT4_EXTENTS_FL):
			raise ValueError(f"Inode {inode_number} does not use extents.")

		extents = sorted(self._collect_extents(inode["bytes"][0x28 : 0x28 + 60]), key=lambda row: row[0])
		parts: list[bytes] = []
		current_logical_block = 0

		for logical_block, extent_length, extent_start in extents:
			if logical_block > current_logical_block:
				parts.append(b"\x00" * ((logical_block - current_logical_block) * self.block_size))
				current_logical_block = logical_block

			parts.append(self._read(self._block_offset(extent_start), extent_length * self.block_size))
			current_logical_block += extent_length

		return b"".join(parts)[: inode["size"]]

	def list_dir(self, path: str) -> list[dict[str, Any]]:
		inode_number = self.resolve_path(path)
		data = self._read_inode_data(inode_number)
		entries: list[dict[str, Any]] = []
		offset = 0

		while offset + 8 <= len(data):
			child_inode, rec_len, name_len, file_type = struct.unpack_from("<IHBb", data, offset)

			if rec_len <= 0:
				break

			if child_inode != 0:
				name = data[offset + 8 : offset + 8 + name_len].decode("utf-8", errors="ignore")

				if name not in {".", ".."}:
					child = self._read_inode(child_inode)
					entries.append(
						{
							"fileType": file_type,
							"inode": child_inode,
							"mtime": child["mtime"],
							"name": name,
							"size": child["size"],
						}
					)

			offset += rec_len

		return entries

	def exists(self, path: str) -> bool:
		try:
			self.resolve_path(path)
		except FileNotFoundError:
			return False

		return True

	def resolve_path(self, path: str) -> int:
		if path == "/":
			return 2

		components = [component for component in path.split("/") if component]
		inode_number = 2

		for component in components:
			found_inode: int | None = None

			for entry in self.list_dir_from_inode(inode_number):
				if entry["name"] == component:
					found_inode = entry["inode"]
					break

			if found_inode is None:
				raise FileNotFoundError(path)

			inode_number = found_inode

		return inode_number

	def list_dir_from_inode(self, inode_number: int) -> list[dict[str, Any]]:
		data = self._read_inode_data(inode_number)
		entries: list[dict[str, Any]] = []
		offset = 0

		while offset + 8 <= len(data):
			child_inode, rec_len, name_len, file_type = struct.unpack_from("<IHBb", data, offset)

			if rec_len <= 0:
				break

			if child_inode != 0:
				name = data[offset + 8 : offset + 8 + name_len].decode("utf-8", errors="ignore")
				entries.append({"fileType": file_type, "inode": child_inode, "name": name})

			offset += rec_len

		return entries

	def read_file(self, path: str) -> bytes:
		return self._read_inode_data(self.resolve_path(path))


def parse_mbr(image_path: Path) -> list[dict[str, Any]]:
	with image_path.open("rb") as fp:
		mbr = fp.read(SECTOR_SIZE)

	if mbr[510:512] != b"\x55\xAA":
		raise ValueError("Image does not contain a valid MBR signature.")

	partitions: list[dict[str, Any]] = []

	for index in range(4):
		entry = mbr[446 + index * 16 : 446 + (index + 1) * 16]
		partition_type = entry[4]
		lba_start = struct.unpack_from("<I", entry, 8)[0]
		sector_count = struct.unpack_from("<I", entry, 12)[0]

		if partition_type == 0 or sector_count == 0:
			continue

		partitions.append(
			{
				"byteOffset": lba_start * SECTOR_SIZE,
				"index": index + 1,
				"partitionTypeHex": f"0x{partition_type:02X}",
				"sectorCount": sector_count,
				"sizeBytes": sector_count * SECTOR_SIZE,
				"startLBA": lba_start,
			}
		)

	return partitions


def inspect_image(image_path: Path) -> dict[str, Any]:
	partitions = parse_mbr(image_path)
	volumes: list[Ext4Volume] = []

	try:
		for partition in partitions:
			volumes.append(Ext4Volume(image_path, partition["byteOffset"]))

		if len(volumes) < 3:
			raise ValueError("Expected at least three ext4 partitions in the Prime 2 image.")

		root_volume, settings_volume, hd_volume = volumes[:3]
		xinitrc = root_volume.read_file("/root/.xinitrc").decode("utf-8", errors="ignore")
		exec_bytes = root_volume.read_file("/root/game/exec")
		packages = [
			{
				**entry,
				"mtimeISO": None,
			}
			for entry in hd_volume.list_dir("/game")
			if re.match(r"^(?:cs|f2)_\d+\.bin$", entry["name"])
		]

		for entry in packages:
			entry["mtimeISO"] = (
				None
				if entry["mtime"] <= 0
				else datetime.fromtimestamp(entry["mtime"], UTC).isoformat().replace("+00:00", "Z")
			)

		packages.sort(key=lambda row: int(re.search(r"_(\d+)\.bin$", row["name"]).group(1)))

		return {
			"imagePath": str(image_path),
			"partitions": [
				{
					**partition,
					"volumeName": volume.volume_name,
				}
				for partition, volume in zip(partitions, volumes, strict=False)
			],
			"runtimeLayout": {
				"execContainsHFZipMarker": b"4hfzip" in exec_bytes,
				"execContainsP500DbMarker": b"/P500mb.db" in exec_bytes,
				"execContainsMountedGamePath": b"/mnt/hd/game/" in exec_bytes,
				"hasRootGameExec": root_volume.exists("/root/game/exec"),
				"hasRootXinitrc": root_volume.exists("/root/.xinitrc"),
				"hasSettingsPrime2Dat": root_volume.exists("/SETTINGS/PRIME2.DAT")
				or settings_volume.exists("/PRIME2.DAT"),
				"hasSettingsPrime2RtDat": root_volume.exists("/SETTINGS/PRIME2_RT.DAT")
				or settings_volume.exists("/PRIME2_RT.DAT"),
				"hasMountedGameDir": hd_volume.exists("/game"),
				"packageCount": len(packages),
				"packageOrder": [entry["name"] for entry in packages],
				"xinitrc": xinitrc,
			},
			"packages": packages,
		}
	finally:
		for volume in volumes:
			volume.close()


def main() -> None:
	parser = argparse.ArgumentParser(
		description=(
			"Inspect the Prime 2 disk image layout and emit a Prime 2 raw dump from the "
			"historical Pump Out export used by the PIU rerunner."
		)
	)
	parser.add_argument("--image", type=Path, required=True, help="Path to the Prime 2 raw disk image.")
	parser.add_argument(
		"--pumpout-dir",
		type=Path,
		default=DEFAULT_PUMPOUT_DIR,
		help="Path to the Pump Out JSON export directory.",
	)
	parser.add_argument(
		"--out-dir",
		type=Path,
		default=DEFAULT_OUTPUT_DIR,
		help="Directory to write output artifacts into.",
	)
	parser.add_argument(
		"--target-version-id",
		type=int,
		default=TARGET_VERSION_ID,
		help="Prime 2 version ID to extract from the historical Pump Out export.",
	)
	args = parser.parse_args()

	args.out_dir.mkdir(parents=True, exist_ok=True)
	image_layout = inspect_image(args.image)
	(args.out_dir / "prime2-image-layout.json").write_text(
		json.dumps(image_layout, indent=2) + "\n",
		encoding="utf-8",
	)

	if not args.pumpout_dir.exists():
		raise FileNotFoundError(
			f"Could not find Pump Out export directory at {args.pumpout_dir}. "
			"Pass --pumpout-dir or set PIU_DUMP_DIR."
		)

	raw_dump = build_prime2_raw_dump(args.pumpout_dir, args.target_version_id)
	raw_dump["imageInspection"] = {
		"execContainsHFZipMarker": image_layout["runtimeLayout"]["execContainsHFZipMarker"],
		"execContainsP500DbMarker": image_layout["runtimeLayout"]["execContainsP500DbMarker"],
		"packageCount": image_layout["runtimeLayout"]["packageCount"],
	}
	(args.out_dir / "prime2-chart-raw.json").write_text(
		json.dumps(raw_dump, indent=2) + "\n",
		encoding="utf-8",
	)


if __name__ == "__main__":
	main()
