"""Shared, intentionally small configuration for the MN Portfolio editor tools."""

from __future__ import annotations

import os


PROJECT_ROOT = "/Game/MNPortfolio"
MAP_PATH = f"{PROJECT_ROOT}/Maps/L_MN_Showroom"
IMPORTED_ROOT = f"{PROJECT_ROOT}/Imported/Moto"
MATERIAL_ROOT = f"{PROJECT_ROOT}/Materials"
BLUEPRINT_ROOT = f"{PROJECT_ROOT}/Blueprints"
UI_ROOT = f"{PROJECT_ROOT}/UI"

MOTO_SOURCE_DEFAULT = r"D:\mn\moto-funcional4-animada-v2.glb"
MOTO_SOURCE = os.environ.get("MN_MOTO_GLB", MOTO_SOURCE_DEFAULT)

BIKE_TAG = "MN_BIKE_PART"
GENERATED_TAG = "MN_GENERATED"
BASE_TAG_PREFIX = "MN_BASE:"
TARGET_TAG_PREFIX = "MN_TARGET:"

EXPLODE_DISTANCE_CM = 185.0

CYAN = (0.0, 0.84, 1.0)
MAGENTA = (1.0, 0.03, 0.52)
INK = (0.006, 0.012, 0.025)


def source_file() -> str:
    """Return an absolute source path, allowing MN_MOTO_GLB to override it."""

    return os.path.abspath(os.path.expandvars(os.path.expanduser(MOTO_SOURCE)))
