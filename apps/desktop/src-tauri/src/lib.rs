use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    AppHandle,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const SIDECAR_NAME: &str = "reglet";
const FIXED_ARGS: [&str; 4] = ["manager", "rpc", "--json", "--protocol-version=1"];
const MAX_ERROR_CHARS: usize = 160;
const MAX_RPC_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_RPC_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SIDECAR_STDERR_BYTES: usize = 64 * 1024;
const SIDECAR_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(15);
const RELEASE_API_URL: &str = "https://api.github.com/repos/elijahbutler/reglet/releases/latest";
const RELEASE_PAGE_URL: &str = "https://github.com/elijahbutler/reglet/releases/latest";
const BUILD_VERSION: &str = match option_env!("REGLET_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerRpcFailure {
    #[serde(rename = "protocolVersion")]
    protocol_version: u8,
    operation: String,
    ok: bool,
    error: ManagerRpcError,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerRpcError {
    code: String,
    message: String,
    recoverable: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    current_version: String,
    latest_version: String,
    available: bool,
    release_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

#[tauri::command]
async fn manager_rpc(app: AppHandle, request: Value) -> Result<Value, ManagerRpcFailure> {
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    if request.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
        return Err(bridge_error(
            &operation,
            "UNKNOWN_PROTOCOL_VERSION",
            "Reglet rejected an unsupported Manager protocol version.",
            false,
        ));
    }

    let mut payload = serde_json::to_vec(&request)
        .map_err(|error| sidecar_error(&operation, "MALFORMED_REQUEST", error, false))?;
    if payload.len() > MAX_RPC_REQUEST_BYTES {
        return Err(bridge_error(
            &operation,
            "REQUEST_TOO_LARGE",
            "Reglet rejected an oversized Manager request.",
            false,
        ));
    }
    payload.push(b'\n');

    let command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|error| sidecar_error(&operation, "SIDECAR_UNAVAILABLE", error, false))?
        .args(FIXED_ARGS);
    let (mut events, mut child) = command
        .spawn()
        .map_err(|error| sidecar_error(&operation, "SIDECAR_UNAVAILABLE", error, false))?;

    child
        .write(&payload)
        .map_err(|error| sidecar_error(&operation, "SIDECAR_IO", error, true))?;

    let mut exit_code = None;
    let mut stdout = Vec::new();
    let mut stderr_bytes = 0usize;
    loop {
        let event = match tokio::time::timeout(SIDECAR_IDLE_TIMEOUT, events.recv()).await {
            Ok(event) => event,
            Err(_) => {
                let error = bridge_error(
                    &operation,
                    "SIDECAR_TIMEOUT",
                    "Reglet stopped an unresponsive sidecar.",
                    true,
                );
                let _ = child.kill();
                return Err(error);
            }
        };
        let Some(event) = event else { break };
        match event {
            CommandEvent::Stdout(bytes) => {
                if stdout.len().saturating_add(bytes.len() + 1) > MAX_RPC_RESPONSE_BYTES {
                    let error = bridge_error(
                        &operation,
                        "RESPONSE_TOO_LARGE",
                        "Reglet stopped a sidecar that returned an oversized response.",
                        true,
                    );
                    let _ = child.kill();
                    return Err(error);
                }
                stdout.extend(bytes);
                stdout.push(b'\n');
            }
            CommandEvent::Stderr(bytes) => {
                stderr_bytes = stderr_bytes.saturating_add(bytes.len() + 1);
                if stderr_bytes > MAX_SIDECAR_STDERR_BYTES {
                    let error = bridge_error(
                        &operation,
                        "SIDECAR_FAILED",
                        "Reglet stopped a sidecar that produced excessive diagnostic output.",
                        true,
                    );
                    let _ = child.kill();
                    return Err(error);
                }
            }
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            CommandEvent::Error(error) => {
                let failure = sidecar_error(&operation, "SIDECAR_IO", error, true);
                let _ = child.kill();
                return Err(failure);
            }
            _ => {}
        }
    }

    parse_sidecar_output(exit_code, &stdout, &[], &operation)
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateCheckResult, ManagerRpcError> {
    let client = reqwest::Client::builder()
        .timeout(UPDATE_TIMEOUT)
        .build()
        .map_err(|_| {
            update_error(
                "UPDATE_CHECK_FAILED",
                "Reglet could not prepare the update check.",
            )
        })?;
    let release = client
        .get(RELEASE_API_URL)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Reglet-Desktop")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| {
            update_error(
                "UPDATE_CHECK_FAILED",
                "Reglet could not check GitHub Releases.",
            )
        })?
        .json::<GitHubRelease>()
        .await
        .map_err(|_| {
            update_error(
                "UPDATE_CHECK_FAILED",
                "GitHub returned an invalid release response.",
            )
        })?;

    let current = semver::Version::parse(BUILD_VERSION.trim_start_matches('v')).map_err(|_| {
        update_error(
            "UPDATE_VERSION_INVALID",
            "The installed Reglet version is invalid.",
        )
    })?;
    let latest_text = release.tag_name.trim_start_matches('v');
    let latest = semver::Version::parse(latest_text).map_err(|_| {
        update_error(
            "UPDATE_VERSION_INVALID",
            "The latest Reglet version is invalid.",
        )
    })?;
    let release_url = if release
        .html_url
        .starts_with("https://github.com/elijahbutler/reglet/releases/")
    {
        release.html_url
    } else {
        RELEASE_PAGE_URL.to_string()
    };
    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        available: latest > current,
        release_url,
    })
}

#[tauri::command]
fn open_release(app: AppHandle) -> Result<(), ManagerRpcError> {
    #[allow(deprecated)]
    app.shell().open(RELEASE_PAGE_URL, None).map_err(|_| {
        update_error(
            "OPEN_RELEASE_FAILED",
            "Reglet could not open the release page.",
        )
    })
}

#[tauri::command]
fn open_file_location(app: AppHandle, path: String) -> Result<(), ManagerRpcError> {
    let target = allowed_file_target(Path::new(&path)).ok_or_else(|| {
        update_error(
            "OPEN_FILE_LOCATION_REJECTED",
            "Reglet rejected a file location outside managed local data.",
        )
    })?;
    let location = if target.is_dir() {
        target.as_path()
    } else {
        target.parent().unwrap_or(target.as_path())
    };
    #[allow(deprecated)]
    app.shell()
        .open(location.to_string_lossy(), None)
        .map_err(|_| {
            update_error(
                "OPEN_FILE_LOCATION_FAILED",
                "Reglet could not open the file location.",
            )
        })
}

fn allowed_file_target(target: &Path) -> Option<PathBuf> {
    if !target.is_absolute() {
        return None;
    }
    let canonical_target = target.canonicalize().ok()?;
    let home = user_home()?;
    let provider_home = absolute_environment_path("REGLET_PROVIDER_HOME").unwrap_or(home.clone());
    let reglet_home =
        absolute_environment_path("REGLET_HOME").unwrap_or_else(|| home.join(".reglet"));
    let roots = [
        reglet_home,
        provider_home.join(".claude"),
        provider_home.join(".codex"),
        provider_home.join(".cursor"),
        provider_home.join(".gemini"),
        provider_home.join(".codeium").join("windsurf"),
        provider_home.join(".config").join("opencode"),
    ];
    let canonical_roots = roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect::<Vec<_>>();
    let exact_files = [provider_home.join(".claude.json")];
    let canonical_files = exact_files
        .iter()
        .filter_map(|file| file.canonicalize().ok())
        .collect::<Vec<_>>();
    if target_matches_allowed(&canonical_target, &canonical_roots, &canonical_files) {
        return Some(canonical_target);
    }
    None
}

fn target_matches_allowed(target: &Path, roots: &[PathBuf], exact_files: &[PathBuf]) -> bool {
    roots.iter().any(|root| target.starts_with(root))
        || exact_files.iter().any(|file| target == file)
}

fn absolute_environment_path(name: &str) -> Option<PathBuf> {
    let value = std::env::var_os(name)?;
    let path = PathBuf::from(value);
    path.is_absolute().then_some(path)
}

fn user_home() -> Option<PathBuf> {
    absolute_environment_path("HOME").or_else(|| absolute_environment_path("USERPROFILE"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle();
            let application = SubmenuBuilder::new(handle, "Reglet")
                .about(None)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let file = SubmenuBuilder::new(handle, "File").close_window().build()?;
            let edit = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view = SubmenuBuilder::new(handle, "View").fullscreen().build()?;
            let window = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .maximize()
                .build()?;
            let menu = MenuBuilder::new(handle)
                .items(&[&application, &file, &edit, &view, &window])
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            manager_rpc,
            check_for_updates,
            open_release,
            open_file_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reglet desktop");
}

fn parse_sidecar_output(
    exit_code: Option<i32>,
    stdout: &[u8],
    _stderr: &[u8],
    expected_operation: &str,
) -> Result<Value, ManagerRpcFailure> {
    if exit_code != Some(0) {
        return Err(bridge_error(
            expected_operation,
            "SIDECAR_FAILED",
            &format!(
                "Reglet sidecar exited with status {}. Diagnostic output was redacted.",
                exit_code.map_or_else(|| "unknown".to_string(), |code| code.to_string())
            ),
            true,
        ));
    }

    let output = std::str::from_utf8(stdout).map_err(|_| {
        bridge_error(
            expected_operation,
            "MALFORMED_RESPONSE",
            "Reglet sidecar stdout was not UTF-8.",
            true,
        )
    })?;
    let parsed: Value = serde_json::from_str(output.trim()).map_err(|_| {
        bridge_error(
            expected_operation,
            "MALFORMED_RESPONSE",
            "Reglet sidecar returned malformed JSON.",
            true,
        )
    })?;
    if is_valid_rpc_response(&parsed, expected_operation) {
        Ok(parsed)
    } else {
        Err(bridge_error(
            expected_operation,
            "MALFORMED_RESPONSE",
            "Reglet sidecar returned an invalid RPC envelope.",
            true,
        ))
    }
}

fn is_valid_rpc_response(value: &Value, expected_operation: &str) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("protocolVersion").and_then(Value::as_u64) != Some(1)
        || object.get("operation").and_then(Value::as_str) != Some(expected_operation)
    {
        return false;
    }
    match object.get("ok").and_then(Value::as_bool) {
        Some(true) => object.contains_key("result") && !object.contains_key("error"),
        Some(false) => {
            let Some(error) = object.get("error").and_then(Value::as_object) else {
                return false;
            };
            !object.contains_key("result")
                && error.get("code").and_then(Value::as_str).is_some()
                && error.get("message").and_then(Value::as_str).is_some()
                && error.get("recoverable").and_then(Value::as_bool).is_some()
        }
        None => false,
    }
}

fn sidecar_error(
    operation: &str,
    code: &str,
    error: impl std::fmt::Display,
    recoverable: bool,
) -> ManagerRpcFailure {
    bridge_error(
        operation,
        code,
        &format!("The Reglet sidecar could not complete the request: {error}"),
        recoverable,
    )
}

fn bridge_error(
    operation: &str,
    code: &str,
    message: &str,
    recoverable: bool,
) -> ManagerRpcFailure {
    ManagerRpcFailure {
        protocol_version: 1,
        operation: operation.to_string(),
        ok: false,
        error: ManagerRpcError {
            code: code.to_string(),
            message: redact_error_text(message),
            recoverable,
        },
    }
}

fn update_error(code: &str, message: &str) -> ManagerRpcError {
    ManagerRpcError {
        code: code.to_string(),
        message: message.to_string(),
        recoverable: true,
    }
}

fn redact_error_text(message: &str) -> String {
    let mut clean = message.replace('\\', "/");
    let home = std::env::var("HOME").unwrap_or_default().replace('\\', "/");
    if !home.is_empty() {
        clean = clean.replace(&home, "~");
    }
    if contains_secret_marker(&clean) {
        return "Reglet suppressed diagnostic text that may contain a secret.".to_string();
    }
    clean.chars().take(MAX_ERROR_CHARS).collect()
}

fn contains_secret_marker(message: &str) -> bool {
    let upper = message.to_ascii_uppercase();
    [
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PRIVATE",
        "CREDENTIAL",
        "API_KEY",
        "API-KEY",
    ]
    .iter()
    .any(|marker| upper.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_command_is_the_bundled_manager_rpc_sidecar_only() {
        assert_eq!(SIDECAR_NAME, "reglet");
        assert_eq!(
            FIXED_ARGS,
            ["manager", "rpc", "--json", "--protocol-version=1"]
        );
    }

    #[test]
    fn accepts_only_matching_typed_envelopes() {
        let valid = br#"{"protocolVersion":1,"operation":"snapshot","ok":true,"result":{}}"#;
        assert!(parse_sidecar_output(Some(0), valid, b"", "snapshot").is_ok());

        let wrong_operation = br#"{"protocolVersion":1,"operation":"scan","ok":true,"result":{}}"#;
        let error = parse_sidecar_output(Some(0), wrong_operation, b"", "snapshot")
            .expect_err("operation mismatch");
        assert_eq!(error.error.code, "MALFORMED_RESPONSE");
    }

    #[test]
    fn malformed_stdout_becomes_a_typed_error() {
        let error =
            parse_sidecar_output(Some(0), b"not json", b"", "snapshot").expect_err("malformed");
        assert_eq!(error.error.code, "MALFORMED_RESPONSE");
        assert!(error.error.recoverable);
    }

    #[test]
    fn nonzero_stderr_is_never_returned_to_the_frontend() {
        let error = parse_sidecar_output(Some(7), b"", b"MY_SECRET_TOKEN=secret-value", "snapshot")
            .expect_err("failure");
        assert_eq!(error.error.code, "SIDECAR_FAILED");
        assert!(!error.error.message.contains("secret-value"));
        assert!(!error.error.message.contains("MY_SECRET_TOKEN"));
    }

    #[test]
    fn diagnostics_with_secret_markers_fail_closed() {
        assert_eq!(
            redact_error_text("API_KEY=example"),
            "Reglet suppressed diagnostic text that may contain a secret."
        );
    }

    #[test]
    fn build_version_is_semver() {
        assert!(semver::Version::parse(BUILD_VERSION.trim_start_matches('v')).is_ok());
    }

    #[test]
    fn file_reveal_targets_stay_inside_managed_roots_or_exact_files() {
        let base = PathBuf::from("managed");
        let exact = PathBuf::from("provider.json");
        assert!(target_matches_allowed(
            &base.join("rules").join("00-general.md"),
            std::slice::from_ref(&base),
            std::slice::from_ref(&exact),
        ));
        assert!(target_matches_allowed(
            &exact,
            std::slice::from_ref(&base),
            std::slice::from_ref(&exact),
        ));
        assert!(!target_matches_allowed(
            Path::new("outside/private.txt"),
            &[base],
            &[exact],
        ));
    }
}
