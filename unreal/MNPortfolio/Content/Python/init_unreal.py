"""Unreal Python startup hook: adds the MN Portfolio editor menu."""

import unreal


_STARTUP_HANDLE = None


def _register_menu_after_startup():
    try:
        import mn_editor_tools

        mn_editor_tools.register_menu()
    except Exception as exc:  # keep the editor usable if an API changes
        unreal.log_warning(f"[MNPortfolio] Nao foi possivel registrar o menu: {exc}")


def _on_first_tick(_delta_seconds):
    global _STARTUP_HANDLE
    _register_menu_after_startup()
    if _STARTUP_HANDLE is not None:
        unreal.unregister_slate_post_tick_callback(_STARTUP_HANDLE)
        _STARTUP_HANDLE = None


_STARTUP_HANDLE = unreal.register_slate_post_tick_callback(_on_first_tick)
