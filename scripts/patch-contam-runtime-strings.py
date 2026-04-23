from __future__ import annotations

import argparse
from pathlib import Path


PATCHES = [
    {
        "offset": 1148364,
        "source": b"Level Data",
        "replacement": "楼层",
        "previous": ["楼层表"],
    },
    {
        "offset": 1148408,
        "source": b"Zone Data",
        "replacement": "区域",
    },
    {
        "offset": 1172248,
        "source": b"YES",
        "replacement": "是",
    },
    {
        "offset": 1172252,
        "source": b"NO",
        "replacement": "否",
        "span": 3,
    },
    {
        "offset": 1174164,
        "source": b"Duct Airflow Element Properties",
        "replacement": "风管流动元件属性",
    },
    {
        "offset": 1182320,
        "source": b"Duct Junction Properties",
        "replacement": "风管节点属性",
    },
    {
        "offset": 1182348,
        "source": b"Junction",
        "replacement": "节点",
    },
    {
        "offset": 1182360,
        "source": b"Terminal Data",
        "replacement": "终端数据",
    },
    {
        "offset": 1182376,
        "source": b"Wind Pressure",
        "replacement": "风压",
    },
    {
        "offset": 1178296,
        "source": b"Filter Element: Constant Efficiency",
        "replacement": "恒效滤",
        "previous": ["过滤元件：恒效过滤", "恒效过滤", "恒效"],
    },
    {
        "offset": 1178332,
        "source": b"Filter Element: Simple Particle",
        "replacement": "颗粒滤",
        "previous": ["过滤元件：简易颗粒", "简易颗粒", "颗粒"],
    },
    {
        "offset": 1178364,
        "source": b"Filter Element: Simple Gaseous",
        "replacement": "气体滤",
        "previous": ["过滤元件：简易气体", "简易气体", "气体"],
    },
    {
        "offset": 1178396,
        "source": b"Filter Element: Penn State UVGI",
        "replacement": "过滤元件：Penn State UVGI",
    },
    {
        "offset": 1180260,
        "source": b"Transient Contaminant Results",
        "replacement": "瞬态污染物结果",
    },
    {
        "offset": 1180948,
        "source": b"From",
        "replacement": "从",
        "span": 8,
    },
    {
        "offset": 1180956,
        "source": b"To",
        "replacement": "到",
        "span": 4,
    },
    {
        "offset": 1180960,
        "source": b"Positive Flow Direction",
        "replacement": "正流向",
    },
    {
        "offset": 1189136,
        "source": b"Week Schedules",
        "replacement": "周计划 ",
    },
    {
        "offset": 1189152,
        "source": b"Wind Pressure Profiles",
        "replacement": "风压剖面 ",
    },
    {
        "offset": 1189176,
        "source": b"Airflow Elements",
        "replacement": "气流件",
    },
    {
        "offset": 1189196,
        "source": b"Duct Elements",
        "replacement": "风管件",
    },
    {
        "offset": 1189212,
        "source": b"Source/Sink Elements",
        "replacement": "源/汇元件 ",
    },
    {
        "offset": 1189236,
        "source": b"Kinetic Reactions",
        "replacement": "动力学反应 ",
    },
    {
        "offset": 1189256,
        "source": b"Day Schedules",
        "replacement": "日计划 ",
    },
    {
        "offset": 1189272,
        "source": b"Occupancy Schedules",
        "replacement": "占用表 ",
        "previous": ["占用计划 "],
    },
    {
        "offset": 1189292,
        "source": b"Control Super Elements",
        "replacement": "超元件 ",
        "previous": ["超级元件控制 ", "超元控制 "],
    },
    {
        "offset": 1189324,
        "source": b"CONTAMW Data and Library Manager: ",
        "replacement": "CONTAMW 数据与库管理器：",
    },
    {
        "offset": 1189564,
        "source": b"No local species.",
        "replacement": "无本地物种",
        "pad": b" ",
    },
    {
        "offset": 1189584,
        "source": b"No library species.",
        "replacement": "无库物种",
        "pad": b" ",
    },
    {
        "offset": 1203184,
        "source": b"Save",
        "replacement": "保存",
        "span": 8,
    },
    {
        "offset": 1203212,
        "source": b"Program Configuration Properties",
        "replacement": "程序配置属性",
    },
    {
        "offset": 1203436,
        "source": b"Project Configuration Properties",
        "replacement": "项目配置属性",
    },
    {
        "offset": 1203640,
        "source": b".SIM read error\nDelete %s.SIM file to avoid this error.",
        "replacement": "SIM 读取错误\n删除 %s.SIM 可避免此错误",
    },
    {
        "offset": 1203933,
        "source": b"Reading simulation details file",
        "replacement": "正在读取仿真详情文件",
    },
    {
        "offset": 1204296,
        "source": b"Simulation Parameters",
        "replacement": "仿真参数",
    },
    {
        "offset": 1204320,
        "source": b"Weather",
        "replacement": "天气",
        "span": 8,
    },
    {
        "offset": 1204328,
        "source": b"Output",
        "replacement": "输出",
    },
    {
        "offset": 1204336,
        "source": b"Airflow Numerics",
        "replacement": "气流数值",
    },
    {
        "offset": 1204356,
        "source": b"Contaminant Numerics",
        "replacement": "污染物数值",
    },
    {
        "offset": 1204380,
        "source": b"CFD Numerics",
        "replacement": "CFD 数值",
    },
    {
        "offset": 1204413,
        "source": b"N/A",
        "replacement": "--",
        "span": 4,
    },
    {
        "offset": 1207312,
        "source": b"No contaminants",
        "replacement": "无污染物",
        "span": 16,
    },
    {
        "offset": 1207552,
        "source": b"Non-trace",
        "replacement": "非示踪",
        "span": 12,
    },
    {
        "offset": 1207564,
        "source": b"Trace",
        "replacement": "示踪",
        "span": 8,
    },
    {
        "offset": 1207572,
        "source": b"Use",
        "replacement": "是",
        "span": 4,
    },
    {
        "offset": 1207576,
        "source": b"Don't use",
        "replacement": "否",
        "span": 12,
    },
    {
        "offset": 1192168,
        "source": b"More than one non-trace contaminants required.",
        "replacement": "至少需要两个非示踪污染物。",
    },
    {
        "offset": 1160064,
        "source": b"Concentrations of non-trace contaminants should sum to 1",
        "replacement": "非示踪污染物浓度总和应为 1。",
    },
    {
        "offset": 1179396,
        "source": b".SIM read error",
        "replacement": "SIM错误",
    },
    {
        "offset": 1214360,
        "source": b"Project name must be defined.",
        "replacement": "必须先定义项目名称",
    },
    {
        "offset": 1212308,
        "source": b"Contaminant Results",
        "replacement": "污染物结果",
    },
    {
        "offset": 1212328,
        "source": b"Zone Airflow Results [",
        "replacement": "区域气流结果[",
    },
    {
        "offset": 1212600,
        "source": b"Contaminant results not available.\r\nSet simulation output parameters to\r\nprovide detailed contaminant data.",
        "replacement": "污染物结果不可用。\r\n请在输出参数中\r\n启用详细污染物数据。",
    },
    {
        "offset": 1220332,
        "source": b"Weather and Wind Parameters",
        "replacement": "天气与风参数",
    },
    {
        "offset": 1221724,
        "source": b"Zone Properties",
        "replacement": "区域属性",
    },
    {
        "offset": 1221740,
        "source": b"Contaminant Data",
        "replacement": "污染物数据",
    },
    {
        "offset": 1221760,
        "source": b"Detailed Zone",
        "replacement": "详细区域",
    },
    {
        "offset": 1160320,
        "source": b"Filters",
        "replacement": "滤",
        "span": 8,
        "previous": ["过滤", "过"],
    },
    {
        "offset": 1168684,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 12,
    },
    {
        "offset": 1162633,
        "source": b"Zone: Ambt",
        "replacement": "区:室外",
        "span": 11,
    },
    {
        "offset": 1162645,
        "source": b"Zone(%d): %s / %s",
        "replacement": "区(%d): %s / %s",
        "span": 19,
    },
    {
        "offset": 1162792,
        "source": b"; direction = %g deg",
        "replacement": "; 方向=%g度",
        "span": 24,
    },
    {
        "offset": 1162404,
        "source": b"; Density: %g %s",
        "replacement": "; 密度: %g %s",
        "span": 18,
    },
    {
        "offset": 1162166,
        "source": b"Density: ",
        "replacement": "密度: ",
        "span": 10,
    },
    {
        "offset": 1162834,
        "source": b"Density: %g %s",
        "replacement": "密度: %g %s",
        "span": 18,
    },
    {
        "offset": 1162868,
        "source": b"; ws: %.1f %s",
        "replacement": "; 风: %.1f %s",
        "span": 16,
    },
    {
        "offset": 1162884,
        "source": b" @ %.0f deg",
        "replacement": " @ %.0f度",
        "span": 12,
    },
    {
        "offset": 1156972,
        "source": b"Zone",
        "replacement": "区域",
        "span": 8,
    },
    {
        "offset": 1180364,
        "source": b"Ambient",
        "replacement": "环境",
        "span": 8,
    },
    {
        "offset": 1254640,
        "source": b"Zone",
        "replacement": "区域",
        "span": 16,
    },
    {
        "offset": 1254832,
        "source": b"Zone",
        "replacement": "区域",
        "span": 16,
    },
    {
        "offset": 1260144,
        "source": b"Species",
        "replacement": "物种",
        "span": 32,
    },
    {
        "offset": 1258416,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 32,
    },
    {
        "offset": 1261040,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 32,
    },
    {
        "offset": 1261648,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 32,
    },
    {
        "offset": 1266096,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 32,
    },
    {
        "offset": 1268688,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 32,
    },
    {
        "offset": 1269328,
        "source": b"Temperature",
        "replacement": "温度",
        "span": 32,
    },
    {
        "offset": 1222772,
        "source": b"\xb0C",
        "replacement": "C",
        "span": 4,
    },
    {
        "offset": 1222776,
        "source": b"\xb0F",
        "replacement": "F",
        "span": 4,
    },
    {
        "offset": 1224088,
        "source": b"Dimensionless",
        "replacement": "无量纲",
    },
    {
        "offset": 1153664,
        "source": b"ERROR",
        "replacement": "错误",
        "span": 8,
    },
    {
        "offset": 1153656,
        "source": b"WARNING",
        "replacement": "警告",
        "span": 8,
    },
    {
        "offset": 1156724,
        "source": b"Run Control",
        "replacement": "运行",
    },
]


BYTE_MAP_RANGES = [
    {
        "start": 1222700,
        "end": 1224088,
        "mapping": {
            0xB2: ord("2"),
            0xB3: ord("3"),
        },
    },
]


SCHEDULE_CAPTION_OFFSETS = [
    1255120,
    1255664,
    1256304,
    1256944,
    1258160,
    1258864,
    1260112,
    1260784,
    1261456,
    1262768,
    1263344,
    1263984,
    1264624,
    1265840,
    1266544,
    1267792,
    1268464,
    1269104,
]


FILTER_CAPTION_OFFSETS = [
    1255632,
    1256272,
    1256912,
    1258832,
    1260752,
    1263312,
    1263952,
    1264592,
    1266512,
    1268432,
]


for offset in SCHEDULE_CAPTION_OFFSETS:
    PATCHES.append(
        {
            "offset": offset,
            "source": b"Schedule",
            "replacement": "计划表",
            "span": 32,
        }
    )


for offset in FILTER_CAPTION_OFFSETS:
    PATCHES.append(
        {
            "offset": offset,
            "source": b"Filter",
            "replacement": "过滤器",
            "span": 32,
        }
    )


def encoded(text: str) -> bytes:
    return text.encode("utf-8")


def apply_patch(blob: bytearray, patch: dict) -> None:
    offset = patch["offset"]
    source = patch["source"]
    replacement = encoded(patch["replacement"])
    pad = patch.get("pad", b"\x00")
    span = patch.get("span", len(source))
    current = bytes(blob[offset : offset + span])
    expected = replacement + (pad * (span - len(replacement)))

    if len(replacement) > span:
        raise ValueError(
            f"Replacement too long at {offset}: {patch['replacement']!r} > {span} bytes"
        )

    if current == expected:
        return

    for prior_text in patch.get("previous", []):
        prior = encoded(prior_text)
        prior_expected = prior + (pad * (span - len(prior)))
        if current == prior_expected:
            blob[offset : offset + span] = expected
            return

    if current[: len(source)] != source:
        raise ValueError(
            f"Source mismatch at {offset}: expected {source!r}, got {current!r}"
        )

    blob[offset : offset + span] = expected


def apply_byte_map_range(blob: bytearray, patch: dict) -> None:
    start = patch["start"]
    end = patch["end"]
    mapping = patch["mapping"]

    for index in range(start, end):
        blob[index] = mapping.get(blob[index], blob[index])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target")
    parser.add_argument("--output")
    args = parser.parse_args()

    target = Path(args.target)
    output = Path(args.output) if args.output else target
    blob = bytearray(target.read_bytes())

    for patch in BYTE_MAP_RANGES:
        apply_byte_map_range(blob, patch)

    for patch in PATCHES:
        apply_patch(blob, patch)

    output.write_bytes(blob)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
