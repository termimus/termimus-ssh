//! Cross-platform local PTY manager (macOS, Linux, Windows ConPTY).
//!
//! Spawns local interactive shells (zsh/bash on POSIX, PowerShell/cmd on Windows)
//! and bridges I/O to Tauri IPC events with near-zero latency, adaptive chunk coalescing,
//! and automatic child process reaping.
//! On mobile platforms (Android/iOS), provides an ergonomic stub as local shell spawning
//! is restricted by sandbox policies.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, Child};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::collections::HashMap;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::io::{Read, Write};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Emitter;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tokio::sync::RwLock;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub struct LocalPtySession {
    pub id: String,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, Arc<LocalPtySession>>>>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct LocalPtySession {
    pub id: String,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Clone)]
pub struct PtyManager {}

#[cfg(any(target_os = "android", target_os = "ios"))]
impl PtyManager {
    pub fn new() -> Self {
        PtyManager {}
    }

    pub fn detect_default_shell() -> String {
        "/bin/sh".to_string()
    }

    pub async fn spawn(
        &self,
        _app: AppHandle,
        _session_id: String,
        _cols: u16,
        _rows: u16,
        _shell_path: Option<String>,
    ) -> Result<String, String> {
        Err("Local terminal is not supported on mobile devices. Please connect to a remote SSH server.".to_string())
    }

    pub async fn write(&self, _session_id: &str, _data: &[u8]) -> Result<(), String> {
        Err("Local terminal is not supported on mobile devices".to_string())
    }

    pub async fn resize(&self, _session_id: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        Ok(())
    }

    pub async fn kill(&self, _session_id: &str) -> Result<(), String> {
        Ok(())
    }

    pub async fn kill_all(&self) {}
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Detect the default interactive shell for the host operating system.
    pub fn detect_default_shell() -> String {
        #[cfg(target_os = "windows")]
        {
            // On Windows, preferred order:
            // 1. PowerShell 7+ (pwsh.exe)
            // 2. Windows PowerShell (powershell.exe)
            // 3. Command Prompt (cmd.exe)
            if which_executable("pwsh.exe") {
                "pwsh.exe".to_string()
            } else if which_executable("powershell.exe") {
                "powershell.exe".to_string()
            } else {
                std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Ok(shell) = std::env::var("SHELL") {
                let trimmed = shell.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
            if std::path::Path::new("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else if std::path::Path::new("/bin/bash").exists() {
                "/bin/bash".to_string()
            } else {
                "/bin/sh".to_string()
            }
        }
    }

    /// Spawn a new local PTY process and stream its output to frontend via `pty-data-{session_id}`.
    pub async fn spawn(
        &self,
        app: AppHandle,
        session_id: String,
        cols: u16,
        rows: u16,
        shell_path: Option<String>,
    ) -> Result<String, String> {
        let cols = cols.max(10);
        let rows = rows.max(3);

        let shell = match shell_path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(requested) => {
                if !is_allowed_shell(&requested) {
                    return Err(format!("Shell is not an allowed login shell: {requested}"));
                }
                requested
            }
            None => Self::detect_default_shell(),
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let mut cmd = CommandBuilder::new(&shell);

        // Spawn shell in user's home directory if available
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        // Standard terminal environment variables
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Termimus");
        if std::env::var_os("LANG").is_none() {
            cmd.env("LANG", "en_US.UTF-8");
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell '{shell}': {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to open PTY writer: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

        let session = Arc::new(LocalPtySession {
            id: session_id.clone(),
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        });

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session.clone());
        }

        let event_name = format!("pty-data-{session_id}");
        let closed_event = format!("pty-closed-{session_id}");
        let app_clone = app.clone();

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        // Dedicated background reader thread to read stdout/stderr from master PTY
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if tx.blocking_send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        let sessions_for_exit = self.sessions.clone();
        let sid_for_exit = session_id.clone();
        let child_for_exit = session.child.clone();

        // Adaptive output coalescing (identical to SSH PTY streaming):
        // 1. Idle stream: emit interactive keystroke echo immediately (0ms delay)
        // 2. High-output bursts (cat, build logs): accumulate in pending & emit in ~8ms batches / 64KB cap
        tokio::spawn(async move {
            let mut pending: Vec<u8> = Vec::new();
            let flush_delay = tokio::time::Duration::from_millis(8);
            let mut flush_deadline: Option<tokio::time::Instant> = None;

            loop {
                let sleep = async {
                    match flush_deadline {
                        Some(deadline) => tokio::time::sleep_until(deadline).await,
                        None => std::future::pending::<()>().await,
                    }
                };

                tokio::select! {
                    chunk = rx.recv() => {
                        match chunk {
                            Some(data) => {
                                match flush_deadline {
                                    None => {
                                        // Idle stream: emit interactive echo immediately (0ms delay)
                                        let _ = app_clone.emit(&event_name, data);
                                        flush_deadline = Some(tokio::time::Instant::now() + flush_delay);
                                    }
                                    Some(_) => {
                                        pending.extend_from_slice(&data);
                                        if pending.len() >= 64 * 1024 {
                                            let _ = app_clone.emit(&event_name, std::mem::take(&mut pending));
                                            flush_deadline = None;
                                        }
                                    }
                                }
                            }
                            None => break, // Reader thread reached EOF (shell exited)
                        }
                    }
                    _ = sleep => {
                        // 8ms cooldown expired: flush accumulated burst
                        if !pending.is_empty() {
                            let _ = app_clone.emit(&event_name, std::mem::take(&mut pending));
                        }
                        flush_deadline = None;
                    }
                }
            }

            if !pending.is_empty() {
                let _ = app_clone.emit(&event_name, std::mem::take(&mut pending));
            }

            // Cleanup session from map and reap child process to prevent zombie processes
            {
                let mut map = sessions_for_exit.write().await;
                map.remove(&sid_for_exit);
            }
            if let Ok(mut child) = child_for_exit.lock() {
                let _ = child.try_wait();
            }

            let _ = app_clone.emit(&closed_event, ());
        });

        Ok(session_id)
    }

    /// Write user keyboard input to the running PTY process.
    pub async fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Local PTY session '{session_id}' not found"))?;

        let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data)
            .map_err(|e| format!("PTY write failed: {e}"))?;
        writer.flush().map_err(|e| format!("PTY flush failed: {e}"))?;
        Ok(())
    }

    /// Resize PTY dimensions when window or split pane dimensions change.
    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let cols = cols.max(10);
        let rows = rows.max(3);

        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Local PTY session '{session_id}' not found"))?;

        let master = session.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY resize failed: {e}"))?;
        Ok(())
    }

    /// Terminate a running PTY session and clean up.
    pub async fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(session_id) {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
                let _ = child.try_wait();
            }
        }
        Ok(())
    }

    /// Terminate all running PTY sessions (called on application shutdown).
    pub async fn kill_all(&self) {
        let mut sessions = self.sessions.write().await;
        for (_, session) in sessions.drain() {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
                let _ = child.try_wait();
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Drop for LocalPtySession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.try_wait();
        }
    }
}

#[cfg(target_os = "windows")]
fn which_executable(name: &str) -> bool {
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            let full = path.join(name);
            if full.is_file() {
                return true;
            }
        }
    }
    false
}

/// The webview can request a specific shell, so restrict it to real shells
/// instead of letting any script launch an arbitrary binary.
#[cfg(not(target_os = "windows"))]
fn is_allowed_shell(shell: &str) -> bool {
    if shell == PtyManager::detect_default_shell() {
        return true;
    }
    std::fs::read_to_string("/etc/shells")
        .map(|list| {
            list.lines()
                .map(str::trim)
                .any(|line| !line.starts_with('#') && line == shell)
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_allowed_shell(shell: &str) -> bool {
    let name = std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(name.as_str(), "pwsh.exe" | "powershell.exe" | "cmd.exe" | "bash.exe" | "wsl.exe")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allowed_shell() {
        assert!(is_allowed_shell(&PtyManager::detect_default_shell()));
        assert!(!is_allowed_shell("/tmp/not-a-shell"));
    }

    #[test]
    fn test_detect_default_shell() {
        let shell = PtyManager::detect_default_shell();
        assert!(!shell.trim().is_empty(), "Default shell must not be empty");
    }

    #[tokio::test]
    async fn test_pty_manager_lifecycle() {
        let manager = PtyManager::new();
        assert_eq!(manager.sessions.read().await.len(), 0);

        // Kill non-existent session should return Ok without panic
        assert!(manager.kill("non-existent").await.is_ok());
    }
}
