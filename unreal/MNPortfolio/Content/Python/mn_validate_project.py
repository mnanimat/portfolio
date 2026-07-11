"""Read-only validation intended for both the Editor menu and UnrealEditor-Cmd."""

from __future__ import annotations

import os

import unreal

import mn_config as cfg


def _check(label, passed, detail):
    return {"label": label, "passed": bool(passed), "detail": str(detail)}


def validate(log=True, require_built=False):
    version = unreal.SystemLibrary.get_engine_version()
    source = cfg.source_file()
    checks = [
        _check("Unreal Engine", version.startswith("5.8"), version),
        _check("GLB fonte", os.path.isfile(source), source),
        _check("Interchange", hasattr(unreal, "InterchangeManager"), "InterchangeManager exposto ao Python"),
        _check("Python Editor", hasattr(unreal, "EditorAssetLibrary"), "EditorAssetLibrary disponivel"),
        _check("Blueprint Graph 5.8", hasattr(unreal, "BlueprintGraphEditor"), "API de grafo 5.8 disponivel"),
    ]
    built_assets = (
        cfg.MAP_PATH,
        f"{cfg.BLUEPRINT_ROOT}/BP_MN_ViewerPawn",
        f"{cfg.BLUEPRINT_ROOT}/BP_MN_GameMode",
        f"{cfg.UI_ROOT}/WBP_MN_HUD",
    )
    for path in built_assets:
        exists = unreal.EditorAssetLibrary.does_asset_exist(path)
        checks.append(_check(f"Asset {path.rsplit('/', 1)[-1]}", exists or not require_built, path))

    passed = all(item["passed"] for item in checks)
    if log:
        for item in checks:
            writer = unreal.log if item["passed"] else unreal.log_error
            writer(f"[MNPortfolio] {'OK' if item['passed'] else 'FALHA'} | {item['label']} | {item['detail']}")
        (unreal.log if passed else unreal.log_error)(
            f"[MNPortfolio] Validacao {'aprovada' if passed else 'reprovada'}."
        )
    return passed


if __name__ == "__main__":
    if not validate(log=True, require_built=False):
        raise RuntimeError("Validacao MNPortfolio falhou; consulte o Output Log.")
