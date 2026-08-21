pub use alunixa_x_core::install::{
    EntryPointState, InstallActionResult, InstallOptions, ShortcutState, inspect_entrypoints,
};

pub fn install_entrypoints() -> InstallActionResult {
    alunixa_x_core::install::install_entrypoints(&InstallOptions::default())
}

pub fn uninstall_entrypoints(options: InstallOptions) -> InstallActionResult {
    alunixa_x_core::install::uninstall_entrypoints(&options)
}

pub fn repair_shortcuts() -> InstallActionResult {
    alunixa_x_core::install::repair_entrypoints(&InstallOptions::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_entrypoints_reports_two_entrypoints() {
        let state = inspect_entrypoints();

        assert!(matches!(state.silent_shortcut.installed, true | false));
        assert!(matches!(state.management_shortcut.installed, true | false));
    }
}
