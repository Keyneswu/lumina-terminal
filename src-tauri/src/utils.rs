/// Tiny filesystem helpers exposed to the frontend. Kept as their own module
/// since they are general-purpose (not SSH / shell / system / update specific).
/// Larger concerns each have their own module — see `ssh`, `shells`, `system`,
/// `install_source`, `file_manager`.

#[tauri::command]
pub fn path_exist(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub fn read_file(path: String) -> String {
    match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            // Often called speculatively (theme probing), so debug-level.
            log::debug!("read_file failed for {}: {}", path, e);
            String::new()
        }
    }
}
