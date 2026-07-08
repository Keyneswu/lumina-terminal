use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Run git from the workspace root (parent of CARGO_MANIFEST_DIR) so the
    // correct repository is used regardless of where cargo is invoked from.
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = manifest_dir.parent().unwrap_or(&manifest_dir);

    let output = Command::new("git")
        .args(&["rev-parse", "--short", "HEAD"])
        .current_dir(repo_root)
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_else(|| "".into());

    // Pass this to Rust as an environment variable named "GIT_HASH"
    println!("cargo:rustc-env=GIT_HASH={}", output.trim());

    // Re-run this script when HEAD changes so the hash stays current across
    // builds. Without this, cargo caches the build script output and the hash
    // gets stuck at whatever it was the first time it ran.
    let head_path = repo_root.join(".git").join("HEAD");
    if head_path.exists() {
        println!("cargo:rerun-if-changed={}", head_path.display());
    }
    // In worktrees, packed-refs, or shallow clones HEAD may be a ref file
    // under .git/refs — watch the refs dir too as a fallback.
    let refs_path = repo_root.join(".git").join("refs");
    if refs_path.exists() {
        println!("cargo:rerun-if-changed={}", refs_path.display());
    }

    tauri_build::build()
}
