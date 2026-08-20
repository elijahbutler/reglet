use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    ipc::Channel,
    menu::{MenuBuilder, SubmenuBuilder},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const SIDECAR_NAME: &str = "reglet";
const UPDATE_TIMEOUT: Duration = Duration::from_secs(15);
const UPDATE_ENDPOINT: &str =
    "https://github.com/elijahbutler/reglet/releases/latest/download/latest.json";
const UPDATER_PUBLIC_KEY: Option<&str> = option_env!("REGLET_UPDATER_PUBLIC_KEY");
const RUNTIME_STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const RUNTIME_STARTUP_MAX_BYTES: usize = 16 * 1024;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerRpcError {
    code: String,
    message: String,
    recoverable: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum UpdateCheckResult {
    Disabled {
        current_version: String,
        reason: String,
    },
    Current {
        current_version: String,
    },
    Available {
        current_version: String,
        latest_version: String,
        notes: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum UpdateDownloadEvent {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
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
    lifecycle: tokio::sync::Mutex<()>,
    child: Mutex<Option<CommandChild>>,
    startup: Mutex<Option<ManagerRuntimeStartup>>,
    generation: AtomicU64,
}

#[derive(Default)]
struct PendingUpdateState(Mutex<Option<Update>>);

#[tauri::command]
async fn manager_runtime_start(
    app: AppHandle,
    state: State<'_, ManagerRuntimeState>,
) -> Result<ManagerRuntimeStartup, ManagerRpcError> {
    let _lifecycle = state.lifecycle.lock().await;
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
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let (mut events, child) = command.spawn().map_err(|_| runtime_start_error())?;
    let startup_result = tokio::time::timeout(RUNTIME_STARTUP_TIMEOUT, async {
        let mut stdout = Vec::new();
        loop {
            let event = events.recv().await.ok_or_else(runtime_start_error)?;
            match event {
                CommandEvent::Stdout(bytes) => {
                    if stdout.len().saturating_add(bytes.len()) > RUNTIME_STARTUP_MAX_BYTES {
                        return Err(runtime_start_error());
                    }
                    stdout.extend_from_slice(&bytes);
                    if let Some(candidate) = parse_runtime_startup(&stdout)? {
                        return Ok(candidate);
                    }
                }
                CommandEvent::Terminated(_) | CommandEvent::Error(_) => {
                    return Err(runtime_start_error());
                }
                _ => {}
            }
        }
    })
    .await;
    let startup = match startup_result {
        Ok(Ok(startup)) => startup,
        Ok(Err(error)) => {
            let _ = child.kill();
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill();
            return Err(runtime_start_error());
        }
    };
    *state.child.lock().map_err(|_| runtime_state_error())? = Some(child);
    *state.startup.lock().map_err(|_| runtime_state_error())? = Some(startup.clone());
    let runtime_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if !matches!(event, CommandEvent::Terminated(_) | CommandEvent::Error(_)) {
                continue;
            }
            let runtime_state = runtime_app.state::<ManagerRuntimeState>();
            let _lifecycle = runtime_state.lifecycle.lock().await;
            if runtime_state.generation.load(Ordering::SeqCst) == generation {
                let _ = runtime_state.child.lock().map(|mut child| child.take());
                let _ = runtime_state
                    .startup
                    .lock()
                    .map(|mut startup| startup.take());
            }
            break;
        }
    });
    Ok(startup)
}

#[tauri::command]
async fn manager_runtime_stop(
    state: State<'_, ManagerRuntimeState>,
) -> Result<(), ManagerRpcError> {
    stop_manager_runtime(&state).await
}

async fn stop_manager_runtime(state: &ManagerRuntimeState) -> Result<(), ManagerRpcError> {
    let _lifecycle = state.lifecycle.lock().await;
    state.generation.fetch_add(1, Ordering::SeqCst);
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

fn parse_runtime_startup(bytes: &[u8]) -> Result<Option<ManagerRuntimeStartup>, ManagerRpcError> {
    match serde_json::from_slice(bytes) {
        Ok(startup) => {
            validate_runtime_startup(&startup)?;
            Ok(Some(startup))
        }
        Err(error) if error.is_eof() => Ok(None),
        Err(_) => Err(runtime_start_error()),
    }
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
async fn check_for_updates(
    app: AppHandle,
    state: State<'_, PendingUpdateState>,
) -> Result<UpdateCheckResult, ManagerRpcError> {
    let current_version = app.package_info().version.to_string();
    *state.0.lock().map_err(|_| update_state_error())? = None;
    let Some(public_key) = UPDATER_PUBLIC_KEY.filter(|key| !key.trim().is_empty()) else {
        return Ok(UpdateCheckResult::Disabled {
            current_version,
            reason: "This build has no embedded update verification key.".to_string(),
        });
    };
    let endpoint = Url::parse(UPDATE_ENDPOINT).map_err(|_| update_check_error())?;
    let updater = app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .and_then(|builder| builder.timeout(UPDATE_TIMEOUT).build())
        .map_err(|_| update_check_error())?;
    let update = updater.check().await.map_err(|_| update_check_error())?;
    let mut pending = state.0.lock().map_err(|_| update_state_error())?;
    *pending = update;
    match pending.as_ref() {
        Some(update) => Ok(UpdateCheckResult::Available {
            current_version: update.current_version.clone(),
            latest_version: update.version.clone(),
            notes: update.body.clone(),
        }),
        None => Ok(UpdateCheckResult::Current { current_version }),
    }
}

#[tauri::command]
async fn install_update(
    app: AppHandle,
    state: State<'_, PendingUpdateState>,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<(), ManagerRpcError> {
    let update = state
        .0
        .lock()
        .map_err(|_| update_state_error())?
        .take()
        .ok_or_else(|| {
            update_error(
                "UPDATE_NOT_PENDING",
                "Check for updates again before installing.",
            )
        })?;
    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(UpdateDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(UpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|_| {
            update_error(
                "UPDATE_INSTALL_FAILED",
                "Reglet could not verify or install the update. Check again and retry.",
            )
        })?;
    app.restart();
}

fn update_check_error() -> ManagerRpcError {
    update_error(
        "UPDATE_CHECK_FAILED",
        "Reglet could not securely check for updates. Check your connection and retry.",
    )
}

fn update_state_error() -> ManagerRpcError {
    update_error(
        "UPDATE_STATE_FAILED",
        "Reglet could not access the pending update. Check again and retry.",
    )
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
        .manage(PendingUpdateState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<ManagerRuntimeState>();
                    let _ = stop_manager_runtime(&state).await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            manager_runtime_start,
            manager_runtime_stop,
            check_for_updates,
            install_update,
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
    fn update_status_serializes_as_a_strict_frontend_contract() {
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::Available {
                current_version: "1.0.0".to_string(),
                latest_version: "1.1.0".to_string(),
                notes: Some("Safer updates".to_string()),
            })
            .expect("serializable update status"),
            serde_json::json!({
                "status": "available",
                "currentVersion": "1.0.0",
                "latestVersion": "1.1.0",
                "notes": "Safer updates",
            }),
        );
        assert_eq!(
            serde_json::to_value(UpdateDownloadEvent::Started {
                content_length: Some(4096),
            })
            .expect("serializable update progress"),
            serde_json::json!({
                "event": "started",
                "contentLength": 4096,
            }),
        );
    }

    #[test]
    fn manager_runtime_startup_accepts_chunked_pretty_json() {
        let mut bytes = br#"{
  "version": 1,
  "listening": true,"#
            .to_vec();
        assert_eq!(parse_runtime_startup(&bytes), Ok(None));

        bytes.extend_from_slice(
            br#"
  "url": "http://127.0.0.1:43210",
  "managerUrl": "http://127.0.0.1:43210/manager/#pair=ABC123",
  "pairingExpiresAt": "2026-08-02T03:11:46.054Z",
  "remote": false,
  "protocolVersion": 2
}
"#,
        );

        let startup = parse_runtime_startup(&bytes)
            .expect("valid startup JSON")
            .expect("complete startup JSON");
        assert_eq!(startup.url, "http://127.0.0.1:43210");
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
