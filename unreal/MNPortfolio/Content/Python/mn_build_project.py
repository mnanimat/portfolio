"""Build the MN Portfolio showroom from source data inside Unreal Editor 5.8.

Run through Tools > MN Portfolio - Build / Rebuild, or with UnrealEditor-Cmd.
The script is idempotent and only deletes generated content below /Game/MNPortfolio.
"""

from __future__ import annotations

import math
import os

import unreal

import mn_config as cfg


LOG = "MNPortfolio"


def _log(message: str) -> None:
    unreal.log(f"[{LOG}] {message}")


def _warn(message: str) -> None:
    unreal.log_warning(f"[{LOG}] {message}")


def _set(obj, names, value, required=False):
    """Set a reflected property while tolerating b-prefix wrapper differences."""

    for name in names if isinstance(names, (tuple, list)) else (names,):
        try:
            obj.set_editor_property(name, value)
            return True
        except Exception:
            try:
                setattr(obj, name, value)
                return True
            except Exception:
                pass
    if required:
        raise RuntimeError(f"Propriedade nao encontrada em {obj}: {names}")
    return False


def _ensure_directories() -> None:
    for path in (
        cfg.PROJECT_ROOT,
        f"{cfg.PROJECT_ROOT}/Maps",
        cfg.IMPORTED_ROOT,
        cfg.MATERIAL_ROOT,
        cfg.BLUEPRINT_ROOT,
        cfg.UI_ROOT,
    ):
        unreal.EditorAssetLibrary.make_directory(path)


def _has_tag(actor, tag: str) -> bool:
    return tag in {str(item) for item in actor.get_editor_property("tags")}


def _add_tag(actor, tag: str) -> None:
    tags = list(actor.get_editor_property("tags"))
    if tag not in {str(item) for item in tags}:
        tags.append(unreal.Name(tag))
        actor.set_editor_property("tags", tags)


def _encode_vector(prefix: str, value) -> str:
    return f"{prefix}{value.x:.5f}|{value.y:.5f}|{value.z:.5f}"


def _prepare_level():
    _ensure_directories()
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(cfg.MAP_PATH):
        if not level_subsystem.load_level(cfg.MAP_PATH):
            raise RuntimeError(f"Nao foi possivel carregar {cfg.MAP_PATH}")
        actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        old_generated = [
            actor
            for actor in actor_subsystem.get_all_level_actors()
            if _has_tag(actor, cfg.GENERATED_TAG) or _has_tag(actor, cfg.BIKE_TAG)
        ]
        if old_generated:
            actor_subsystem.destroy_actors(old_generated)
    else:
        if not level_subsystem.new_level(cfg.MAP_PATH):
            raise RuntimeError(f"Nao foi possivel criar {cfg.MAP_PATH}")

    if unreal.EditorAssetLibrary.does_directory_exist(cfg.IMPORTED_ROOT):
        unreal.EditorAssetLibrary.delete_directory(cfg.IMPORTED_ROOT)
    unreal.EditorAssetLibrary.make_directory(cfg.IMPORTED_ROOT)
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()


def _import_motorcycle(world):
    filename = cfg.source_file()
    if not os.path.isfile(filename):
        raise FileNotFoundError(
            f"GLB nao encontrado: {filename}. Defina MN_MOTO_GLB para usar outro caminho."
        )

    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    before = {actor.get_path_name() for actor in actor_subsystem.get_all_level_actors()}
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(filename)
    if source is None or not manager.can_translate_source_data(source, True):
        raise RuntimeError("O Interchange glTF nao reconheceu o arquivo como cena importavel.")

    params = unreal.ImportAssetParameters()
    _set(params, ("is_automated", "automated", "bIsAutomated"), True, True)
    _set(params, ("follow_redirectors", "bFollowRedirectors"), True)
    _set(params, ("replace_existing", "bReplaceExisting"), True)
    _set(params, ("force_show_dialog", "bForceShowDialog"), False)
    _set(params, ("destination_name", "DestinationName"), "MN_Moto")
    # In UE 5.8 the current Level is exposed by LevelEditorSubsystem, not UWorld.
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    import_level = level_subsystem.get_current_level()
    _set(params, ("import_level", "ImportLevel"), import_level, True)

    _log(f"Importando cena: {filename}")
    if not manager.import_scene(cfg.IMPORTED_ROOT, source, params):
        raise RuntimeError("Interchange ImportScene retornou falha. Consulte Output Log > Interchange.")

    added = [
        actor
        for actor in actor_subsystem.get_all_level_actors()
        if actor.get_path_name() not in before
    ]
    if not added:
        raise RuntimeError("A importacao terminou sem criar atores no mapa.")
    _log(f"Interchange criou {len(added)} ator(es).")
    return added


def _mesh_components(actor):
    components = list(actor.get_components_by_class(unreal.StaticMeshComponent))
    components += list(actor.get_components_by_class(unreal.SkeletalMeshComponent))
    return [component for component in components if component is not None]


def _flatten_multi_component_actors(imported_actors):
    """Turn multi-mesh scene containers into movable actors for exploded views."""

    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    parts = []
    for actor in imported_actors:
        components = _mesh_components(actor)
        if not components:
            _add_tag(actor, cfg.GENERATED_TAG)
            continue
        if len(components) == 1:
            parts.append(actor)
            continue

        duplicated = 0
        for index, component in enumerate(components):
            if not isinstance(component, unreal.StaticMeshComponent):
                continue
            mesh = component.get_editor_property("static_mesh")
            if mesh is None:
                continue
            location = component.get_world_location()
            rotation = component.get_world_rotation()
            duplicate = actor_subsystem.spawn_actor_from_object(mesh, location, rotation)
            duplicate.set_actor_scale3d(component.get_world_scale())
            duplicate.set_actor_label(f"MOTO_{actor.get_actor_label()}_{index:03d}")
            duplicate.set_folder_path("MNPortfolio/Moto")
            _add_tag(duplicate, cfg.GENERATED_TAG)
            parts.append(duplicate)
            duplicated += 1
        if duplicated:
            actor.set_actor_hidden_in_game(True)
            actor.set_is_temporarily_hidden_in_editor(True)
            _add_tag(actor, cfg.GENERATED_TAG)
        else:
            parts.append(actor)
    return parts


def _bounds(actors):
    low = unreal.Vector(float("inf"), float("inf"), float("inf"))
    high = unreal.Vector(float("-inf"), float("-inf"), float("-inf"))
    for actor in actors:
        origin, extent = actor.get_actor_bounds(False)
        low.x = min(low.x, origin.x - extent.x)
        low.y = min(low.y, origin.y - extent.y)
        low.z = min(low.z, origin.z - extent.z)
        high.x = max(high.x, origin.x + extent.x)
        high.y = max(high.y, origin.y + extent.y)
        high.z = max(high.z, origin.z + extent.z)
    if not math.isfinite(low.x):
        raise RuntimeError("Nenhuma peca de malha foi encontrada no GLB.")
    return low, high, (low + high) * 0.5


def _prepare_parts(imported_actors):
    parts = _flatten_multi_component_actors(imported_actors)
    if not parts:
        raise RuntimeError("O GLB nao produziu StaticMeshComponent nem SkeletalMeshComponent.")
    low, high, center = _bounds(parts)
    distance = max(cfg.EXPLODE_DISTANCE_CM, (high - low).length() * 0.18)

    for index, actor in enumerate(parts):
        actor.set_folder_path("MNPortfolio/Moto")
        _add_tag(actor, cfg.BIKE_TAG)
        _add_tag(actor, cfg.GENERATED_TAG)
        base = actor.get_actor_location()
        direction = base - center
        if direction.length() < 1.0:
            angle = index * 2.399963229728653
            direction = unreal.Vector(math.cos(angle), math.sin(angle), ((index % 5) - 2) * 0.18)
        direction = direction.normal()
        target = base + direction * distance
        _add_tag(actor, _encode_vector(cfg.BASE_TAG_PREFIX, base))
        _add_tag(actor, _encode_vector(cfg.TARGET_TAG_PREFIX, target))

    _log(f"{len(parts)} peca(s) prontas para vista explodida; alcance {distance:.1f} cm.")
    return parts, low, high, center


def _create_material(name: str, base_rgb, emissive_rgb=None, strength=0.0):
    path = f"{cfg.MATERIAL_ROOT}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, cfg.MATERIAL_ROOT, unreal.Material, unreal.MaterialFactoryNew()
    )
    base = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant3Vector, -420, -20
    )
    base.set_editor_property("constant", unreal.LinearColor(*base_rgb, 1.0))
    unreal.MaterialEditingLibrary.connect_material_property(
        base, "", unreal.MaterialProperty.MP_BASE_COLOR
    )
    metallic = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant, -420, 100
    )
    metallic.set_editor_property("r", 0.72)
    unreal.MaterialEditingLibrary.connect_material_property(
        metallic, "", unreal.MaterialProperty.MP_METALLIC
    )
    roughness = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant, -420, 190
    )
    roughness.set_editor_property("r", 0.24)
    unreal.MaterialEditingLibrary.connect_material_property(
        roughness, "", unreal.MaterialProperty.MP_ROUGHNESS
    )
    if emissive_rgb and strength > 0.0:
        color = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant3Vector, -420, 290
        )
        color.set_editor_property("constant", unreal.LinearColor(*emissive_rgb, 1.0))
        scalar = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant, -420, 390
        )
        scalar.set_editor_property("r", float(strength))
        multiply = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionMultiply, -180, 330
        )
        unreal.MaterialEditingLibrary.connect_material_expressions(color, "", multiply, "A")
        unreal.MaterialEditingLibrary.connect_material_expressions(scalar, "", multiply, "B")
        unreal.MaterialEditingLibrary.connect_material_property(
            multiply, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR
        )
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, False)
    return material


def _spawn_mesh(mesh, label, location, scale, material=None):
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    # spawn_actor_from_object can crash the UE 5.8 Python commandlet after a
    # large Interchange import. Creating a StaticMeshActor explicitly is stable
    # in both headless and interactive Editor sessions.
    actor = actor_subsystem.spawn_actor_from_class(
        unreal.StaticMeshActor, location, unreal.Rotator()
    )
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    component.set_static_mesh(mesh)
    actor.set_actor_label(label)
    actor.set_folder_path("MNPortfolio/Environment")
    actor.set_actor_scale3d(scale)
    _add_tag(actor, cfg.GENERATED_TAG)
    if material is not None:
        component.set_material(0, material)
    return actor


def _build_environment(low, high, center):
    cube = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")
    if cube is None:
        raise RuntimeError("Asset /Engine/BasicShapes/Cube.Cube nao encontrado.")
    floor_material = _create_material("M_MN_CyberFloor", cfg.INK, cfg.CYAN, 0.16)
    cyan_material = _create_material("M_MN_NeonCyan", (0.001, 0.05, 0.08), cfg.CYAN, 24.0)
    magenta_material = _create_material("M_MN_NeonMagenta", (0.08, 0.001, 0.04), cfg.MAGENTA, 20.0)
    size = high - low
    radius = max(size.x, size.y, 500.0)
    floor_z = low.z - 16.0
    _spawn_mesh(
        cube,
        "MN_Floor",
        unreal.Vector(center.x, center.y, floor_z),
        unreal.Vector(radius * 3.2 / 100.0, radius * 3.2 / 100.0, 0.12),
        floor_material,
    )
    rail_offset = radius * 1.25
    for sign, material in ((-1.0, cyan_material), (1.0, magenta_material)):
        _spawn_mesh(
            cube,
            f"MN_NeonRail_{'Cyan' if sign < 0 else 'Magenta'}",
            unreal.Vector(center.x, center.y + sign * rail_offset, floor_z + 4.0),
            unreal.Vector(radius * 2.25 / 100.0, 0.035, 0.035),
            material,
        )

    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for label, klass, offset, color, intensity in (
        ("MN_Key_Cyan", unreal.RectLight, unreal.Vector(-radius, -radius * 0.7, radius * 0.8), unreal.Color(0, 214, 255), 6500.0),
        ("MN_Rim_Magenta", unreal.RectLight, unreal.Vector(radius, radius * 0.7, radius * 0.55), unreal.Color(255, 8, 132), 5200.0),
    ):
        light = actor_subsystem.spawn_actor_from_class(klass, center + offset, unreal.Rotator(-18, 0, 0))
        light.set_actor_label(label)
        light.set_folder_path("MNPortfolio/Lights")
        _add_tag(light, cfg.GENERATED_TAG)
        component = light.get_component_by_class(unreal.RectLightComponent)
        _set(component, "intensity", intensity)
        try:
            component.set_light_color(color)
        except Exception:
            _set(component, "light_color", color)
        _set(component, ("source_width", "SourceWidth"), radius * 0.75)
        _set(component, ("source_height", "SourceHeight"), radius * 0.75)

    post = actor_subsystem.spawn_actor_from_class(unreal.PostProcessVolume, center, unreal.Rotator())
    post.set_actor_label("MN_PostProcess")
    post.set_folder_path("MNPortfolio/Environment")
    _add_tag(post, cfg.GENERATED_TAG)
    _set(post, ("unbound", "bUnbound"), True)
    _set(post, "blend_weight", 1.0)
    return max(size.length() * 1.35, 650.0)


def _create_hud():
    path = f"{cfg.UI_ROOT}/WBP_MN_HUD"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    factory = unreal.WidgetBlueprintFactory()
    _set(factory, "parent_class", unreal.UserWidget)
    widget_bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "WBP_MN_HUD", cfg.UI_ROOT, unreal.WidgetBlueprint, factory
    )
    try:
        # UE 5.8 does not expose WidgetBlueprint.widget_tree to Python in every
        # commandlet build. An empty UserWidget is still a valid runtime class,
        # so keep the automated build/package pipeline moving in that case.
        tree = widget_bp.get_editor_property("widget_tree")
    except Exception as exc:
        _warn(
            "UE 5.8 nao expos a arvore visual do WidgetBlueprint no commandlet; "
            f"continuando com HUD runtime vazio: {exc}"
        )
        unreal.BlueprintEditorLibrary.compile_blueprint(widget_bp)
        unreal.EditorAssetLibrary.save_loaded_asset(widget_bp, False)
        return widget_bp
    root = unreal.new_object(unreal.CanvasPanel, outer=tree, name="RootCanvas")
    tree.set_editor_property("root_widget", root)
    panel = unreal.new_object(unreal.Border, outer=tree, name="InfoPanel")
    panel.set_brush_color(unreal.LinearColor(0.004, 0.009, 0.022, 0.88))
    panel.set_padding(unreal.Margin(24.0, 18.0, 24.0, 18.0))
    panel_slot = root.add_child_to_canvas(panel)
    panel_slot.set_position(unreal.Vector2D(28.0, 28.0))
    panel_slot.set_size(unreal.Vector2D(820.0, 214.0))
    column = unreal.new_object(unreal.VerticalBox, outer=tree, name="InfoColumn")
    panel.set_content(column)

    lines = (
        ("MN // PORTFOLIO 3D", 34, unreal.LinearColor(0.0, 0.84, 1.0, 1.0)),
        ("MOTO • PEÇAS • VISTAS • EXPLOSÃO", 22, unreal.LinearColor(1.0, 0.03, 0.52, 1.0)),
        ("RMB + arrastar: órbita   •   scroll: zoom   •   Q / E: explosão   •   1—4: vistas", 16, unreal.LinearColor(0.74, 0.84, 0.92, 1.0)),
        ("Orçamento: +55 75 98232-1124   •   mnanimat@gmail.com", 16, unreal.LinearColor(0.90, 0.94, 0.98, 1.0)),
    )
    roboto = unreal.load_asset("/Engine/EngineFonts/Roboto.Roboto")
    for index, (text, size, color) in enumerate(lines):
        block = unreal.new_object(unreal.TextBlock, outer=tree, name=f"Line_{index}")
        block.set_text(unreal.Text(text))
        block.set_color_and_opacity(unreal.SlateColor(specified_color=color))
        if roboto is not None:
            _set(block, "font", unreal.SlateFontInfo(font_object=roboto, size=size))
        slot = column.add_child_to_vertical_box(block)
        slot.set_padding(unreal.Margin(0.0, 2.0, 0.0, 4.0))
    unreal.BlueprintEditorLibrary.compile_blueprint(widget_bp)
    unreal.EditorAssetLibrary.save_loaded_asset(widget_bp, False)
    return widget_bp


def _add_blueprint_component(blueprint, parent_handle, component_class, name):
    subsystem = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    params = unreal.AddNewSubobjectParams(
        parent_handle=parent_handle,
        new_class=component_class,
        blueprint_context=blueprint,
    )
    handle, fail_reason = subsystem.add_new_subobject(params)
    if not unreal.SubobjectDataBlueprintFunctionLibrary.is_handle_valid(handle):
        raise RuntimeError(f"Falha ao criar componente {name}: {fail_reason}")
    subsystem.rename_subobject(handle, unreal.Text(name))
    data = unreal.SubobjectDataBlueprintFunctionLibrary.get_data(handle)
    template = unreal.SubobjectDataBlueprintFunctionLibrary.get_object_for_blueprint(data, blueprint)
    return handle, template


def _create_runtime_blueprints(center, orbit_distance, hud_bp):
    pawn_path = f"{cfg.BLUEPRINT_ROOT}/BP_MN_ViewerPawn"
    game_mode_path = f"{cfg.BLUEPRINT_ROOT}/BP_MN_GameMode"
    for path in (pawn_path, game_mode_path):
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            unreal.EditorAssetLibrary.delete_asset(path)

    pawn_bp = unreal.BlueprintEditorLibrary.create_blueprint_asset_with_parent(pawn_path, unreal.Pawn)
    subsystem = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    handles = subsystem.k2_gather_subobject_data_for_blueprint(pawn_bp)
    if not handles:
        raise RuntimeError("SubobjectDataSubsystem nao retornou a raiz do Pawn.")
    root_handle = handles[0]
    spring_handle, spring = _add_blueprint_component(
        pawn_bp, root_handle, unreal.SpringArmComponent, "OrbitArm"
    )
    _set(spring, "target_arm_length", float(orbit_distance))
    _set(spring, ("do_collision_test", "bDoCollisionTest"), False)
    _set(spring, "relative_rotation", unreal.Rotator(-8.0, 0.0, 0.0))
    camera_handle, camera = _add_blueprint_component(
        pawn_bp, spring_handle, unreal.CameraComponent, "ViewerCamera"
    )
    _set(camera, "field_of_view", 46.0)
    _set(camera, ("auto_activate", "bAutoActivate"), True)
    hud_class = unreal.BlueprintEditorLibrary.generated_class(hud_bp)
    _, hud_component = _add_blueprint_component(
        pawn_bp, camera_handle, unreal.WidgetComponent, "PortfolioHUD"
    )
    _set(hud_component, "widget_class", hud_class)
    _set(hud_component, "widget_space", unreal.WidgetSpace.SCREEN)
    _set(hud_component, "draw_size", unreal.IntPoint(1920, 1080))
    _set(hud_component, "pivot", unreal.Vector2D(0.5, 0.5))
    _set(hud_component, "relative_location", unreal.Vector(120.0, 0.0, 0.0))
    _, rotating = _add_blueprint_component(
        pawn_bp, root_handle, unreal.RotatingMovementComponent, "IdleOrbit"
    )
    _set(rotating, "rotation_rate", unreal.Rotator(0.0, 7.0, 0.0))

    unreal.BlueprintEditorLibrary.add_member_variable(
        pawn_bp, "ExplosionAmount", unreal.BlueprintEditorLibrary.get_basic_type_by_name("real")
    )
    unreal.BlueprintEditorLibrary.add_member_variable(
        pawn_bp, "ExplosionDistance", unreal.BlueprintEditorLibrary.get_basic_type_by_name("real")
    )
    unreal.BlueprintEditorLibrary.add_member_variable(
        pawn_bp, "BikeCenter", unreal.BlueprintEditorLibrary.get_struct_type(unreal.Vector.static_struct())
    )
    for variable in ("ExplosionAmount", "ExplosionDistance", "BikeCenter"):
        unreal.BlueprintEditorLibrary.set_blueprint_variable_instance_editable(pawn_bp, variable, True)
        unreal.BlueprintEditorLibrary.set_blueprint_variable_category(
            pawn_bp, variable, unreal.Text("MN Portfolio|Viewer")
        )
    unreal.BlueprintEditorLibrary.compile_blueprint(pawn_bp)
    pawn_class = unreal.BlueprintEditorLibrary.generated_class(pawn_bp)
    pawn_cdo = unreal.get_default_object(pawn_class)
    _set(pawn_cdo, "explosion_amount", 0.0)
    _set(pawn_cdo, "explosion_distance", float(cfg.EXPLODE_DISTANCE_CM))
    _set(pawn_cdo, "bike_center", center)
    unreal.EditorAssetLibrary.save_loaded_asset(pawn_bp, False)

    game_mode_bp = unreal.BlueprintEditorLibrary.create_blueprint_asset_with_parent(
        game_mode_path, unreal.GameModeBase
    )
    unreal.BlueprintEditorLibrary.compile_blueprint(game_mode_bp)
    game_mode_class = unreal.BlueprintEditorLibrary.generated_class(game_mode_bp)
    game_mode_cdo = unreal.get_default_object(game_mode_class)
    _set(game_mode_cdo, "default_pawn_class", pawn_class, True)
    unreal.EditorAssetLibrary.save_loaded_asset(game_mode_bp, False)
    return pawn_class, game_mode_class


def _place_player_start(center, game_mode_class):
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    start = actor_subsystem.spawn_actor_from_class(unreal.PlayerStart, center, unreal.Rotator())
    start.set_actor_label("MN_PlayerStart")
    start.set_folder_path("MNPortfolio/Runtime")
    _add_tag(start, cfg.GENERATED_TAG)
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    settings = world.get_world_settings()
    _set(settings, "default_game_mode", game_mode_class)


def _resume_saved_import():
    """Load the persisted motorcycle/map after a later build stage failed."""

    if not unreal.EditorAssetLibrary.does_asset_exist(cfg.MAP_PATH):
        raise RuntimeError(f"Mapa salvo nao encontrado para retomar: {cfg.MAP_PATH}")
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not level_subsystem.load_level(cfg.MAP_PATH):
        raise RuntimeError(f"Nao foi possivel carregar {cfg.MAP_PATH}")
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = actor_subsystem.get_all_level_actors()
    parts = [actor for actor in actors if _has_tag(actor, cfg.BIKE_TAG)]
    if not parts:
        raise RuntimeError("O mapa salvo nao contem pecas MN_BIKE_PART para retomar o build.")

    stale_presentation = [
        actor
        for actor in actors
        if _has_tag(actor, cfg.GENERATED_TAG) and not _has_tag(actor, cfg.BIKE_TAG)
    ]
    if stale_presentation:
        actor_subsystem.destroy_actors(stale_presentation)
    low, high, center = _bounds(parts)
    _log(f"Retomando importacao salva com {len(parts)} peca(s).")
    return parts, low, high, center


def build_all() -> None:
    """Rebuild imported assets, presentation map, HUD and content-only Blueprints."""

    with unreal.ScopedSlowTask(8.0, "Construindo MN Portfolio 3D") as task:
        task.make_dialog(True)
        resume = os.environ.get("MN_RESUME_BUILD", "").lower() in ("1", "true", "yes")
        if resume:
            task.enter_progress_frame(4.0, "Retomando importacao salva")
            _parts, low, high, center = _resume_saved_import()
        else:
            task.enter_progress_frame(1.0, "Preparando mapa")
            world = _prepare_level()
            task.enter_progress_frame(2.0, "Importando GLB da moto")
            imported = _import_motorcycle(world)
            task.enter_progress_frame(1.0, "Preparando pecas e explosao")
            _parts, low, high, center = _prepare_parts(imported)
            # Persist the costly Interchange result before building presentation
            # assets so a later editor-side failure never forces a full reimport.
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
            unreal.EditorAssetLibrary.save_directory(cfg.IMPORTED_ROOT, False, True)
        task.enter_progress_frame(1.0, "Criando materiais e luzes")
        orbit_distance = _build_environment(low, high, center)
        task.enter_progress_frame(1.0, "Criando HUD")
        hud_bp = _create_hud()
        task.enter_progress_frame(1.0, "Criando Blueprints runtime")
        _pawn_class, game_mode_class = _create_runtime_blueprints(center, orbit_distance, hud_bp)
        _place_player_start(center, game_mode_class)
        task.enter_progress_frame(1.0, "Salvando assets")
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
        unreal.EditorAssetLibrary.save_directory(cfg.PROJECT_ROOT, False, True)
    _log("Build concluido. Use Tools > MN Moto para testar as vistas explodidas no Editor.")


if __name__ == "__main__":
    build_all()
