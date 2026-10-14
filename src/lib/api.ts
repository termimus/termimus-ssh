import { invoke } from "@tauri-apps/api/core";

export interface Host {
  id: string;
  folder_id?: string | null;
  label: string;
  address: string;
  port: number;
  username: string;
  auth_method: "password" | "private_key" | "agent";
  credential_id?: string | null;
  tags: string[];
  last_connected_at?: string | null;
  os_icon?: string | null;
  jump_host_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HostInput {
  folder_id?: string | null;
  label: string;
  address: string;
  port: number;
  username: string;
  auth_method: "password" | "private_key" | "agent";
  credential_id?: string | null;
  secret?: string;
  passphrase?: string;
  tags: string[];
  os_icon?: string | null;
  jump_host_id?: string | null;
}

export interface KeychainItem {
  id: string;
  kind: "private_key" | "public_key" | "password";
  name: string;
  key_type: string;
  public_key: string;
  fingerprint: string;
  username?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeychainKeyInput {
  name: string;
  key_type: string;
  private_key_pem: string;
  public_key: string;
  fingerprint: string;
  passphrase?: string;
  username?: string;
}

export interface KeychainIdentityInput {
  name: string;
  password: string;
  username?: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface VaultStatus {
  is_initialized: boolean;
  is_unlocked: boolean;
}

export interface ConnectedDevice {
  id: string;
  name: string;
  last_sync_at: string;
  created_at: string;
}

export interface SyncTestResult {
  ok: boolean;
  serverVersion?: string;
  revision?: number;
  error?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number | null;
  permissions?: number | null;
}

export interface PortForwardRule {
  id: string;
  host_id: string;
  label: string;
  forward_type: "local" | "remote" | "dynamic";
  local_address: string;
  local_port: number;
  remote_address: string;
  remote_port: number;
  created_at: string;
}

export interface PortForwardInput {
  host_id: string;
  label: string;
  forward_type: "local" | "remote" | "dynamic";
  local_address: string;
  local_port: number;
  remote_address: string;
  remote_port: number;
}

export interface Snippet {
  id: string;
  title: string;
  command: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SnippetInput {
  title: string;
  command: string;
  tags: string[];
}

export interface PingResult {
  host_id: string;
  latency_ms?: number | null;
  online: boolean;
}

export interface KnownHost {
  address: string;
  port: number;
  key_type: string;
  fingerprint: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface GeneratedKeyPair {
  private_key_pem: string;
  public_key_openssh: string;
}

export type PresetLayoutType =
  | "split-vertical"
  | "split-horizontal"
  | "grid-4"
  | "split-1-2"
  | "split-2-1"
  | "triple-column";

export interface PresetNode {
  paneIndex: number;
  hostId: string;
  label?: string;
}

export interface WorkspacePreset {
  id: string;
  name: string;
  description?: string;
  layout: PresetLayoutType;
  nodes: PresetNode[];
  broadcastOnLaunch?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePresetInput {
  name: string;
  description?: string;
  layout: PresetLayoutType;
  nodes: PresetNode[];
  broadcastOnLaunch?: boolean;
}

export interface ImportSummary {
  folders: number;
  credentials: number;
  hosts: number;
  port_forwards: number;
  snippets: number;
  known_hosts: number;
  known_hosts_conflicts: number;
  workspace_presets?: number;
  vault_meta_restored: boolean;
  safety_snapshot_path: string | null;
}

export const api = {
  // Vault
  getVaultStatus: () => invoke<VaultStatus>("vault_status"),
  setupVault: (password: string) => invoke<void>("vault_setup", { password }),
  unlockVault: (password: string) => invoke<boolean>("vault_unlock", { password }),
  lockVault: () => invoke<void>("vault_lock"),
  saveVaultKeyring: () => invoke<void>("vault_keyring_save"),
  unlockVaultKeyring: () => invoke<boolean>("vault_keyring_unlock"),
  clearVaultKeyring: () => invoke<void>("vault_keyring_clear"),
  hasVaultKeyringKey: () => invoke<boolean>("vault_keyring_has_key"),
  isVaultBiometricSupported: () => invoke<boolean>("vault_biometric_supported"),
  unlockVaultBiometric: () => invoke<boolean>("vault_biometric_unlock"),
  changeVaultPassword: (oldPassword: string, newPassword: string) =>
    invoke<void>("vault_change_password", { oldPassword, newPassword }),
  resetVault: () => invoke<void>("vault_reset"),

  // Hosts
  listHosts: () => invoke<Host[]>("host_list"),
  saveHost: (input: HostInput, hostId?: string) =>
    invoke<Host>("host_save", { input, hostId: hostId ?? null }),
  deleteHost: (id: string) => invoke<void>("host_delete", { id }),
  getHostPassword: (hostId: string) =>
    invoke<string>("host_get_password", { hostId }),

  // Folders
  listFolders: () => invoke<Folder[]>("folder_list"),
  saveFolder: (name: string, parentId?: string, id?: string) =>
    invoke<Folder>("folder_save", { name, parentId: parentId ?? null, id: id ?? null }),
  deleteFolder: (id: string) => invoke<void>("folder_delete", { id }),

  // SSH Sessions
  connectSsh: (
    hostId: string,
    sessionId: string,
    cols: number,
    rows: number,
  ) => invoke<void>("ssh_connect", { hostId, sessionId, cols, rows }),
  writeSsh: (sessionId: string, data: number[]) =>
    invoke<void>("ssh_write", { sessionId, data }),
  resizeSsh: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("ssh_resize", { sessionId, cols, rows }),
  disconnectSsh: (sessionId: string) =>
    invoke<void>("ssh_disconnect", { sessionId }),

  // Local PTY Sessions
  getDefaultLocalShell: () => invoke<string>("local_pty_default_shell"),
  spawnLocalPty: (
    sessionId: string,
    cols: number,
    rows: number,
    shell?: string
  ) =>
    invoke<string>("local_pty_spawn", {
      sessionId,
      cols,
      rows,
      shell: shell ?? null,
    }),
  writeLocalPty: (sessionId: string, data: number[]) =>
    invoke<void>("local_pty_write", { sessionId, data }),
  resizeLocalPty: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("local_pty_resize", { sessionId, cols, rows }),
  killLocalPty: (sessionId: string) =>
    invoke<void>("local_pty_kill", { sessionId }),

  // SSH Key Utilities
  generateKeyPair: (algorithm: string, comment: string = "") =>
    invoke<GeneratedKeyPair>("key_generate", { algorithm, comment }),
  derivePublicKey: (pem: string, passphrase?: string) =>
    invoke<string>("key_derive_public", { pem, passphrase: passphrase || null }),

  // Keychain (Termius-style saved keys & password identities)
  listKeychain: () => invoke<KeychainItem[]>("keychain_list"),
  saveKeychainKey: (input: KeychainKeyInput, itemId?: string) =>
    invoke<KeychainItem>("keychain_save_key", { input, itemId: itemId ?? null }),
  saveKeychainIdentity: (input: KeychainIdentityInput, itemId?: string) =>
    invoke<KeychainItem>("keychain_save_identity", { input, itemId: itemId ?? null }),
  deleteKeychainItem: (id: string) =>
    invoke<void>("keychain_delete", { id }),
  getKeychainPublicKey: (id: string) =>
    invoke<string>("keychain_get_public_key", { id }),
  getCredentialSecret: (id: string) =>
    invoke<string>("credential_get_secret", { id }),
  getKeychainPrivateKey: (id: string) =>
    invoke<{ private_key_pem: string; passphrase?: string | null }>(
      "keychain_get_private_key",
      { id }
    ),

  // SFTP Remote
  connectSftp: (hostId: string, sessionId: string) =>
    invoke<string>("sftp_connect", { hostId, sessionId }),
  listSftp: (sessionId: string, path: string) =>
    invoke<FileEntry[]>("sftp_list", { sessionId, path }),
  mkdirSftp: (sessionId: string, path: string) =>
    invoke<void>("sftp_mkdir", { sessionId, path }),
  deleteSftp: (sessionId: string, path: string, isDir: boolean) =>
    invoke<void>("sftp_delete", { sessionId, path, isDir }),
  renameSftp: (sessionId: string, oldPath: string, newPath: string) =>
    invoke<void>("sftp_rename", { sessionId, oldPath, newPath }),
  uploadSftp: (sessionId: string, localPath: string, remotePath: string) =>
    invoke<void>("sftp_upload", { sessionId, localPath, remotePath }),
  downloadSftp: (sessionId: string, remotePath: string, localPath: string) =>
    invoke<void>("sftp_download", { sessionId, remotePath, localPath }),
  sftpStatMany: (sessionId: string, paths: string[]) =>
    invoke<(FileEntry | null)[]>("sftp_stat_many", { sessionId, paths }),
  localStatMany: (paths: string[]) =>
    invoke<(FileEntry | null)[]>("local_stat_many", { paths }),
  disconnectSftp: (sessionId: string) =>
    invoke<void>("sftp_disconnect", { sessionId }),
  readSftpFile: (sessionId: string, path: string) =>
    invoke<string>("sftp_read_file", { sessionId, path }),
  writeSftpFile: (sessionId: string, path: string, content: string) =>
    invoke<void>("sftp_write_file", { sessionId, path, content }),

  // Local Filesystem
  getLocalHomeDir: () => invoke<string>("local_home_dir"),
  listLocal: (path?: string) => invoke<FileEntry[]>("local_list", { path: path ?? null }),
  mkdirLocal: (path: string) => invoke<void>("local_mkdir", { path }),
  deleteLocal: (path: string, isDir: boolean) =>
    invoke<void>("local_delete", { path, isDir }),
  readLocalFile: (path: string) =>
    invoke<string>("local_read_file", { path }),
  writeLocalFile: (path: string, content: string) =>
    invoke<void>("local_write_file", { path, content }),

  // Port Forwarding / Tunnels
  listTunnelRules: () => invoke<PortForwardRule[]>("tunnel_rule_list"),
  saveTunnelRule: (input: PortForwardInput, ruleId?: string) =>
    invoke<PortForwardRule>("tunnel_rule_save", { input, ruleId: ruleId ?? null }),
  deleteTunnelRule: (id: string) => invoke<void>("tunnel_rule_delete", { id }),
  startTunnel: (ruleId: string) => invoke<void>("tunnel_start", { ruleId }),
  stopTunnel: (ruleId: string) => invoke<void>("tunnel_stop", { ruleId }),
  listActiveTunnels: () => invoke<string[]>("tunnel_active_list"),

  // Snippets
  listSnippets: () => invoke<Snippet[]>("snippet_list"),
  saveSnippet: (input: SnippetInput, snippetId?: string) =>
    invoke<Snippet>("snippet_save", { input, snippetId: snippetId ?? null }),
  deleteSnippet: (id: string) => invoke<void>("snippet_delete", { id }),

  // Workspaces & Layout Presets
  listWorkspacePresets: () => invoke<WorkspacePreset[]>("workspace_preset_list"),
  saveWorkspacePreset: (input: WorkspacePresetInput, presetId?: string) =>
    invoke<WorkspacePreset>("workspace_preset_save", { input, presetId: presetId ?? null }),
  deleteWorkspacePreset: (id: string) => invoke<void>("workspace_preset_delete", { id }),

  // Ping / Latency
  pingHost: (address: string, port: number) =>
    invoke<number | null>("ping_host", { address, port }),
  pingHosts: () => invoke<PingResult[]>("ping_hosts"),

  // Known Hosts / MITM Verification
  listKnownHosts: () => invoke<KnownHost[]>("known_host_list"),
  deleteKnownHost: (address: string, port: number) =>
    invoke<void>("known_host_delete", { address, port }),

  // Backup & Restore
  exportBackup: (passphrase?: string) =>
    invoke<string>("backup_export", { passphrase: passphrase ?? null }),
  importBackup: (backupJson: string, replaceAll: boolean, passphrase?: string) =>
    invoke<ImportSummary>("backup_import", { backupJson, replaceAll, passphrase: passphrase ?? null }),

  // Sync Relay (Native Rust HTTP, avoids WebKitGTK mixed-content/CORS blocks)
  syncTestConnection: (serverUrl: string, authToken?: string) =>
    invoke<SyncTestResult>("sync_test_connection", {
      serverUrl,
      authToken: authToken?.trim() || null,
    }),
  syncPush: (
    serverUrl: string,
    syncPassword: string,
    deviceId: string,
    deviceName: string,
    authToken?: string
  ) =>
    invoke<number>("sync_push", {
      serverUrl,
      syncPassword,
      deviceId,
      deviceName,
      authToken: authToken?.trim() || null,
    }),
  syncPull: (serverUrl: string, syncPassword: string, authToken?: string) =>
    invoke<ImportSummary>("sync_pull", {
      serverUrl,
      syncPassword,
      authToken: authToken?.trim() || null,
    }),
  syncGetDevices: (serverUrl: string, authToken?: string) =>
    invoke<ConnectedDevice[]>("sync_get_devices", {
      serverUrl,
      authToken: authToken?.trim() || null,
    }),
};
