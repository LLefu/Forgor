fn main() {
    tauri_build::build();

    // macOS: llama.cpp's Metal code uses `@available(macOS 15, …)` checks. With
    // our deployment target (12.0) clang turns those into calls to
    // `__isPlatformVersionAtLeast` from its runtime library, which Rust doesn't
    // link by default ("Undefined symbols … ___isPlatformVersionAtLeast" in
    // release builds). Link clang's macOS runtime explicitly.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let resource_dir = std::process::Command::new("xcrun")
            .args(["clang", "--print-resource-dir"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
        match resource_dir {
            Some(dir) => {
                println!("cargo:rustc-link-search=native={dir}/lib/darwin");
                println!("cargo:rustc-link-lib=static=clang_rt.osx");
            }
            None => println!("cargo:warning=could not find clang's runtime library (xcrun clang --print-resource-dir)"),
        }
    }
}
