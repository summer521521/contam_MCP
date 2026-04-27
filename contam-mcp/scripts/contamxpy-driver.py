import argparse
import importlib.metadata
import json
import sys
import traceback
from pathlib import Path


def load_contamxpy():
    import contamxpy  # type: ignore

    return contamxpy


def jsonable(value):
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if hasattr(value, "__dict__"):
        return {str(key): jsonable(item) for key, item in value.__dict__.items()}
    return str(value)


def object_dict(obj):
    return jsonable(dict(getattr(obj, "__dict__", {})))


def limited(items, max_items):
    return list(items)[: max(0, max_items)]


def discover(_request):
    contamxpy = load_contamxpy()
    try:
        version = importlib.metadata.version("contamxpy")
    except importlib.metadata.PackageNotFoundError:
        version = getattr(contamxpy, "__version__", None)

    return {
        "available": True,
        "version": version,
        "modulePath": str(Path(contamxpy.__file__).resolve()),
        "pythonExecutable": sys.executable,
        "capabilities": [
            "project metadata through contamxpy.cxLib",
            "co-simulation setup and time-step advancement",
            "zone mass fraction reads",
            "path, terminal, and leak flow reads",
            "ambient/weather boundary writes",
            "zone, junction, AHS, envelope, and control-node writes",
        ],
    }


def make_cx(request):
    contamxpy = load_contamxpy()
    project_path = str(Path(request["projectPath"]).resolve())
    wp_mode = int(request.get("wpMode", 0))
    verbosity = int(request.get("verbosity", 0))
    cx = contamxpy.cxLib(project_path, wp_mode=wp_mode, cb_option=True)
    cx.setVerbosity(verbosity)
    return cx, project_path


def setup_simulation(cx, request):
    use_cosim = 1 if request.get("useCosim", True) else 0
    ret = cx.setupSimulation(use_cosim)
    return {
        "returnCode": ret,
        "useCosim": bool(use_cosim),
        "version": cx.getVersion(),
        "timeStepSeconds": cx.getSimTimeStep(),
        "startDateDayOfYear": cx.getSimStartDate(),
        "endDateDayOfYear": cx.getSimEndDate(),
        "startTimeSeconds": cx.getSimStartTime(),
        "endTimeSeconds": cx.getSimEndTime(),
    }


def inspect_project(request):
    max_entities = int(request.get("maxEntities", 50))
    cx, project_path = make_cx(request)
    try:
        setup = setup_simulation(cx, request)
        return {
            "projectPath": project_path,
            "setup": setup,
            "counts": {
                "contaminants": cx.nContaminants,
                "zones": cx.nZones,
                "paths": cx.nPaths,
                "environmentPaths": cx.nEnvPaths,
                "ahs": cx.nAhs,
                "ductJunctions": cx.nDuctJunctions,
                "ductTerminals": cx.nDuctTerminals,
                "ductLeaks": cx.nDuctLeaks,
                "inputControls": cx.nInputControls,
                "outputControls": cx.nOutputControls,
            },
            "contaminants": limited(cx.contaminants, max_entities),
            "zones": limited((object_dict(item) for item in cx.zones), max_entities),
            "paths": limited((object_dict(item) for item in cx.paths), max_entities),
            "environmentPaths": limited((object_dict(item) for item in cx.envPaths), max_entities),
            "ahs": limited((object_dict(item) for item in cx.AHSs), max_entities),
            "ductJunctions": limited((object_dict(item) for item in cx.ductJunctions), max_entities),
            "ductTerminals": limited((object_dict(item) for item in cx.ductTerminals), max_entities),
            "ductLeaks": limited((object_dict(item) for item in cx.ductLeaks), max_entities),
            "inputControls": limited((object_dict(item) for item in cx.inputControls), max_entities),
            "outputControls": limited((object_dict(item) for item in cx.outputControls), max_entities),
        }
    finally:
        cx.endSimulation()


def apply_adjustments(cx, adjustments):
    applied = []
    for item in adjustments:
        kind = item.get("kind")
        if kind == "ambient":
            if "temperatureK" in item:
                cx.setAmbtTemperature(float(item["temperatureK"]))
            if "pressurePa" in item:
                cx.setAmbtPressure(float(item["pressurePa"]))
            if "windSpeed" in item:
                cx.setAmbtWindSpeed(float(item["windSpeed"]))
            if "windDirection" in item:
                cx.setAmbtWindDirection(float(item["windDirection"]))
            for mass_fraction in item.get("massFractions", []):
                cx.setAmbtMassFraction(
                    int(mass_fraction["contaminantNumber"]),
                    float(mass_fraction["value"]),
                )
        elif kind == "zoneTemperature":
            cx.setZoneTemperature(int(item["zoneNumber"]), float(item["temperatureK"]))
        elif kind == "junctionTemperature":
            cx.setJunctionTemperature(int(item["junctionNumber"]), float(item["temperatureK"]))
        elif kind == "zoneAddMass":
            cx.setZoneAddMass(
                int(item["zoneNumber"]),
                int(item["contaminantNumber"]),
                float(item["mass"]),
            )
        elif kind == "ahsPercentOutdoorAir":
            cx.setAhsPercentOa(int(item["ahsNumber"]), float(item["fraction"]))
        elif kind == "ahsSupplyReturnFlow":
            cx.setAhsSupplyReturnFlow(int(item["pathNumber"]), float(item["flow"]))
        elif kind == "inputControlValue":
            cx.setInputControlValue(int(item["controlIndex"]), float(item["value"]))
        elif kind == "envelopeWindPressure":
            cx.setEnvelopeWP(int(item["environmentIndex"]), float(item["windPressurePa"]))
        elif kind == "envelopeMassFraction":
            cx.setEnvelopeMF(
                int(item["environmentIndex"]),
                int(item["contaminantNumber"]),
                float(item["value"]),
            )
        else:
            raise ValueError(f"Unsupported contamxpy adjustment kind: {kind}")
        applied.append(item)
    return applied


def sample_state(cx, step_index, request):
    sample = {
        "stepIndex": step_index,
        "dayOfYear": cx.getCurrentDayOfYear(),
        "timeSeconds": cx.getCurrentTimeInSec(),
    }

    zone_requests = request.get("zoneMassFractionRequests", [])
    if zone_requests:
        sample["zoneMassFractions"] = [
            {
                "zoneNumber": int(item["zoneNumber"]),
                "contaminantNumber": int(item["contaminantNumber"]),
                "value": cx.getZoneMassFraction(
                    int(item["zoneNumber"]),
                    int(item["contaminantNumber"]),
                ),
            }
            for item in zone_requests
        ]

    path_numbers = request.get("pathFlowRequests", [])
    if path_numbers:
        sample["pathFlows"] = [
            {
                "pathNumber": int(path_number),
                "values": cx.getPathFlow(int(path_number)),
            }
            for path_number in path_numbers
        ]

    terminal_numbers = request.get("ductTerminalFlowRequests", [])
    if terminal_numbers:
        sample["ductTerminalFlows"] = [
            {
                "terminalNumber": int(terminal_number),
                "value": cx.getDuctTerminalFlow(int(terminal_number)),
            }
            for terminal_number in terminal_numbers
        ]

    leak_numbers = request.get("ductLeakFlowRequests", [])
    if leak_numbers:
        sample["ductLeakFlows"] = [
            {
                "leakNumber": int(leak_number),
                "value": cx.getDuctLeakFlow(int(leak_number)),
            }
            for leak_number in leak_numbers
        ]

    output_controls = request.get("outputControlValueRequests", [])
    if output_controls:
        sample["outputControlValues"] = [
            {
                "controlIndex": int(control_index),
                "value": cx.getOutputControlValue(int(control_index)),
            }
            for control_index in output_controls
        ]

    envelope_exfil = request.get("envelopeExfilRequests", [])
    if envelope_exfil:
        sample["envelopeExfiltration"] = [
            {
                "environmentIndex": int(item["environmentIndex"]),
                "contaminantNumber": int(item["contaminantNumber"]),
                "value": cx.getEnvelopeExfil(
                    int(item["environmentIndex"]),
                    int(item["contaminantNumber"]),
                ),
            }
            for item in envelope_exfil
        ]

    return sample


def run_cosimulation(request):
    cx, project_path = make_cx(request)
    max_steps = int(request.get("maxSteps", 10))
    sample_every_steps = max(1, int(request.get("sampleEverySteps", 1)))
    sample_initial = bool(request.get("sampleInitial", True))
    adjustments_by_step = {}
    for item in request.get("adjustments", []):
        at_step = int(item.get("atStep", 0))
        adjustments_by_step.setdefault(at_step, []).append(item)

    samples = []
    applied = []
    try:
        setup = setup_simulation(cx, request)
        if sample_initial:
            samples.append(sample_state(cx, 0, request))

        for step in range(max_steps):
            step_adjustments = adjustments_by_step.get(step, [])
            if step_adjustments:
                applied.extend(
                    {"atStep": step, **item}
                    for item in apply_adjustments(cx, step_adjustments)
                )

            cx.doSimStep(1)
            next_step = step + 1
            if next_step % sample_every_steps == 0:
                samples.append(sample_state(cx, next_step, request))

        return {
            "projectPath": project_path,
            "setup": setup,
            "stepsRequested": max_steps,
            "sampleEverySteps": sample_every_steps,
            "adjustmentsApplied": applied,
            "samples": samples,
            "final": {
                "dayOfYear": cx.getCurrentDayOfYear(),
                "timeSeconds": cx.getCurrentTimeInSec(),
            },
        }
    finally:
        cx.endSimulation()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["discover", "inspect", "cosim"])
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    request = json.loads(Path(args.request).read_text(encoding="utf-8"))

    try:
        if args.action == "discover":
            payload = discover(request)
        elif args.action == "inspect":
            payload = inspect_project(request)
        elif args.action == "cosim":
            payload = run_cosimulation(request)
        else:
            raise ValueError(f"Unsupported action: {args.action}")

        response = {"ok": True, "payload": payload}
    except Exception as exc:  # pragma: no cover - returned to the MCP layer
        response = {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }

    Path(args.output).write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
    if not response["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
