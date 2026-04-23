from __future__ import annotations

import argparse
from pathlib import Path


PATCHES = [
    {
        "offset": 1174032,
        "source": "Close",
        "replacement": "关闭",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174076,
        "source": "Start Simulation",
        "replacement": "开始仿真",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174140,
        "source": "Stop Simulation",
        "replacement": "停止仿真",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174204,
        "source": "Assume convergence at end of next day",
        "replacement": "次日结束时视为收敛",
        "encoding": "utf-16le",
        "span": 80,
    },
    {
        "offset": 1174440,
        "source": "Date",
        "replacement": "日期",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174480,
        "source": "Time",
        "replacement": "时间",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174520,
        "source": "Day",
        "replacement": "天数",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174560,
        "source": "Time Step",
        "replacement": "时间步",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1174680,
        "source": "Simulation Settings",
        "replacement": "仿真设置",
        "encoding": "utf-16le",
        "span": 40,
    },
    {
        "offset": 1174752,
        "source": "Simulation Status:",
        "replacement": "仿真状态:",
        "encoding": "utf-16le",
        "span": 40,
    },
    {
        "offset": 1174820,
        "source": 'Press "Start Simulation" to begin or "OK" to cancel',
        "replacement": '点击“开始仿真”开始，或点“关闭”取消',
        "encoding": "utf-16le",
        "span": 112,
    },
    {
        "offset": 1174956,
        "source": "Airflow Simulation:",
        "replacement": "气流仿真:",
        "encoding": "utf-16le",
        "span": 40,
    },
    {
        "offset": 1175028,
        "source": "Contaminant Simulation:",
        "replacement": "污染物仿真:",
        "encoding": "utf-16le",
        "span": 48,
    },
    {
        "offset": 1175108,
        "source": "Simulation Date:",
        "replacement": "仿真日期:",
        "encoding": "utf-16le",
        "span": 40,
    },
    {
        "offset": 1175172,
        "source": "Weather File:",
        "replacement": "天气文件:",
        "encoding": "utf-16le",
        "span": 40,
    },
    {
        "offset": 1175328,
        "source": "CONTAMX Simulation Control",
        "replacement": "CONTAMX 仿真控制",
        "encoding": "utf-16le",
        "span": 64,
    },
    {
        "offset": 1175444,
        "source": "Contaminant File:",
        "replacement": "污染物文件:",
        "encoding": "utf-16le",
        "span": 40,
    },
    {
        "offset": 1175672,
        "source": "WPC File:",
        "replacement": "WPC 文件:",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1175724,
        "source": "DVF File:",
        "replacement": "DVF 文件:",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1175776,
        "source": "CVF File:",
        "replacement": "CVF 文件:",
        "encoding": "utf-16le",
        "span": 32,
    },
    {
        "offset": 1115408,
        "source": b"Done.",
        "replacement": "完成",
        "span": 8,
    },
    {
        "offset": 1115432,
        "source": b"Transient",
        "replacement": "瞬态",
    },
    {
        "offset": 1115628,
        "source": b"None",
        "replacement": "无",
        "span": 8,
    },
]


def encode_text(text: str, encoding: str) -> bytes:
    return text.encode(encoding)


def apply_patch(blob: bytearray, patch: dict) -> None:
    source = patch["source"]
    encoding = patch.get("encoding")
    if isinstance(source, str):
        if not encoding:
            raise ValueError(f"Missing encoding for string source at {patch['offset']}")
        source_bytes = encode_text(source, encoding)
        replacement_bytes = encode_text(patch["replacement"], encoding)
    else:
        source_bytes = source
        replacement_bytes = patch["replacement"].encode("utf-8")

    offset = patch["offset"]
    span = patch.get("span", len(source_bytes))
    current = bytes(blob[offset : offset + span])
    expected = replacement_bytes + (b"\x00" * (span - len(replacement_bytes)))

    if len(replacement_bytes) > span:
        raise ValueError(
            f"Replacement too long at {offset}: {patch['replacement']!r} > {span} bytes"
        )

    if current == expected:
        return

    if current[: len(source_bytes)] != source_bytes:
        raise ValueError(
            f"Source mismatch at {offset}: expected {source_bytes!r}, got {current!r}"
        )

    blob[offset : offset + span] = expected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target")
    parser.add_argument("--output")
    args = parser.parse_args()

    target = Path(args.target)
    output = Path(args.output) if args.output else target
    blob = bytearray(target.read_bytes())

    for patch in PATCHES:
        apply_patch(blob, patch)

    output.write_bytes(blob)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
