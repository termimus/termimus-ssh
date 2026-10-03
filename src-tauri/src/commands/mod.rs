use crate::db::models::{Folder, Host, HostInput, Credential, KeychainItem, KeychainKeyInput, KeychainIdentityInput, PortForwardRule, PortForwardInput, Snippet, SnippetInput, KnownHost, BackupBundle, EncryptedBackupEnvelope, ImportSummary, WorkspacePreset, WorkspacePresetInput};
use crate::db::Database;
use crate::pty::PtyManager;
use crate::sftp::{self, FileEntry, SftpManager};
use crate::ssh::{SessionManager, SshAuth};
use crate::tunnel::TunnelManager;
use crate::vault::VaultManager;
use chrono::Utc;
use keyring::Entry as KeyringEntry;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};
use uuid::Uuid;

pub struct AppState {
    pub db: Arc<Database>,
    pub vault: Arc<VaultManager>,
    pub ssh: Arc<SessionManager>,
    pub sftp: Arc<SftpManager>,
    pub tunnel: Arc<TunnelManager>,
    pub pty: Arc<PtyManager>,
}

#[derive(Serialize)]
pub struct VaultStatus {
    pub is_initialized: bool,
    pub is_unlocked: bool,
}

#[tauri::command]
pub fn vault_status(state: State<AppState>) -> Result<VaultStatus, String> {
    let is_initialized = state
        .db
        .get_vault_meta("salt")
        .map_err(|e| e.to_string())?
        .is_some();
    let is_unlocked = state.vault.is_unlocked();
    Ok(VaultStatus {
        is_initialized,
        is_unlocked,
    })
}

#[tauri::command]
pub fn vault_setup(state: State<AppState>, password: String) -> Result<(), String> {
    if password.len() < 4 {
        return Err("Password must be at least 4 characters long".to_string());
    }
    let salt = VaultManager::generate_salt();
    let key = VaultManager::derive_key(&password, &salt)?;

    state
        .db
        .set_vault_meta("salt", &salt)
        .map_err(|e| e.to_string())?;

    state.vault.set_key(key);
    let (ciphertext, nonce) = state.vault.encrypt(VaultManager::verification_payload())?;
    state
        .db
        .set_vault_meta("verifier_ciphertext", &ciphertext)
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_vault_meta("verifier_nonce", &nonce)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn vault_unlock(state: State<AppState>, password: String) -> Result<bool, String> {
    let salt = state
        .db
        .get_vault_meta("salt")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Vault has not been initialized yet".to_string())?;

    let verifier_ct = state
        .db
        .get_vault_meta("verifier_ciphertext")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Corrupted vault state: verifier missing".to_string())?;

    let verifier_nonce = state
        .db
        .get_vault_meta("verifier_nonce")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Corrupted vault state: nonce missing".to_string())?;

    let key = VaultManager::derive_key(&password, &salt)?;
    state.vault.set_key(key);

    match state.vault.decrypt(&verifier_ct, &verifier_nonce) {
        Ok(decrypted) if decrypted == VaultManager::verification_payload() => Ok(true),
        _ => {
            state.vault.lock();
            Err("Incorrect master password".to_string())
        }
    }
}

#[tauri::command]
pub fn vault_lock(state: State<AppState>) -> Result<(), String> {
    state.vault.lock();
    Ok(())
}

// ── OS Keyring helpers ──────────────────────────────────────────────────────
// Service + username identifiers used for every keyring entry.
const KEYRING_SERVICE: &str = "termimus";
const KEYRING_USER: &str = "vault-derived-key";

/// Persist the current in-memory derived key into the OS keyring (KWallet /
/// macOS Keychain / Windows Credential Manager). The key is hex-encoded so it
/// survives any keyring backend that only stores UTF-8 strings.
/// The vault MUST be unlocked before calling this.
#[tauri::command]
pub fn vault_keyring_save(state: State<AppState>) -> Result<(), String> {
    if !state.vault.is_unlocked() {
        return Err("Vault is locked — unlock it first before enabling OS Keyring.".to_string());
    }
    let hex_key = state.vault.export_key_hex()?;
    let entry = KeyringEntry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring init failed: {e}"))?;
    entry
        .set_password(&hex_key)
        .map_err(|e| format!("Failed to save key to OS keyring: {e}"))?;
    Ok(())
}

/// Internal helper to unlock the vault from a stored OS Keyring entry.
pub(crate) fn unlock_from_keyring_internal(state: &AppState) -> Result<bool, String> {
    let entry = KeyringEntry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring init failed: {e}"))?;

    let hex_key = match entry.get_password() {
        Ok(k) => k,
        Err(keyring::Error::NoEntry) => return Ok(false),
        Err(e) => return Err(format!("Keyring read failed: {e}")),
    };

    // Decode hex → 32-byte key
    if hex_key.len() != 64 {
        return Err("Keyring entry is corrupted (unexpected length).".to_string());
    }
    let mut key_bytes = [0u8; 32];
    for (i, chunk) in hex_key.as_bytes().chunks(2).enumerate() {
        let byte_str = std::str::from_utf8(chunk).map_err(|_| "Invalid hex in keyring".to_string())?;
        key_bytes[i] = u8::from_str_radix(byte_str, 16)
            .map_err(|_| "Invalid hex in keyring".to_string())?;
    }

    // Verify the key is correct against the stored verifier before trusting it.
    state.vault.set_key(key_bytes);
    let verifier_ct = state
        .db
        .get_vault_meta("verifier_ciphertext")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Corrupted vault state: verifier missing".to_string())?;
    let verifier_nonce = state
        .db
        .get_vault_meta("verifier_nonce")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Corrupted vault state: nonce missing".to_string())?;

    match state.vault.decrypt(&verifier_ct, &verifier_nonce) {
        Ok(decrypted) if decrypted == VaultManager::verification_payload() => Ok(true),
        _ => {
            // Key is stale (e.g. master password was changed elsewhere) — clear it.
            state.vault.lock();
            let _ = entry.delete_credential();
            Ok(false)
        }
    }
}

/// Try to load the derived key from the OS keyring and unlock the vault
/// silently. Returns `true` if successful, `false` if the keyring has no
/// stored key (e.g. first run or keyring cleared). Hard errors (keyring
/// daemon unavailable) are surfaced as `Err`.
#[tauri::command]
pub fn vault_keyring_unlock(state: State<AppState>) -> Result<bool, String> {
    unlock_from_keyring_internal(&state)
}

/// Check if a vault key is currently stored in the OS keyring.
#[tauri::command]
pub fn vault_keyring_has_key() -> Result<bool, String> {
    let entry = KeyringEntry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring init failed: {e}"))?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Keyring read failed: {e}")),
    }
}

/// Check whether biometric hardware (e.g. Touch ID on macOS) is supported and enrolled.
#[tauri::command]
pub fn vault_biometric_supported() -> bool {
    crate::biometric::is_supported()
}

/// Authenticate with biometric hardware (Touch ID) and unlock the vault
/// using the key persisted in the OS keyring.
#[tauri::command]
pub async fn vault_biometric_unlock(state: State<'_, AppState>) -> Result<bool, String> {
    if !crate::biometric::is_supported() {
        return Err("Biometric authentication is not supported or enrolled on this device.".to_string());
    }

    let has_key = vault_keyring_has_key().unwrap_or(false);
    if !has_key {
        return Err("No saved vault key found in OS Keyring. Please unlock with master password first to enable biometric unlock.".to_string());
    }

    let authenticated = tokio::task::spawn_blocking(|| {
        crate::biometric::authenticate("Unlock Termimus Vault")
    })
    .await
    .map_err(|e| format!("Biometric auth task error: {e}"))??;

    if !authenticated {
        return Ok(false);
    }

    unlock_from_keyring_internal(&state)
}

/// Remove the stored key from the OS keyring (when user disables the feature
/// or changes master password).
#[tauri::command]
pub fn vault_keyring_clear() -> Result<(), String> {
    let entry = KeyringEntry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring init failed: {e}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to clear keyring entry: {e}")),
    }
}

/// Change the master password: verifies the old password, re-derives a new
/// key, re-encrypts every credential, updates the verifier, and clears any
/// stale keyring entry so the user must re-enable OS Keyring with the new key.
#[tauri::command]
pub fn vault_change_password(
    state: State<AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.len() < 4 {
        return Err("New password must be at least 4 characters.".to_string());
    }

    // 1. Verify old password against stored verifier.
    let salt = state
        .db
        .get_vault_meta("salt")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Vault not initialized".to_string())?;
    let old_key = VaultManager::derive_key(&old_password, &salt)?;

    let verifier_ct = state
        .db
        .get_vault_meta("verifier_ciphertext")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Corrupted vault state".to_string())?;
    let verifier_nonce = state
        .db
        .get_vault_meta("verifier_nonce")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Corrupted vault state".to_string())?;

    match VaultManager::decrypt_with_key(&old_key, &verifier_ct, &verifier_nonce) {
        Ok(decrypted) if decrypted == VaultManager::verification_payload() => {}
        _ => {
            return Err("Current password is incorrect.".to_string());
        }
    }

    // 2. Derive new key with a fresh salt.
    let new_salt = VaultManager::generate_salt();
    let new_key = VaultManager::derive_key(&new_password, &new_salt)?;

    // 3. Re-encrypt every decryptable credential with the new key.
    let credentials = state.db.list_credentials().map_err(|e| e.to_string())?;
    let mut updated_credentials = Vec::new();

    for mut cred in credentials {
        // Try decrypting credential with old_key. If an orphaned/incompatible entry exists
        // (e.g. from an earlier interrupted re-encryption), safely skip it rather than bricking
        // the user from ever changing their master password.
        match VaultManager::decrypt_with_key(&old_key, &cred.ciphertext, &cred.nonce) {
            Ok(plaintext) => {
                let (new_ct, new_nonce) = VaultManager::encrypt_with_key(&new_key, &plaintext)?;
                cred.ciphertext = new_ct;
                cred.nonce = new_nonce;

                // Re-encrypt passphrase if present.
                if let (Some(pp_ct), Some(pp_nonce)) = (&cred.passphrase_ciphertext, &cred.passphrase_nonce) {
                    if let Ok(pp_plain) = VaultManager::decrypt_with_key(&old_key, pp_ct, pp_nonce) {
                        let (new_pp_ct, new_pp_nonce) = VaultManager::encrypt_with_key(&new_key, &pp_plain)?;
                        cred.passphrase_ciphertext = Some(new_pp_ct);
                        cred.passphrase_nonce = Some(new_pp_nonce);
                    }
                }

                cred.updated_at = chrono::Utc::now().to_rfc3339();
                updated_credentials.push(cred);
            }
            Err(e) => {
                eprintln!("[Vault] Warning: skipping undecryptable credential during re-keying (id: {}): {}", cred.id, e);
            }
        }
    }

    // 4. Generate new verifier payload with new key.
    let (new_verifier_ct, new_verifier_nonce) =
        VaultManager::encrypt_with_key(&new_key, VaultManager::verification_payload())?;

    // 5. Atomically commit salt, verifiers, and re-encrypted credentials in one SQLite transaction.
    state
        .db
        .rekey_vault(
            &new_salt,
            &new_verifier_ct,
            &new_verifier_nonce,
            &updated_credentials,
        )
        .map_err(|e| e.to_string())?;

    // 6. Update in-memory vault key so ongoing operations remain unlocked.
    state.vault.set_key(new_key);

    // 7. Clear stale keyring entry so user must re-enable with new key.
    let _ = vault_keyring_clear();

    Ok(())
}

/// Hard-reset the vault: wipes all credentials and vault metadata so the user
/// can set a new master password. This is a destructive operation — all SSH
/// keys and passwords stored in the vault are permanently lost.
#[tauri::command]
pub fn vault_reset(state: State<AppState>) -> Result<(), String> {
    state.vault.lock();
    // Clear keyring entry.
    let _ = vault_keyring_clear();
    // Wipe all credential data and vault meta.
    state.db.reset_vault().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn host_list(state: State<AppState>) -> Result<Vec<Host>, String> {
    state.db.list_hosts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn host_save(state: State<AppState>, input: HostInput, host_id: Option<String>) -> Result<Host, String> {
    let now = Utc::now().to_rfc3339();
    let id = host_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = state.db.get_host(&id).map_err(|e| e.to_string())?;

    // A Keychain item was picked from the dropdown — link directly to it,
    // no new anonymous credential needed.
    let mut credential_id = input.credential_id;

    if credential_id.is_none() {
        if let Some(secret) = input.secret {
            if !secret.trim().is_empty() {
                if !state.vault.is_unlocked() {
                    return Err("Vault must be unlocked to save credentials".to_string());
                }
                let (ciphertext, nonce) = state.vault.encrypt(secret.as_bytes())?;
                let (passphrase_ciphertext, passphrase_nonce) = match input.passphrase {
                    Some(p) if !p.trim().is_empty() => {
                        let (ct, n) = state.vault.encrypt(p.as_bytes())?;
                        (Some(ct), Some(n))
                    }
                    _ => (None, None),
                };

                let cred_id = if let Some(existing_cred_id) = existing.as_ref().and_then(|h| h.credential_id.as_ref()) {
                    if let Ok(Some(existing_cred)) = state.db.get_credential(existing_cred_id) {
                        if existing_cred.name.is_empty() {
                            existing_cred_id.clone()
                        } else {
                            Uuid::new_v4().to_string()
                        }
                    } else {
                        Uuid::new_v4().to_string()
                    }
                } else {
                    Uuid::new_v4().to_string()
                };

                let cred = Credential {
                    id: cred_id,
                    kind: input.auth_method.clone(),
                    ciphertext,
                    nonce,
                    passphrase_ciphertext,
                    passphrase_nonce,
                    // Anonymous one-off credential, not shown in the Keychain list.
                    name: String::new(),
                    key_type: String::new(),
                    public_key: String::new(),
                    fingerprint: String::new(),
                    username: None,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                state.db.save_credential(&cred).map_err(|e| e.to_string())?;
                credential_id = Some(cred.id);
            }
        }
    }

    let created_at = existing.as_ref().map(|h| h.created_at.clone()).unwrap_or_else(|| now.clone());

    if credential_id.is_none() {
        if let Some(h) = &existing {
            credential_id = h.credential_id.clone();
        }
    }

    let last_connected_at = existing.as_ref().and_then(|h| h.last_connected_at.clone());
    let os_icon = if input.os_icon.is_some() {
        input.os_icon
    } else {
        existing.as_ref().and_then(|h| h.os_icon.clone())
    };
    let jump_host_id = input.jump_host_id;

    let host = Host {
        id,
        folder_id: input.folder_id,
        label: input.label,
        address: input.address,
        port: input.port,
        username: input.username,
        auth_method: input.auth_method,
        credential_id,
        tags: input.tags,
        last_connected_at,
        os_icon,
        jump_host_id,
        created_at,
        updated_at: now,
    };

    state.db.save_host(&host).map_err(|e| e.to_string())?;
    Ok(host)
}

#[tauri::command]
pub fn host_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_host(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn folder_list(state: State<AppState>) -> Result<Vec<Folder>, String> {
    state.db.list_folders().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn folder_save(
    state: State<AppState>,
    name: String,
    parent_id: Option<String>,
    id: Option<String>,
) -> Result<Folder, String> {
    let now = Utc::now().to_rfc3339();
    let (id, created_at) = if let Some(fid) = id {
        let existing = state.db.get_folder(&fid).map_err(|e| e.to_string())?;
        let cat = existing.map(|f| f.created_at).unwrap_or_else(|| now.clone());
        (fid, cat)
    } else {
        (Uuid::new_v4().to_string(), now.clone())
    };
    let folder = Folder {
        id,
        name,
        parent_id,
        created_at,
        updated_at: now,
    };
    state.db.save_folder(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

#[tauri::command]
pub fn folder_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_folder(&id).map_err(|e| e.to_string())
}

fn resolve_host_auth(state: &AppState, host: &Host) -> Result<SshAuth, String> {
    match host.auth_method.as_str() {
        "password" => {
            let secret = if let Some(cred_id) = &host.credential_id {
                let cred = state
                    .db
                    .get_credential(cred_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Credential record not found".to_string())?;
                let bytes = state.vault.decrypt(&cred.ciphertext, &cred.nonce)?;
                String::from_utf8(bytes).map_err(|e| format!("Invalid utf-8 password: {e}"))?
            } else {
                return Err("No password configured for this host".to_string());
            };
            Ok(SshAuth::Password(secret))
        }
        "private_key" => {
            let (pem, passphrase) = if let Some(cred_id) = &host.credential_id {
                let cred = state
                    .db
                    .get_credential(cred_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Credential record not found".to_string())?;

                if cred.kind == "public_key" {
                    return Err(format!(
                        "Keychain item '{}' is a Public Key only (starts with ssh-rsa/ssh-ed25519). SSH login requires your matching Private Key (which starts with '-----BEGIN ... PRIVATE KEY-----', e.g. from ~/.ssh/id_rsa or ~/.ssh/id_ed25519 without .pub).",
                        cred.name
                    ));
                }

                let pem_bytes = state.vault.decrypt(&cred.ciphertext, &cred.nonce)?;
                let pem_str = String::from_utf8(pem_bytes).map_err(|e| format!("Invalid utf-8 PEM: {e}"))?;

                if crate::sshkey::is_public_key_text(&pem_str) {
                    return Err("The configured key is an OpenSSH Public Key (starts with ssh-rsa/ssh-ed25519). SSH client login requires the Private Key (starts with '-----BEGIN ... PRIVATE KEY-----'), not the public key.".to_string());
                }

                let pp = match (&cred.passphrase_ciphertext, &cred.passphrase_nonce) {
                    (Some(ct), Some(n)) => {
                        let bytes = state.vault.decrypt(ct, n)?;
                        Some(String::from_utf8(bytes).map_err(|e| format!("Invalid passphrase: {e}"))?)
                    }
                    _ => None,
                };
                (pem_str, pp)
            } else {
                return Err("No private key configured for this host".to_string());
            };
            Ok(SshAuth::PrivateKey { pem, passphrase })
        }
        _ => Err(format!("Unsupported auth method: {}", host.auth_method)),
    }
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let host = state
        .db
        .get_host(&host_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Host not found".to_string())?;

    let auth = resolve_host_auth(&state, &host)?;

    let jump_host = if let Some(ref jid) = host.jump_host_id {
        let jump = state
            .db
            .get_host(jid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Jump Host / Bastion server not found".to_string())?;
        let jump_auth = resolve_host_auth(&state, &jump)?;
        Some(crate::ssh::JumpHostConfig {
            address: jump.address,
            port: jump.port,
            username: jump.username,
            auth: jump_auth,
        })
    } else {
        None
    };

    let result = state
        .ssh
        .connect(
            app,
            state.db.clone(),
            session_id,
            Some(host_id.clone()),
            host.address,
            host.port,
            host.username,
            auth,
            cols,
            rows,
            jump_host,
        )
        .await;

    if result.is_ok() {
        let _ = state.db.touch_host_last_connected(&host_id);
    }

    result
}

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.ssh.write(&session_id, data).await
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.ssh.resize(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.ssh.disconnect(&session_id).await
}

// ================= LOCAL PTY COMMANDS =================

#[tauri::command]
pub fn local_pty_default_shell() -> String {
    PtyManager::detect_default_shell()
}

#[tauri::command]
pub async fn local_pty_spawn(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<String, String> {
    state.pty.spawn(app, session_id, cols, rows, shell).await
}

#[tauri::command]
pub async fn local_pty_write(
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.pty.write(&session_id, &data).await
}

#[tauri::command]
pub async fn local_pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn local_pty_kill(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.pty.kill(&session_id).await
}

// ================= SSH KEY COMMANDS =================

#[derive(Debug, Clone, Serialize)]
pub struct GeneratedKeyPairDto {
    pub private_key_pem: String,
    pub public_key_openssh: String,
}

/// Generates a brand new SSH key pair (Ed25519, RSA or ECDSA) for use as a
/// host's private key. Returns both halves so the UI can show the public
/// key immediately for copying onto the remote server; the private key is
/// only persisted (encrypted) once the user saves the host.
#[tauri::command]
pub fn key_generate(algorithm: String, comment: String) -> Result<GeneratedKeyPairDto, String> {
    let pair = crate::sshkey::generate_keypair(&algorithm, &comment)?;
    Ok(GeneratedKeyPairDto {
        private_key_pem: pair.private_key_pem,
        public_key_openssh: pair.public_key_openssh,
    })
}

/// Derives the OpenSSH public key line from a private key PEM the user
/// pasted or imported, so it can be copied onto the remote server's
/// `~/.ssh/authorized_keys` without ever needing the public key stored
/// separately.
#[tauri::command]
pub fn key_derive_public(pem: String, passphrase: Option<String>) -> Result<String, String> {
    crate::sshkey::derive_public_key(&pem, passphrase.as_deref())
}

// ================= KEYCHAIN COMMANDS =================
//
// The Keychain is a Termius-style library of reusable, named credentials
// (SSH keys and password identities). A host's `credential_id` links to
// one of these instead of every host owning its own copy — pick once,
// reuse across every server.

#[tauri::command]
pub fn keychain_list(state: State<AppState>) -> Result<Vec<KeychainItem>, String> {
    state
        .db
        .list_keychain_items()
        .map_err(|e| e.to_string())
}

/// Saves (or updates, if `item_id` is given) a named SSH key in the Keychain.
/// The algorithm badge, OpenSSH public key and fingerprint are re-derived
/// server-side from the PEM so the UI never has to trust client-supplied values.
#[tauri::command]
pub fn keychain_save_key(
    state: State<AppState>,
    input: KeychainKeyInput,
    item_id: Option<String>,
) -> Result<KeychainItem, String> {
    if !state.vault.is_unlocked() {
        return Err("Vault must be unlocked to save Keychain items".to_string());
    }
    if input.name.trim().is_empty() {
        return Err("Key name is required".to_string());
    }

    let existing = if let Some(ref id) = item_id {
        state.db.get_credential(id).map_err(|e| e.to_string())?
    } else {
        None
    };

    let (kind, ciphertext, nonce, passphrase_ciphertext, passphrase_nonce, key_type, public_key, fingerprint) =
        if input.private_key_pem.trim().is_empty() {
            if let Some(ref c) = existing {
                (
                    c.kind.clone(),
                    c.ciphertext.clone(),
                    c.nonce.clone(),
                    c.passphrase_ciphertext.clone(),
                    c.passphrase_nonce.clone(),
                    c.key_type.clone(),
                    c.public_key.clone(),
                    c.fingerprint.clone(),
                )
            } else {
                return Err("Private key is required".to_string());
            }
        } else {
            let details = crate::sshkey::inspect_key(&input.private_key_pem, input.passphrase.as_deref())?;
            let kind = if details.is_public_key_only {
                "public_key".to_string()
            } else {
                "private_key".to_string()
            };

            let (ciphertext, nonce) = state.vault.encrypt(input.private_key_pem.as_bytes())?;
            let (passphrase_ciphertext, passphrase_nonce) = match &input.passphrase {
                Some(p) if !p.trim().is_empty() => {
                    let (ct, n) = state.vault.encrypt(p.as_bytes())?;
                    (Some(ct), Some(n))
                }
                _ => (None, None),
            };
            (
                kind,
                ciphertext,
                nonce,
                passphrase_ciphertext,
                passphrase_nonce,
                details.algorithm,
                details.public_key,
                details.fingerprint,
            )
        };

    let now = Utc::now().to_rfc3339();
    let id = item_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let created_at = existing.map(|c| c.created_at).unwrap_or_else(|| now.clone());

    let cred = Credential {
        id,
        kind,
        ciphertext,
        nonce,
        passphrase_ciphertext,
        passphrase_nonce,
        name: input.name.trim().to_string(),
        key_type,
        public_key,
        fingerprint,
        username: input.username.filter(|u| !u.trim().is_empty()),
        created_at,
        updated_at: now,
    };
    state.db.save_credential(&cred).map_err(|e| e.to_string())?;
    Ok(KeychainItem::from(&cred))
}

/// Saves (or updates, if `item_id` is given) a named password identity in the Keychain.
#[tauri::command]
pub fn keychain_save_identity(
    state: State<AppState>,
    input: KeychainIdentityInput,
    item_id: Option<String>,
) -> Result<KeychainItem, String> {
    if !state.vault.is_unlocked() {
        return Err("Vault must be unlocked to save Keychain items".to_string());
    }
    if input.name.trim().is_empty() {
        return Err("Identity name is required".to_string());
    }
    if input.password.is_empty() {
        return Err("Password is required".to_string());
    }

    let (ciphertext, nonce) = state.vault.encrypt(input.password.as_bytes())?;

    let now = Utc::now().to_rfc3339();
    let id = item_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = state.db.get_credential(&id).map_err(|e| e.to_string())?;
    let created_at = existing.map(|c| c.created_at).unwrap_or_else(|| now.clone());

    let cred = Credential {
        id,
        kind: "password".to_string(),
        ciphertext,
        nonce,
        passphrase_ciphertext: None,
        passphrase_nonce: None,
        name: input.name.trim().to_string(),
        key_type: String::new(),
        public_key: String::new(),
        fingerprint: String::new(),
        username: input.username.filter(|u| !u.trim().is_empty()),
        created_at,
        updated_at: now,
    };
    state.db.save_credential(&cred).map_err(|e| e.to_string())?;
    Ok(KeychainItem::from(&cred))
}

#[tauri::command]
pub fn keychain_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_credential(&id).map_err(|e| e.to_string())
}

/// Returns the OpenSSH public key for a stored Keychain SSH key, so it can
/// be copied without re-deriving it from ciphertext on every render.
#[tauri::command]
pub fn keychain_get_public_key(state: State<AppState>, id: String) -> Result<String, String> {
    let cred = state
        .db
        .get_credential(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Keychain item not found".to_string())?;
    if cred.public_key.is_empty() {
        return Err("This Keychain item has no public key".to_string());
    }
    Ok(cred.public_key)
}

#[derive(serde::Serialize)]
pub struct DecryptedKeyDetails {
    pub private_key_pem: String,
    pub passphrase: Option<String>,
}

/// Returns the decrypted private key and passphrase for a stored Keychain SSH key.
#[tauri::command]
pub fn keychain_get_private_key(state: State<AppState>, id: String) -> Result<DecryptedKeyDetails, String> {
    if !state.vault.is_unlocked() {
        return Err("Vault must be unlocked to view key".to_string());
    }
    let cred = state
        .db
        .get_credential(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Keychain item not found".to_string())?;

    let bytes = state.vault.decrypt(&cred.ciphertext, &cred.nonce)?;
    let private_key_pem = String::from_utf8(bytes).map_err(|e| format!("Invalid utf-8 PEM: {e}"))?;

    let passphrase = match (&cred.passphrase_ciphertext, &cred.passphrase_nonce) {
        (Some(ct), Some(n)) => {
            let pb = state.vault.decrypt(ct, n)?;
            Some(String::from_utf8(pb).map_err(|e| format!("Invalid utf-8 passphrase: {e}"))?)
        }
        _ => None,
    };

    Ok(DecryptedKeyDetails {
        private_key_pem,
        passphrase,
    })
}

/// Returns the decrypted password for a host (used to populate the host edit form).
#[tauri::command]
pub fn host_get_password(state: State<AppState>, host_id: String) -> Result<String, String> {
    if !state.vault.is_unlocked() {
        return Err("Vault must be unlocked to view password".to_string());
    }
    let host = state
        .db
        .get_host(&host_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Host not found".to_string())?;

    if let Some(cred_id) = &host.credential_id {
        let cred = state
            .db
            .get_credential(cred_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Credential record not found".to_string())?;

        let bytes = state.vault.decrypt(&cred.ciphertext, &cred.nonce)?;
        String::from_utf8(bytes).map_err(|e| format!("Invalid utf-8 password: {e}"))
    } else {
        Ok(String::new())
    }
}

/// Returns the decrypted secret for a Keychain item (used to view saved password identity).
#[tauri::command]
pub fn credential_get_secret(state: State<AppState>, id: String) -> Result<String, String> {
    if !state.vault.is_unlocked() {
        return Err("Vault must be unlocked to view credentials".to_string());
    }
    let cred = state
        .db
        .get_credential(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Credential record not found".to_string())?;

    let bytes = state.vault.decrypt(&cred.ciphertext, &cred.nonce)?;
    String::from_utf8(bytes).map_err(|e| format!("Invalid utf-8 secret: {e}"))
}

// ================= SFTP COMMANDS =================

#[tauri::command]
pub async fn sftp_connect(
    state: State<'_, AppState>,
    host_id: String,
    session_id: String,
) -> Result<String, String> {
    let host = state
        .db
        .get_host(&host_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Host not found".to_string())?;

    let auth = resolve_host_auth(&state, &host)?;

    state
        .sftp
        .connect(
            state.db.clone(),
            session_id,
            host_id,
            host.address,
            host.port,
            host.username,
            auth,
        )
        .await
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    state.sftp.list(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    state.sftp.mkdir(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    state.sftp.delete(&session_id, &path, is_dir).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    state.sftp.rename(&session_id, &old_path, &new_path).await
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    state.sftp.upload_file(&session_id, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    state.sftp.download_file(&session_id, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn sftp_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.sftp.disconnect(&session_id).await
}

#[tauri::command]
pub async fn sftp_read_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    state.sftp.read_text_file(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_write_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    state.sftp.write_text_file(&session_id, &path, &content).await
}

// Local filesystem helpers.
// These can block on slow disks (network mounts, huge directories), so they
// run on the blocking pool instead of the main thread to keep the UI alive.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(result) => result,
        Err(e) => Err(format!("Background task failed: {e}")),
    }
}

#[tauri::command]
pub fn local_home_dir() -> String {
    sftp::get_user_home()
}

#[tauri::command]
pub async fn local_list(path: Option<String>) -> Result<Vec<FileEntry>, String> {
    let p = match path {
        Some(s) if !s.trim().is_empty() => Path::new(&s).to_path_buf(),
        _ => Path::new(&sftp::get_user_home()).to_path_buf(),
    };
    run_blocking(move || sftp::list_local_directory(&p)).await
}

#[tauri::command]
pub async fn local_read_file(path: String) -> Result<String, String> {
    run_blocking(move || sftp::read_local_text_file(Path::new(&path))).await
}

#[tauri::command]
pub async fn local_write_file(path: String, content: String) -> Result<(), String> {
    run_blocking(move || sftp::write_local_text_file(Path::new(&path), &content)).await
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    run_blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create local directory: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn local_delete(path: String, is_dir: bool) -> Result<(), String> {
    run_blocking(move || {
        if is_dir {
            std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete local folder: {e}"))
        } else {
            std::fs::remove_file(&path).map_err(|e| format!("Failed to delete local file: {e}"))
        }
    })
    .await
}

// ================= TUNNEL COMMANDS =================

#[tauri::command]
pub fn tunnel_rule_list(state: State<AppState>) -> Result<Vec<PortForwardRule>, String> {
    state.db.list_port_forwards().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tunnel_rule_save(
    state: State<AppState>,
    input: PortForwardInput,
    rule_id: Option<String>,
) -> Result<PortForwardRule, String> {
    let now = Utc::now().to_rfc3339();
    let id = rule_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let existing = state.db.get_port_forward(&id).map_err(|e| e.to_string())?;
    let created_at = existing.map(|r| r.created_at).unwrap_or(now);

    let rule = PortForwardRule {
        id,
        host_id: input.host_id,
        label: input.label,
        forward_type: input.forward_type,
        local_address: input.local_address,
        local_port: input.local_port,
        remote_address: input.remote_address,
        remote_port: input.remote_port,
        created_at,
    };

    state.db.save_port_forward(&rule).map_err(|e| e.to_string())?;
    Ok(rule)
}

#[tauri::command]
pub fn tunnel_rule_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_port_forward(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<(), String> {
    let rule = state
        .db
        .get_port_forward(&rule_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Port forwarding rule not found".to_string())?;

    let host = state
        .db
        .get_host(&rule.host_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Target host not found".to_string())?;

    let auth = resolve_host_auth(&state, &host)?;

    state
        .tunnel
        .start_local_forward(
            app,
            state.db.clone(),
            rule_id,
            host.address,
            host.port,
            host.username,
            auth,
            rule.local_address,
            rule.local_port,
            rule.remote_address,
            rule.remote_port,
        )
        .await
}

#[tauri::command]
pub async fn tunnel_stop(
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<(), String> {
    state.tunnel.stop(&rule_id).await
}

#[tauri::command]
pub async fn tunnel_active_list(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    Ok(state.tunnel.list_active().await)
}

// ================= SNIPPET COMMANDS =================

#[tauri::command]
pub fn snippet_list(state: State<AppState>) -> Result<Vec<Snippet>, String> {
    state.db.list_snippets().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snippet_save(
    state: State<AppState>,
    input: SnippetInput,
    snippet_id: Option<String>,
) -> Result<Snippet, String> {
    let now = Utc::now().to_rfc3339();
    let id = snippet_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let existing = state.db.list_snippets()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == id);
    let created_at = existing.map(|s| s.created_at).unwrap_or(now.clone());

    let snippet = Snippet {
        id,
        title: input.title,
        command: input.command,
        tags: input.tags,
        created_at,
        updated_at: now,
    };

    state.db.save_snippet(&snippet).map_err(|e| e.to_string())?;
    Ok(snippet)
}

#[tauri::command]
pub fn snippet_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_snippet(&id).map_err(|e| e.to_string())
}

// ================= WORKSPACE PRESET COMMANDS =================

#[tauri::command]
pub fn workspace_preset_list(state: State<AppState>) -> Result<Vec<WorkspacePreset>, String> {
    state.db.list_workspace_presets().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_preset_save(
    state: State<AppState>,
    input: WorkspacePresetInput,
    preset_id: Option<String>,
) -> Result<WorkspacePreset, String> {
    let now = Utc::now().to_rfc3339();
    let id = preset_id.unwrap_or_else(|| format!("preset-{}", Uuid::new_v4()));

    let existing = state.db.get_workspace_preset(&id).map_err(|e| e.to_string())?;
    let created_at = existing.map(|p| p.created_at).unwrap_or(now.clone());

    let preset = WorkspacePreset {
        id,
        name: input.name,
        description: input.description,
        layout: input.layout,
        nodes: input.nodes,
        broadcast_on_launch: input.broadcast_on_launch.unwrap_or(false),
        created_at,
        updated_at: now,
    };

    state.db.save_workspace_preset(&preset).map_err(|e| e.to_string())?;
    Ok(preset)
}

#[tauri::command]
pub fn workspace_preset_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_workspace_preset(&id).map_err(|e| e.to_string())
}

// ================= PING / LATENCY COMMANDS =================

#[derive(Serialize, Clone)]
pub struct PingResult {
    pub host_id: String,
    pub latency_ms: Option<u32>,
    pub online: bool,
}

async fn tcp_ping_one(address: String, port: u16) -> Option<u32> {
    let start = std::time::Instant::now();
    let addr = format!("{address}:{port}");
    let connect_fut = tokio::net::TcpStream::connect(&addr);

    match tokio::time::timeout(std::time::Duration::from_millis(2500), connect_fut).await {
        Ok(Ok(_stream)) => Some(start.elapsed().as_millis() as u32),
        _ => None,
    }
}

#[tauri::command]
pub async fn ping_host(address: String, port: u16) -> Result<Option<u32>, String> {
    Ok(tcp_ping_one(address, port).await)
}

#[tauri::command]
pub async fn ping_hosts(
    state: State<'_, AppState>,
) -> Result<Vec<PingResult>, String> {
    let hosts = state.db.list_hosts().map_err(|e| e.to_string())?;

    // Throttled concurrency pool: at most 8 simultaneous TCP connects
    // to prevent router congestion, socket exhaustion, or triggering firewall rate limits.
    let semaphore = Arc::new(tokio::sync::Semaphore::new(8));
    let mut handles = Vec::new();

    for host in hosts {
        let host_id = host.id.clone();
        let address = host.address.clone();
        let port = host.port;
        let sem = semaphore.clone();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            let latency_ms = tcp_ping_one(address, port).await;
            PingResult {
                host_id,
                online: latency_ms.is_some(),
                latency_ms,
            }
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }

    Ok(results)
}

// ================= KNOWN HOSTS / KEY FINGERPRINT COMMANDS =================

#[tauri::command]
pub fn known_host_list(state: State<AppState>) -> Result<Vec<KnownHost>, String> {
    state.db.list_known_hosts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn known_host_delete(
    state: State<AppState>,
    address: String,
    port: u16,
) -> Result<(), String> {
    state.db.delete_known_host(&address, port).map_err(|e| e.to_string())
}

// ================= BACKUP & RESTORE COMMANDS =================

/// Export a backup bundle. When `passphrase` is provided the entire bundle
/// (hosts, snippets, tunnels, folders, encrypted credentials) is wrapped in
/// an outer AES-256-GCM envelope so even the server addresses are at rest —
/// the returned string is then an `EncryptedBackupEnvelope` JSON rather than
/// a plain `BackupBundle`.
#[tauri::command]
pub fn backup_export(state: State<AppState>, passphrase: Option<String>) -> Result<String, String> {
    let bundle = state.db.export_backup_bundle("0.1.0").map_err(|e| e.to_string())?;
    let bundle_json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| format!("Failed to serialize backup bundle: {e}"))?;

    match passphrase {
        Some(ref pw) if !pw.trim().is_empty() => {
            let (ciphertext, salt, nonce) =
                VaultManager::encrypt_with_passphrase(bundle_json.as_bytes(), pw.trim())
                    .map_err(|e| format!("Backup encryption failed: {e}"))?;

            let envelope = EncryptedBackupEnvelope {
                format_version: 2,
                encrypted: true,
                app_version: bundle.app_version,
                exported_at: bundle.exported_at,
                kdf: "argon2id".to_string(),
                salt,
                nonce,
                ciphertext,
            };

            serde_json::to_string_pretty(&envelope)
                .map_err(|e| format!("Failed to serialize encrypted envelope: {e}"))
        }
        _ => Ok(bundle_json),
    }
}

#[tauri::command]
pub fn backup_import(
    state: State<AppState>,
    backup_json: String,
    replace_all: bool,
    passphrase: Option<String>,
) -> Result<ImportSummary, String> {
    // First, probe whether this is an encrypted envelope or a plain bundle.
    let probe: serde_json::Value = serde_json::from_str(&backup_json)
        .map_err(|e| format!("Invalid backup file: {e}"))?;

    let bundle: BackupBundle = if probe.get("encrypted").and_then(|v| v.as_bool()).unwrap_or(false) {
        // Format version 2: decrypt the outer envelope first.
        let envelope: EncryptedBackupEnvelope = serde_json::from_value(probe)
            .map_err(|e| format!("Invalid encrypted backup format: {e}"))?;

        if envelope.format_version != 2 {
            return Err(format!("Unsupported encrypted backup version: {}", envelope.format_version));
        }

        let pw = passphrase.as_deref().unwrap_or("").trim().to_string();
        if pw.is_empty() {
            return Err("This backup is encrypted. Please enter the backup passphrase to restore it.".to_string());
        }

        let plaintext = VaultManager::decrypt_with_passphrase(
            &envelope.ciphertext,
            &pw,
            &envelope.salt,
            &envelope.nonce,
        ).map_err(|e| e.to_string())?;

        serde_json::from_slice::<BackupBundle>(&plaintext)
            .map_err(|e| format!("Decrypted backup is malformed: {e}"))?
    } else {
        // Format version 1: plain JSON bundle.
        let b: BackupBundle = serde_json::from_value(probe)
            .map_err(|e| format!("Invalid backup file format: {e}"))?;
        if b.format_version != 1 {
            return Err(format!("Unsupported backup format version: {}", b.format_version));
        }
        b
    };

    let (mut summary, safety_snapshot_json) = state
        .db
        .import_backup_bundle(&bundle, replace_all)
        .map_err(|e| e.to_string())?;

    // If vault metadata was replaced, the in-memory key is now stale — lock the vault
    // so the user must re-authenticate with the restored master password.
    if summary.vault_meta_restored && replace_all {
        state.vault.lock();
    }

    // Write the safety snapshot to disk so the user can roll back if needed.
    if let Some(snapshot_json) = safety_snapshot_json {
        let mut snap_path = dirs::config_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("termimus");
        let _ = std::fs::create_dir_all(&snap_path);
        snap_path.push("auto-backup-pre-restore.json");
        let path_str = snap_path.to_string_lossy().to_string();
        if let Err(e) = std::fs::write(&snap_path, &snapshot_json) {
            eprintln!("Warning: could not write safety snapshot to {path_str}: {e}");
        } else {
            summary.safety_snapshot_path = Some(path_str);
        }
    }

    Ok(summary)
}

// ── Self-Hosted Sync Relay (native HTTP client, bypasses WebView CORS/mixed-content) ─────
//
// All sync network I/O runs through `reqwest` in the Rust backend instead of the
// webview's `fetch()`. WebKitGTK (Linux) blocks POST requests with a body from a
// secure `tauri://` origin to a plaintext `http://` server as "active mixed
// content" (surfacing as `TypeError: Load failed` in the frontend), even though
// GET requests are tolerated. Routing through Rust sidesteps browser-engine CORS
// and mixed-content rules entirely — the request is a plain OS-level socket.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTestResult {
    pub ok: bool,
    pub server_version: Option<String>,
    pub revision: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HealthResponse {
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SyncStatusResponse {
    latest_version: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectedDevice {
    pub id: String,
    pub name: String,
    pub last_sync_at: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct DevicesResponse {
    #[serde(default)]
    devices: Vec<ConnectedDevice>,
}

#[derive(Debug, Serialize)]
struct PushBundleRequest<'a> {
    device_id: &'a str,
    device_name: &'a str,
    encrypted_blob: String,
}

#[derive(Debug, Deserialize)]
struct PushBundleResponse {
    version: u64,
}

#[derive(Debug, Deserialize)]
struct GetBundleResponse {
    encrypted_blob: Option<String>,
}

fn sync_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))
}

fn apply_auth_header(
    builder: reqwest::RequestBuilder,
    auth_token: &Option<String>,
) -> reqwest::RequestBuilder {
    match auth_token {
        Some(t) if !t.trim().is_empty() => builder.bearer_auth(t.trim()),
        _ => builder,
    }
}

/// Mirrors the frontend's `testConnection()`: GET /health then GET /api/v1/sync/status.
#[tauri::command]
pub async fn sync_test_connection(
    server_url: String,
    auth_token: Option<String>,
) -> Result<SyncTestResult, String> {
    let base = server_url.trim_end_matches('/');
    let client = sync_http_client()?;

    let health_res = match client.get(format!("{base}/health")).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(SyncTestResult {
                ok: false,
                server_version: None,
                revision: None,
                error: Some(format!("Failed to reach server: {e}")),
            })
        }
    };

    if !health_res.status().is_success() {
        return Ok(SyncTestResult {
            ok: false,
            server_version: None,
            revision: None,
            error: Some(format!("Server returned HTTP {}", health_res.status())),
        });
    }

    let health: HealthResponse = health_res.json().await.unwrap_or(HealthResponse { version: None });

    let status_req = apply_auth_header(client.get(format!("{base}/api/v1/sync/status")), &auth_token);
    let status_res = match status_req.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(SyncTestResult {
                ok: false,
                server_version: health.version,
                revision: None,
                error: Some(format!("Failed to reach sync endpoint: {e}")),
            })
        }
    };

    let status_code = status_res.status();
    if !status_code.is_success() {
        let error = if status_code.as_u16() == 401 {
            "Authentication failed: invalid or missing Auth Token (configured via TERMIMUS_AUTH_TOKEN on server)".to_string()
        } else {
            format!("Sync endpoint returned HTTP {status_code}")
        };
        return Ok(SyncTestResult {
            ok: false,
            server_version: health.version,
            revision: None,
            error: Some(error),
        });
    }

    let status: SyncStatusResponse = status_res
        .json()
        .await
        .unwrap_or(SyncStatusResponse { latest_version: None });

    Ok(SyncTestResult {
        ok: true,
        server_version: health.version,
        revision: status.latest_version,
        error: None,
    })
}

/// Exports the local database as an encrypted E2EE envelope and POSTs it to the
/// relay. Returns the new server-side revision number.
#[tauri::command]
pub async fn sync_push(
    state: State<'_, AppState>,
    server_url: String,
    auth_token: Option<String>,
    sync_password: String,
    device_id: String,
    device_name: String,
) -> Result<u64, String> {
    let password = sync_password.trim();
    if password.is_empty() {
        return Err("Sync Passphrase is required. Termimus enforces zero-knowledge E2EE encryption before uploading to the relay.".to_string());
    }

    let encrypted_blob = backup_export(state, Some(password.to_string()))?;

    let base = server_url.trim_end_matches('/');
    let client = sync_http_client()?;

    let req = apply_auth_header(
        client.post(format!("{base}/api/v1/sync/bundle")).json(&PushBundleRequest {
            device_id: &device_id,
            device_name: &device_name,
            encrypted_blob,
        }),
        &auth_token,
    );

    let res = req
        .send()
        .await
        .map_err(|e| format!("Failed to reach sync server: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("Authentication failed: invalid or missing Auth Token (configured via TERMIMUS_AUTH_TOKEN on server)".to_string());
        }
        let err_body: ErrorResponse = res.json().await.unwrap_or(ErrorResponse { error: None });
        return Err(err_body.error.unwrap_or_else(|| format!("Server returned HTTP {status}")));
    }

    let body: PushBundleResponse = res
        .json()
        .await
        .map_err(|e| format!("Invalid response from server: {e}"))?;

    Ok(body.version)
}

/// Fetches the latest encrypted bundle from the relay, decrypts it, and merges
/// it into the local database (preserving locally-recorded TOFU known hosts).
#[tauri::command]
pub async fn sync_pull(
    state: State<'_, AppState>,
    server_url: String,
    auth_token: Option<String>,
    sync_password: String,
) -> Result<ImportSummary, String> {
    let base = server_url.trim_end_matches('/');
    let client = sync_http_client()?;

    let req = apply_auth_header(client.get(format!("{base}/api/v1/sync/bundle")), &auth_token);
    let res = req
        .send()
        .await
        .map_err(|e| format!("Failed to reach sync server: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("Authentication failed: invalid or missing Auth Token (configured via TERMIMUS_AUTH_TOKEN on server)".to_string());
        }
        let err_body: ErrorResponse = res.json().await.unwrap_or(ErrorResponse { error: None });
        return Err(err_body.error.unwrap_or_else(|| format!("Server returned HTTP {status}")));
    }

    let body: GetBundleResponse = res
        .json()
        .await
        .map_err(|e| format!("Invalid response from server: {e}"))?;

    let encrypted_blob = body
        .encrypted_blob
        .ok_or_else(|| "No sync data found on server".to_string())?;

    let password = sync_password.trim();
    if password.is_empty() {
        return Err("Sync Passphrase is required to decrypt the incoming sync bundle.".to_string());
    }

    backup_import(state, encrypted_blob, false, Some(password.to_string()))
}

/// Lists devices that have pushed revisions to the relay.
#[tauri::command]
pub async fn sync_get_devices(
    server_url: String,
    auth_token: Option<String>,
) -> Result<Vec<ConnectedDevice>, String> {
    let base = server_url.trim_end_matches('/');
    let client = sync_http_client()?;

    let req = apply_auth_header(client.get(format!("{base}/api/v1/sync/devices")), &auth_token);
    let res = match req.send().await {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    if !res.status().is_success() {
        return Ok(Vec::new());
    }

    let body: DevicesResponse = res.json().await.unwrap_or(DevicesResponse { devices: Vec::new() });
    Ok(body.devices)
}
