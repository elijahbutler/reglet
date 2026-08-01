use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SIDECAR_NAME: &str = "reglet";
const UPDATE_TIMEOUT: Duration = Duration::from_secs(15);
const RELEASE_API_URL: &str = "https://api.github.com/repos/elijahbutler/reglet/releases/latest";
const RELEASE_PAGE_URL: &str = "https://github.com/elijahbutler/reglet/releases/latest";
const RUNTIME_STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const BUILD_VERSION: &str = match option_env!("REGLET_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ManagerRuntimeStartup {
    version: u8,
    listening: bool,
    url: String,
    manager_url: String,
    pairing_expires_at: String,
    remote: bool,
    protocol_version: u8,
}

#[derive(Default)]
struct ManagerRuntimeState {
    child: Mutex<Option<CommandChild>>,
    startup: Mutex<Option<ManagerRuntimeStartup>>,
}

#[tauri::command]
async fn manager_runtime_start(
    app: AppHandle,
    state: State<'_, ManagerRuntimeState>,
) -> Result<ManagerRuntimeStartup, ManagerRpcError> {
    if let Some(startup) = state
        .startup
        .lock()
        .map_err(|_| runtime_state_error())?
        .clone()
    {
        return Ok(startup);
    }
    let command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|_| runtime_start_error())?
        .args(["serve", "--hostname", "127.0.0.1", "--port", "0", "--json"]);
    let (mut events, child) = command.spawn().map_err(|_| runtime_start_error())?;
    let startup = loop {
        let event = tokio::time::timeout(RUNTIME_STARTUP_TIMEOUT, events.recv())
            .await
            .map_err(|_| runtime_start_error())?
            .ok_or_else(runtime_start_error)?;
        match event {
            CommandEvent::Stdout(bytes) => {
                let value = std::str::from_utf8(&bytes).ok().and_then(|text| {
                    serde_json::from_str::<ManagerRuntimeStartup>(text.trim()).ok()
                });
                if let Some(candidate) = value {
                    validate_runtime_startup(&candidate)?;
                    break candidate;
                }
            }
            CommandEvent::Terminated(_) | CommandEvent::Error(_) => {
                return Err(runtime_start_error());
            }
            _ => {}
        }
    };
    *state.child.lock().map_err(|_| runtime_state_error())? = Some(child);
    *state.startup.lock().map_err(|_| runtime_state_error())? = Some(startup.clone());
    tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
    Ok(startup)
}

#[tauri::command]
fn manager_runtime_stop(state: State<'_, ManagerRuntimeState>) -> Result<(), ManagerRpcError> {
    stop_manager_runtime(&state)
}

fn stop_manager_runtime(state: &ManagerRuntimeState) -> Result<(), ManagerRpcError> {
    if let Some(child) = state
        .child
        .lock()
        .map_err(|_| runtime_state_error())?
        .take()
    {
        child.kill().map_err(|_| {
            update_error(
                "RUNTIME_STOP_FAILED",
                "Reglet could not stop the local Manager runtime.",
            )
        })?;
    }
    *state.startup.lock().map_err(|_| runtime_state_error())? = None;
    Ok(())
}

fn validate_runtime_startup(startup: &ManagerRuntimeStartup) -> Result<(), ManagerRpcError> {
    let manager_prefix = format!("{}/manager/#pair=", startup.url);
    if startup.version != 1
        || !startup.listening
        || startup.protocol_version != 2
        || startup.remote
        || !startup.url.starts_with("http://127.0.0.1:")
        || !startup.manager_url.starts_with(&manager_prefix)
        || startup.manager_url.len() <= manager_prefix.len()
    {
        return Err(runtime_start_error());
    }
    Ok(())
}

fn runtime_start_error() -> ManagerRpcError {
    update_error(
        "RUNTIME_START_FAILED",
        "Reglet could not start a safe loopback Manager runtime.",
    )
}

fn runtime_state_error() -> ManagerRpcError {
    update_error(
        "RUNTIME_STATE_FAILED",
        "Reglet could not access local Manager runtime state.",
    )
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
        .manage(ManagerRuntimeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
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
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) && window.label() == "main" {
                let state = window.state::<ManagerRuntimeState>();
                let _ = stop_manager_runtime(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            manager_runtime_start,
            manager_runtime_stop,
            check_for_updates,
            open_release,
            open_file_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reglet desktop");
}

fn update_error(code: &str, message: &str) -> ManagerRpcError {
    ManagerRpcError {
        code: code.to_string(),
        message: message.to_string(),
        recoverable: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
