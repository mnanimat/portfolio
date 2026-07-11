"""Non-destructive editor controls for the generated motorcycle presentation.

These functions are also exposed in the Unreal main Tools menu by init_unreal.py.
They only mutate actors carrying the explicit MN_BIKE_PART tag.
"""

from __future__ import annotations

import importlib
import math

import unreal

import mn_config as cfg


LOG = "MNPortfolio"


def _log(message: str) -> None:
    unreal.log(f"[{LOG}] {message}")


def _warn(message: str) -> None:
    unreal.log_warning(f"[{LOG}] {message}")


def _name(value) -> str:
    return str(value)


def _tagged_actors(tag: str):
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    return [actor for actor in actors if tag in {_name(item) for item in actor.get_editor_property("tags")}]


def _decode_vector(actor, prefix: str):
    for item in actor.get_editor_property("tags"):
        value = _name(item)
        if not value.startswith(prefix):
            continue
        try:
            x, y, z = (float(component) for component in value[len(prefix):].split("|"))
            return unreal.Vector(x, y, z)
        except (TypeError, ValueError):
            _warn(f"Tag de vetor invalida em {actor.get_actor_label()}: {value}")
    return None


def _lerp(a, b, alpha: float):
    return unreal.Vector(
        a.x + (b.x - a.x) * alpha,
        a.y + (b.y - a.y) * alpha,
        a.z + (b.z - a.z) * alpha,
    )


def set_explosion(amount: float) -> int:
    """Set the editor preview explosion from 0.0 (assembled) to 1.0."""

    alpha = max(0.0, min(1.0, float(amount)))
    changed = 0
    for actor in _tagged_actors(cfg.BIKE_TAG):
        base = _decode_vector(actor, cfg.BASE_TAG_PREFIX)
        target = _decode_vector(actor, cfg.TARGET_TAG_PREFIX)
        if base is None or target is None:
            continue
        actor.modify()
        actor.set_actor_location(_lerp(base, target, alpha), False, False)
        changed += 1
    if changed:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    _log(f"Explosao {alpha:.0%}: {changed} peca(s) atualizada(s).")
    return changed


def collapse() -> int:
    return set_explosion(0.0)


def half_explode() -> int:
    return set_explosion(0.5)


def explode() -> int:
    return set_explosion(1.0)


def focus_motorcycle() -> int:
    actors = _tagged_actors(cfg.BIKE_TAG)
    if not actors:
        _warn("Nenhuma peca MN_BIKE_PART encontrada. Execute Build / Rebuild primeiro.")
        return 0
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    subsystem.set_selected_level_actors(actors)
    unreal.SystemLibrary.execute_console_command(None, "CAMERA ALIGN ACTIVEVIEWPORTONLY")
    _log(f"{len(actors)} peca(s) selecionada(s). Pressione F no viewport para enquadrar.")
    return len(actors)


def set_view(view: str) -> None:
    actors = _tagged_actors(cfg.BIKE_TAG)
    if not actors:
        _warn("A moto ainda nao foi importada.")
        return

    minima = unreal.Vector(float("inf"), float("inf"), float("inf"))
    maxima = unreal.Vector(float("-inf"), float("-inf"), float("-inf"))
    for actor in actors:
        origin, extent = actor.get_actor_bounds(False)
        minima.x = min(minima.x, origin.x - extent.x)
        minima.y = min(minima.y, origin.y - extent.y)
        minima.z = min(minima.z, origin.z - extent.z)
        maxima.x = max(maxima.x, origin.x + extent.x)
        maxima.y = max(maxima.y, origin.y + extent.y)
        maxima.z = max(maxima.z, origin.z + extent.z)

    center = (minima + maxima) * 0.5
    radius = max((maxima - minima).length() * 0.72, 300.0)
    presets = {
        "front": (unreal.Vector(center.x - radius, center.y, center.z + radius * 0.08), unreal.Rotator(0, 0, 0)),
        "side": (unreal.Vector(center.x, center.y - radius, center.z + radius * 0.08), unreal.Rotator(0, 90, 0)),
        "rear": (unreal.Vector(center.x + radius, center.y, center.z + radius * 0.08), unreal.Rotator(0, 180, 0)),
        "iso": (unreal.Vector(center.x - radius * 0.72, center.y - radius * 0.72, center.z + radius * 0.46), unreal.Rotator(-18, 45, 0)),
        "top": (unreal.Vector(center.x, center.y, center.z + radius), unreal.Rotator(-89, 0, 0)),
    }
    key = view.lower().strip()
    if key not in presets:
        raise ValueError(f"Vista desconhecida: {view}")
    location, rotation = presets[key]
    unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).set_level_viewport_camera_info(location, rotation)
    _log(f"Vista do editor: {key}.")


def build_all() -> None:
    import mn_build_project

    importlib.reload(mn_build_project)
    mn_build_project.build_all()


def validate() -> bool:
    import mn_validate_project

    importlib.reload(mn_validate_project)
    return mn_validate_project.validate(log=True)


def register_menu() -> None:
    """Register idempotent entries under Tools > MN Portfolio."""

    menus = unreal.ToolMenus.get()
    menu = menus.extend_menu("LevelEditor.MainMenu.Tools")
    menu.add_section("MNPortfolio", "MN Portfolio")

    commands = (
        ("MN_Build", "MN Portfolio - Build / Rebuild", "Importa o GLB e reconstrui a apresentacao.", "import mn_editor_tools; mn_editor_tools.build_all()"),
        ("MN_Validate", "MN Portfolio - Validar", "Verifica fonte, assets e mapa.", "import mn_editor_tools; mn_editor_tools.validate()"),
        ("MN_Collapse", "MN Moto - Montada (0%)", "Recolhe as pecas no Editor.", "import mn_editor_tools; mn_editor_tools.collapse()"),
        ("MN_Half", "MN Moto - Explosao (50%)", "Previa intermediaria no Editor.", "import mn_editor_tools; mn_editor_tools.half_explode()"),
        ("MN_Explode", "MN Moto - Explosao (100%)", "Afasta as pecas no Editor.", "import mn_editor_tools; mn_editor_tools.explode()"),
        ("MN_ViewIso", "MN Moto - Vista isometrica", "Move a camera do viewport.", "import mn_editor_tools; mn_editor_tools.set_view('iso')"),
    )
    for name, label, tooltip, command in commands:
        entry = unreal.ToolMenuEntry(name=name, type=unreal.MultiBlockType.MENU_ENTRY)
        entry.set_label(label)
        entry.set_tool_tip(tooltip)
        entry.set_string_command(unreal.ToolMenuStringCommandType.PYTHON, "", command)
        menu.add_menu_entry("MNPortfolio", entry)
    menus.refresh_all_widgets()
    _log("Menu Tools > MN Portfolio registrado.")
