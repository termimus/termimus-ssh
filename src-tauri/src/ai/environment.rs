//! Detects the real environment behind a terminal session (OS, shell, user,
//! package manager…) so the AI Copilot generates commands for the actual
//! machine instead of guessing "bash on Linux".

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TerminalEnvironment {
    /// Human readable OS, e.g. "Ubuntu 24.04.1 LTS", "macOS 15.1", "Windows".
    pub os_name: Option<String>,
    /// os-release `ID`, e.g. "ubuntu", "alpine"; "macos" / "windows" otherwise.
    pub os_id: Option<String>,
    /// `uname -s`, e.g. "Linux", "Darwin", "FreeBSD".
    pub kernel: Option<String>,
    /// `uname -m`, e.g. "x86_64", "aarch64".
    pub arch: Option<String>,
    /// Login shell basename, e.g. "bash", "zsh", "fish".
    pub shell: Option<String>,
    pub user: Option<String>,
    pub is_root: bool,
    /// First package manager found on PATH, e.g. "apt-get", "dnf", "apk", "brew".
    pub package_manager: Option<String>,
    /// PID 1 command name, e.g. "systemd", "init", "launchd".
    pub init_system: Option<String>,
}

/// POSIX `sh` probe. Wrapped in `sh -c '…'` so it also works when the remote
/// login shell is fish/csh (exec commands are interpreted by the login shell).
/// Must not contain single quotes.
pub const PROBE_SCRIPT: &str = r#"sh -c 'echo "__TM_KERNEL=$(uname -s 2>/dev/null)"; echo "__TM_ARCH=$(uname -m 2>/dev/null)"; echo "__TM_SHELL=$SHELL"; echo "__TM_USER=$(id -un 2>/dev/null || whoami 2>/dev/null)"; echo "__TM_UID=$(id -u 2>/dev/null)"; echo "__TM_PM=$(for p in apt-get dnf yum pacman apk zypper emerge xbps-install nix-env pkg brew; do if command -v $p >/dev/null 2>&1; then echo $p; break; fi; done)"; echo "__TM_INIT=$(ps -p 1 -o comm= 2>/dev/null)"; echo "__TM_MACVER=$(sw_vers -productVersion 2>/dev/null)"; cat /etc/os-release 2>/dev/null'"#;

fn non_empty(v: &str) -> Option<String> {
    let t = v.trim().trim_matches('"').trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Parses the output of [`PROBE_SCRIPT`].
pub fn parse_probe_output(output: &str) -> TerminalEnvironment {
    let mut env = TerminalEnvironment::default();
    let mut pretty_name = None;
    let mut os_release_id = None;
    let mut mac_ver = None;
    let mut uid = None;

    for line in output.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        match key.trim() {
            "__TM_KERNEL" => env.kernel = non_empty(value),
            "__TM_ARCH" => env.arch = non_empty(value),
            "__TM_SHELL" => {
                env.shell = non_empty(value)
                    .map(|s| s.rsplit('/').next().unwrap_or(&s).to_string())
            }
            "__TM_USER" => env.user = non_empty(value),
            "__TM_UID" => uid = non_empty(value),
            "__TM_PM" => env.package_manager = non_empty(value),
            "__TM_INIT" => {
                env.init_system = non_empty(value)
                    .map(|s| s.rsplit('/').next().unwrap_or(&s).to_string())
            }
            "__TM_MACVER" => mac_ver = non_empty(value),
            "PRETTY_NAME" => pretty_name = non_empty(value),
            "ID" => os_release_id = non_empty(value).map(|s| s.to_lowercase()),
            _ => {}
        }
    }

    env.is_root = uid.as_deref() == Some("0") || env.user.as_deref() == Some("root");

    if env.kernel.as_deref() == Some("Darwin") {
        env.os_id = Some("macos".to_string());
        env.os_name = Some(match mac_ver {
            Some(v) => format!("macOS {v}"),
            None => "macOS".to_string(),
        });
    } else {
        env.os_id = os_release_id;
        env.os_name = pretty_name.or_else(|| env.kernel.clone());
    }

    env
}

/// Detects the environment of the local machine (for local PTY tabs).
pub async fn detect_local_environment() -> Result<TerminalEnvironment, String> {
    #[cfg(windows)]
    {
        let shell = std::env::var("COMSPEC")
            .ok()
            .and_then(|s| {
                s.rsplit(['\\', '/'])
                    .next()
                    .map(|b| b.trim_end_matches(".exe").to_string())
            });
        let user = std::env::var("USERNAME").ok();
        return Ok(TerminalEnvironment {
            os_name: Some("Windows".to_string()),
            os_id: Some("windows".to_string()),
            kernel: Some("Windows_NT".to_string()),
            arch: Some(std::env::consts::ARCH.to_string()),
            shell,
            user,
            is_root: false,
            package_manager: None,
            init_system: None,
        });
    }

    #[cfg(not(windows))]
    {
        let out = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::process::Command::new("sh")
                .arg("-c")
                // Strip the outer `sh -c '…'` wrapper: we already invoke sh directly.
                .arg(
                    PROBE_SCRIPT
                        .trim_start_matches("sh -c '")
                        .trim_end_matches('\''),
                )
                .output(),
        )
        .await
        .map_err(|_| "Local environment probe timed out".to_string())?
        .map_err(|e| format!("Failed to run local environment probe: {e}"))?;

        let mut env = parse_probe_output(&String::from_utf8_lossy(&out.stdout));
        // The local PTY spawns $SHELL, which the probe already reported; fall
        // back to the process env if the probe could not read it.
        if env.shell.is_none() {
            env.shell = std::env::var("SHELL")
                .ok()
                .map(|s| s.rsplit('/').next().unwrap_or(&s).to_string());
        }
        Ok(env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_linux_probe() {
        let out = "__TM_KERNEL=Linux\n__TM_ARCH=x86_64\n__TM_SHELL=/usr/bin/zsh\n__TM_USER=deploy\n__TM_UID=1000\n__TM_PM=apt-get\n__TM_INIT=systemd\n__TM_MACVER=\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nNAME=\"Ubuntu\"\nID=ubuntu\n";
        let env = parse_probe_output(out);
        assert_eq!(env.os_name.as_deref(), Some("Ubuntu 24.04.1 LTS"));
        assert_eq!(env.os_id.as_deref(), Some("ubuntu"));
        assert_eq!(env.shell.as_deref(), Some("zsh"));
        assert_eq!(env.user.as_deref(), Some("deploy"));
        assert_eq!(env.package_manager.as_deref(), Some("apt-get"));
        assert_eq!(env.init_system.as_deref(), Some("systemd"));
        assert!(!env.is_root);
    }

    #[test]
    fn parses_macos_and_root() {
        let out = "__TM_KERNEL=Darwin\n__TM_ARCH=arm64\n__TM_SHELL=/bin/zsh\n__TM_USER=root\n__TM_UID=0\n__TM_PM=brew\n__TM_INIT=/sbin/launchd\n__TM_MACVER=15.1\n";
        let env = parse_probe_output(out);
        assert_eq!(env.os_name.as_deref(), Some("macOS 15.1"));
        assert_eq!(env.os_id.as_deref(), Some("macos"));
        assert_eq!(env.init_system.as_deref(), Some("launchd"));
        assert!(env.is_root);
    }

    #[test]
    fn probe_script_has_no_inner_single_quotes() {
        let inner = PROBE_SCRIPT.trim_start_matches("sh -c '").trim_end_matches('\'');
        assert!(!inner.contains('\''));
    }
}
