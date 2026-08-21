fn main() {
    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("../alunixa-x-manager/src-tauri/icons/icon.ico");
        resource.set_manifest(include_str!(
            "../alunixa-x-manager/src-tauri/windows-app-manifest.xml"
        ));
        resource.compile().expect("compile launcher icon resource");
    }
}
