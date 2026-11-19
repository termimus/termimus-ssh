pub mod models;

use parking_lot::ReentrantMutex;
use rusqlite::{params, Connection, Result};
use std::fs;
use std::path::PathBuf;
use models::{Folder, Host, Credential, KeychainItem, PortForwardRule, Snippet, KnownHost, BackupBundle, ImportSummary, Tombstone, WorkspacePreset, PresetNode, AiProvider};

pub struct Database {
    /// Reentrant so a multi-step operation (e.g. `import_backup_bundle`) can
    /// hold the lock for its whole duration, wrap it in one SQLite transaction,
    /// and still call the regular per-row helpers, which re-lock on the same
    /// thread. Other threads block until the operation commits or rolls back,
    /// so their writes can never leak into (or be rolled back with) it.
    conn: ReentrantMutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = get_database_path();
        if let Some(parent) = db_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Database {
            conn: ReentrantMutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock();

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS vault_meta (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS credentials (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                ciphertext BLOB NOT NULL,
                nonce BLOB NOT NULL,
                passphrase_ciphertext BLOB,
                passphrase_nonce BLOB,
                name TEXT NOT NULL DEFAULT '',
                key_type TEXT NOT NULL DEFAULT '',
                public_key TEXT NOT NULL DEFAULT '',
                fingerprint TEXT NOT NULL DEFAULT '',
                username TEXT,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS hosts (
                id TEXT PRIMARY KEY,
                folder_id TEXT,
                label TEXT NOT NULL,
                address TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL,
                credential_id TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                last_connected_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL,
                FOREIGN KEY(credential_id) REFERENCES credentials(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS port_forwards (
                id TEXT PRIMARY KEY,
                host_id TEXT NOT NULL,
                label TEXT NOT NULL,
                forward_type TEXT NOT NULL DEFAULT 'local',
                local_address TEXT NOT NULL DEFAULT '127.0.0.1',
                local_port INTEGER NOT NULL,
                remote_address TEXT NOT NULL DEFAULT '127.0.0.1',
                remote_port INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                command TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_presets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                layout TEXT NOT NULL,
                nodes TEXT NOT NULL DEFAULT '[]',
                broadcast_on_launch BOOLEAN NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS known_hosts (
                address TEXT NOT NULL,
                port INTEGER NOT NULL,
                key_type TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (address, port)
            );

            CREATE TABLE IF NOT EXISTS tombstones (
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                PRIMARY KEY (entity_type, entity_id)
            );

            CREATE TABLE IF NOT EXISTS ai_providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL DEFAULT 'openai_compatible',
                base_url TEXT NOT NULL,
                model_name TEXT NOT NULL,
                credential_id TEXT,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(credential_id) REFERENCES credentials(id) ON DELETE SET NULL
            );
            ",
        )?;

        // Ensure columns added in Keychain update exist on existing databases
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN name TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN key_type TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN public_key TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN username TEXT", []);
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN created_at TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE hosts ADD COLUMN last_connected_at TEXT", []);
        // v0.4.8+: auto-detected OS icon per host
        let _ = conn.execute("ALTER TABLE hosts ADD COLUMN os_icon TEXT", []);
        // v0.5.0: bastion / jump host proxyjump
        let _ = conn.execute("ALTER TABLE hosts ADD COLUMN jump_host_id TEXT", []);
        // folders updated_at
        let _ = conn.execute("ALTER TABLE folders ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''", []);
        let _ = conn.execute("UPDATE folders SET updated_at = created_at WHERE updated_at = ''", []);

        Ok(())
    }

    pub fn record_tombstone(&self, entity_type: &str, entity_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![entity_type, entity_id, now],
        )?;
        Ok(())
    }

    pub fn save_tombstone(&self, tombstone: &Tombstone) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=MAX(deleted_at, excluded.deleted_at)",
            params![tombstone.entity_type, tombstone.entity_id, tombstone.deleted_at],
        )?;
        Ok(())
    }

    pub fn list_tombstones(&self) -> Result<Vec<Tombstone>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT entity_type, entity_id, deleted_at FROM tombstones")?;
        let rows = stmt.query_map([], |row| {
            Ok(Tombstone {
                entity_type: row.get(0)?,
                entity_id: row.get(1)?,
                deleted_at: row.get(2)?,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn is_tombstoned(&self, entity_type: &str, entity_id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT deleted_at FROM tombstones WHERE entity_type = ?1 AND entity_id = ?2")?;
        let mut rows = stmt.query(params![entity_type, entity_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn remove_tombstone(&self, entity_type: &str, entity_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM tombstones WHERE entity_type = ?1 AND entity_id = ?2", params![entity_type, entity_id])?;
        Ok(())
    }

    pub fn list_hosts(&self) -> Result<Vec<Host>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, folder_id, label, address, port, username, auth_method, credential_id, tags, last_connected_at, os_icon, jump_host_id, created_at, updated_at FROM hosts ORDER BY label ASC"
        )?;

        let hosts = stmt.query_map([], |row| {
            let tags_str: String = row.get(8)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(Host {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                label: row.get(2)?,
                address: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                auth_method: row.get(6)?,
                credential_id: row.get(7)?,
                tags,
                last_connected_at: row.get(9)?,
                os_icon: row.get(10)?,
                jump_host_id: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(hosts)
    }

    pub fn get_host(&self, id: &str) -> Result<Option<Host>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, folder_id, label, address, port, username, auth_method, credential_id, tags, last_connected_at, os_icon, jump_host_id, created_at, updated_at FROM hosts WHERE id = ?1"
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let tags_str: String = row.get(8)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(Some(Host {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                label: row.get(2)?,
                address: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                auth_method: row.get(6)?,
                credential_id: row.get(7)?,
                tags,
                last_connected_at: row.get(9)?,
                os_icon: row.get(10)?,
                jump_host_id: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_host(&self, host: &Host) -> Result<()> {
        let conn = self.conn.lock();
        let tags_str = serde_json::to_string(&host.tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO hosts (id, folder_id, label, address, port, username, auth_method, credential_id, tags, last_connected_at, os_icon, jump_host_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
                folder_id=excluded.folder_id,
                label=excluded.label,
                address=excluded.address,
                port=excluded.port,
                username=excluded.username,
                auth_method=excluded.auth_method,
                credential_id=excluded.credential_id,
                tags=excluded.tags,
                os_icon=COALESCE(excluded.os_icon, hosts.os_icon),
                jump_host_id=excluded.jump_host_id,
                updated_at=excluded.updated_at",
            params![
                host.id,
                host.folder_id,
                host.label,
                host.address,
                host.port,
                host.username,
                host.auth_method,
                host.credential_id,
                tags_str,
                host.last_connected_at,
                host.os_icon,
                host.jump_host_id,
                host.created_at,
                host.updated_at,
            ],
        )?;

        Ok(())
    }

    pub fn update_host_os_icon(&self, id: &str, os_icon: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE hosts SET os_icon = ?1, updated_at = ?2 WHERE id = ?3",
            params![os_icon, now, id],
        )?;
        Ok(())
    }

    pub fn delete_host(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        let _ = conn.execute("UPDATE hosts SET jump_host_id = NULL WHERE jump_host_id = ?1", params![id]);
        conn.execute("DELETE FROM hosts WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('host', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    pub fn touch_host_last_connected(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE hosts SET last_connected_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn save_credential(&self, cred: &Credential) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO credentials (id, kind, ciphertext, nonce, passphrase_ciphertext, passphrase_nonce, name, key_type, public_key, fingerprint, username, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                kind=excluded.kind,
                ciphertext=excluded.ciphertext,
                nonce=excluded.nonce,
                passphrase_ciphertext=excluded.passphrase_ciphertext,
                passphrase_nonce=excluded.passphrase_nonce,
                name=excluded.name,
                key_type=excluded.key_type,
                public_key=excluded.public_key,
                fingerprint=excluded.fingerprint,
                username=excluded.username,
                updated_at=excluded.updated_at",
            params![
                cred.id,
                cred.kind,
                cred.ciphertext,
                cred.nonce,
                cred.passphrase_ciphertext,
                cred.passphrase_nonce,
                cred.name,
                cred.key_type,
                cred.public_key,
                cred.fingerprint,
                cred.username,
                cred.created_at,
                cred.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Atomically commit a vault re-keying operation:
    /// Updates salt, verifier_ciphertext, verifier_nonce, and all re-encrypted credentials
    /// in a single SQLite transaction so the database is never left in a partial state.
    pub fn rekey_vault(
        &self,
        new_salt: &[u8],
        new_verifier_ct: &[u8],
        new_verifier_nonce: &[u8],
        updated_credentials: &[Credential],
    ) -> Result<()> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO vault_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params!["salt", new_salt],
        )?;
        tx.execute(
            "INSERT INTO vault_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params!["verifier_ciphertext", new_verifier_ct],
        )?;
        tx.execute(
            "INSERT INTO vault_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params!["verifier_nonce", new_verifier_nonce],
        )?;

        for cred in updated_credentials {
            tx.execute(
                "UPDATE credentials SET ciphertext = ?1, nonce = ?2, passphrase_ciphertext = ?3, passphrase_nonce = ?4, updated_at = ?5 WHERE id = ?6",
                params![
                    cred.ciphertext,
                    cred.nonce,
                    cred.passphrase_ciphertext,
                    cred.passphrase_nonce,
                    cred.updated_at,
                    cred.id,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_credential(&self, id: &str) -> Result<Option<Credential>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, kind, ciphertext, nonce, passphrase_ciphertext, passphrase_nonce, name, key_type, public_key, fingerprint, username, created_at, updated_at FROM credentials WHERE id = ?1"
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Credential {
                id: row.get(0)?,
                kind: row.get(1)?,
                ciphertext: row.get(2)?,
                nonce: row.get(3)?,
                passphrase_ciphertext: row.get(4)?,
                passphrase_nonce: row.get(5)?,
                name: row.get(6)?,
                key_type: row.get(7)?,
                public_key: row.get(8)?,
                fingerprint: row.get(9)?,
                username: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_credentials(&self) -> Result<Vec<Credential>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, kind, ciphertext, nonce, passphrase_ciphertext, passphrase_nonce, name, key_type, public_key, fingerprint, username, created_at, updated_at FROM credentials ORDER BY name ASC"
        )?;
        let list = stmt.query_map([], |row| {
            Ok(Credential {
                id: row.get(0)?,
                kind: row.get(1)?,
                ciphertext: row.get(2)?,
                nonce: row.get(3)?,
                passphrase_ciphertext: row.get(4)?,
                passphrase_nonce: row.get(5)?,
                name: row.get(6)?,
                key_type: row.get(7)?,
                public_key: row.get(8)?,
                fingerprint: row.get(9)?,
                username: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(list)
    }

    pub fn delete_credential(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('credential', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    /// Returns all named Keychain entries (omits old unlabelled anonymous credentials
    /// that were auto-created per host without names).
    pub fn list_keychain_items(&self) -> Result<Vec<KeychainItem>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, kind, name, key_type, public_key, fingerprint, username, created_at, updated_at
             FROM credentials
             WHERE name != ''
               AND kind IN ('private_key', 'public_key', 'password')
             ORDER BY name ASC",
        )?;
        let items = stmt
            .query_map([], |row| {
                Ok(KeychainItem {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    name: row.get(2)?,
                    key_type: row.get(3)?,
                    public_key: row.get(4)?,
                    fingerprint: row.get(5)?,
                    username: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(items)
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id, name, parent_id, created_at, updated_at FROM folders ORDER BY name ASC")?;
        let folders = stmt.query_map([], |row| {
            let created_at: String = row.get(3)?;
            let updated_at: String = row.get(4).unwrap_or_else(|_| created_at.clone());
            let updated_at = if updated_at.is_empty() { created_at.clone() } else { updated_at };
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at,
                updated_at,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(folders)
    }

    pub fn get_folder(&self, id: &str) -> Result<Option<Folder>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id, name, parent_id, created_at, updated_at FROM folders WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let created_at: String = row.get(3)?;
            let updated_at: String = row.get(4).unwrap_or_else(|_| created_at.clone());
            let updated_at = if updated_at.is_empty() { created_at.clone() } else { updated_at };
            Ok(Some(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at,
                updated_at,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_folder(&self, folder: &Folder) -> Result<()> {
        let conn = self.conn.lock();
        let updated_at = if folder.updated_at.is_empty() {
            chrono::Utc::now().to_rfc3339()
        } else {
            folder.updated_at.clone()
        };
        conn.execute(
            "INSERT INTO folders (id, name, parent_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                parent_id=excluded.parent_id,
                updated_at=excluded.updated_at",
            params![folder.id, folder.name, folder.parent_id, folder.created_at, updated_at],
        )?;
        Ok(())
    }

    pub fn delete_folder(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        let _ = conn.execute("UPDATE hosts SET folder_id = NULL WHERE folder_id = ?1", params![id]);
        let _ = conn.execute("UPDATE folders SET parent_id = NULL WHERE parent_id = ?1", params![id]);
        conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('folder', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    pub fn list_port_forwards(&self) -> Result<Vec<PortForwardRule>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, host_id, label, forward_type, local_address, local_port, remote_address, remote_port, created_at FROM port_forwards ORDER BY label ASC"
        )?;

        let rules = stmt.query_map([], |row| {
            Ok(PortForwardRule {
                id: row.get(0)?,
                host_id: row.get(1)?,
                label: row.get(2)?,
                forward_type: row.get(3)?,
                local_address: row.get(4)?,
                local_port: row.get(5)?,
                remote_address: row.get(6)?,
                remote_port: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(rules)
    }

    pub fn get_port_forward(&self, id: &str) -> Result<Option<PortForwardRule>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, host_id, label, forward_type, local_address, local_port, remote_address, remote_port, created_at FROM port_forwards WHERE id = ?1"
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(PortForwardRule {
                id: row.get(0)?,
                host_id: row.get(1)?,
                label: row.get(2)?,
                forward_type: row.get(3)?,
                local_address: row.get(4)?,
                local_port: row.get(5)?,
                remote_address: row.get(6)?,
                remote_port: row.get(7)?,
                created_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_port_forward(&self, rule: &PortForwardRule) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO port_forwards (id, host_id, label, forward_type, local_address, local_port, remote_address, remote_port, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                host_id=excluded.host_id,
                label=excluded.label,
                forward_type=excluded.forward_type,
                local_address=excluded.local_address,
                local_port=excluded.local_port,
                remote_address=excluded.remote_address,
                remote_port=excluded.remote_port",
            params![
                rule.id,
                rule.host_id,
                rule.label,
                rule.forward_type,
                rule.local_address,
                rule.local_port,
                rule.remote_address,
                rule.remote_port,
                rule.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_port_forward(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM port_forwards WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('port_forward', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    pub fn list_snippets(&self) -> Result<Vec<Snippet>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, command, tags, created_at, updated_at FROM snippets ORDER BY title ASC"
        )?;

        let snippets = stmt.query_map([], |row| {
            let tags_str: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(Snippet {
                id: row.get(0)?,
                title: row.get(1)?,
                command: row.get(2)?,
                tags,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(snippets)
    }

    pub fn save_snippet(&self, snippet: &Snippet) -> Result<()> {
        let conn = self.conn.lock();
        let tags_str = serde_json::to_string(&snippet.tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO snippets (id, title, command, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                command=excluded.command,
                tags=excluded.tags,
                updated_at=excluded.updated_at",
            params![
                snippet.id,
                snippet.title,
                snippet.command,
                tags_str,
                snippet.created_at,
                snippet.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_snippet(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('snippet', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    pub fn get_snippet(&self, id: &str) -> Result<Option<Snippet>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, command, tags, created_at, updated_at FROM snippets WHERE id = ?1"
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let tags_str: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(Some(Snippet {
                id: row.get(0)?,
                title: row.get(1)?,
                command: row.get(2)?,
                tags,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_workspace_presets(&self) -> Result<Vec<WorkspacePreset>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, layout, nodes, broadcast_on_launch, created_at, updated_at FROM workspace_presets ORDER BY name COLLATE NOCASE ASC"
        )?;

        let presets = stmt.query_map([], |row| {
            let nodes_str: String = row.get(4)?;
            let nodes: Vec<PresetNode> = serde_json::from_str(&nodes_str).unwrap_or_default();
            Ok(WorkspacePreset {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                layout: row.get(3)?,
                nodes,
                broadcast_on_launch: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(presets)
    }

    pub fn get_workspace_preset(&self, id: &str) -> Result<Option<WorkspacePreset>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, layout, nodes, broadcast_on_launch, created_at, updated_at FROM workspace_presets WHERE id = ?1"
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let nodes_str: String = row.get(4)?;
            let nodes: Vec<PresetNode> = serde_json::from_str(&nodes_str).unwrap_or_default();
            Ok(Some(WorkspacePreset {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                layout: row.get(3)?,
                nodes,
                broadcast_on_launch: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_workspace_preset(&self, preset: &WorkspacePreset) -> Result<()> {
        let conn = self.conn.lock();
        let nodes_str = serde_json::to_string(&preset.nodes).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO workspace_presets (id, name, description, layout, nodes, broadcast_on_launch, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                description=excluded.description,
                layout=excluded.layout,
                nodes=excluded.nodes,
                broadcast_on_launch=excluded.broadcast_on_launch,
                updated_at=excluded.updated_at",
            params![
                preset.id,
                preset.name,
                preset.description,
                preset.layout,
                nodes_str,
                preset.broadcast_on_launch,
                preset.created_at,
                preset.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_workspace_preset(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM workspace_presets WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('workspace_preset', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    pub fn list_ai_providers(&self) -> Result<Vec<AiProvider>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_type, base_url, model_name, credential_id, is_active, created_at, updated_at FROM ai_providers ORDER BY name ASC"
        )?;

        let providers = stmt.query_map([], |row| {
            let is_active_int: i32 = row.get(6)?;
            Ok(AiProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_type: row.get(2)?,
                base_url: row.get(3)?,
                model_name: row.get(4)?,
                credential_id: row.get(5)?,
                is_active: is_active_int != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(providers)
    }

    pub fn get_ai_provider(&self, id: &str) -> Result<Option<AiProvider>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_type, base_url, model_name, credential_id, is_active, created_at, updated_at FROM ai_providers WHERE id = ?1"
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let is_active_int: i32 = row.get(6)?;
            Ok(Some(AiProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_type: row.get(2)?,
                base_url: row.get(3)?,
                model_name: row.get(4)?,
                credential_id: row.get(5)?,
                is_active: is_active_int != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_active_ai_provider(&self) -> Result<Option<AiProvider>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_type, base_url, model_name, credential_id, is_active, created_at, updated_at FROM ai_providers WHERE is_active = 1 LIMIT 1"
        )?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let is_active_int: i32 = row.get(6)?;
            Ok(Some(AiProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_type: row.get(2)?,
                base_url: row.get(3)?,
                model_name: row.get(4)?,
                credential_id: row.get(5)?,
                is_active: is_active_int != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            // If none explicitly active, return first available
            let mut stmt2 = conn.prepare(
                "SELECT id, name, provider_type, base_url, model_name, credential_id, is_active, created_at, updated_at FROM ai_providers ORDER BY created_at ASC LIMIT 1"
            )?;
            let mut rows2 = stmt2.query([])?;
            if let Some(row) = rows2.next()? {
                let is_active_int: i32 = row.get(6)?;
                Ok(Some(AiProvider {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_type: row.get(2)?,
                    base_url: row.get(3)?,
                    model_name: row.get(4)?,
                    credential_id: row.get(5)?,
                    is_active: is_active_int != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                }))
            } else {
                Ok(None)
            }
        }
    }

    pub fn save_ai_provider(&self, provider: &AiProvider) -> Result<()> {
        let conn = self.conn.lock();
        let is_active_int = if provider.is_active { 1 } else { 0 };

        // If this provider is marked active, deactivate others
        if provider.is_active {
            let _ = conn.execute("UPDATE ai_providers SET is_active = 0 WHERE id != ?1", params![provider.id]);
        }

        conn.execute(
            "INSERT INTO ai_providers (id, name, provider_type, base_url, model_name, credential_id, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                provider_type=excluded.provider_type,
                base_url=excluded.base_url,
                model_name=excluded.model_name,
                credential_id=excluded.credential_id,
                is_active=excluded.is_active,
                updated_at=excluded.updated_at",
            params![
                provider.id,
                provider.name,
                provider.provider_type,
                provider.base_url,
                provider.model_name,
                provider.credential_id,
                is_active_int,
                provider.created_at,
                provider.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn set_active_ai_provider(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE ai_providers SET is_active = 0", [])?;
        conn.execute("UPDATE ai_providers SET is_active = 1 WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_ai_provider(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM ai_providers WHERE id = ?1", params![id])?;
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO tombstones (entity_type, entity_id, deleted_at) VALUES ('ai_provider', ?1, ?2)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at=excluded.deleted_at",
            params![id, now],
        );
        Ok(())
    }

    pub fn get_known_host(&self, address: &str, port: u16) -> Result<Option<KnownHost>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT address, port, key_type, fingerprint, first_seen_at, last_seen_at FROM known_hosts WHERE address = ?1 AND port = ?2"
        )?;
        let mut rows = stmt.query(params![address, port])?;
        if let Some(row) = rows.next()? {
            Ok(Some(KnownHost {
                address: row.get(0)?,
                port: row.get(1)?,
                key_type: row.get(2)?,
                fingerprint: row.get(3)?,
                first_seen_at: row.get(4)?,
                last_seen_at: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_known_host(&self, entry: &KnownHost) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO known_hosts (address, port, key_type, fingerprint, first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(address, port) DO UPDATE SET
                key_type=excluded.key_type,
                fingerprint=excluded.fingerprint,
                last_seen_at=excluded.last_seen_at",
            params![
                entry.address,
                entry.port,
                entry.key_type,
                entry.fingerprint,
                entry.first_seen_at,
                entry.last_seen_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_known_host(&self, address: &str, port: u16) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM known_hosts WHERE address = ?1 AND port = ?2",
            params![address, port],
        )?;
        Ok(())
    }

    pub fn list_known_hosts(&self) -> Result<Vec<KnownHost>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT address, port, key_type, fingerprint, first_seen_at, last_seen_at FROM known_hosts ORDER BY last_seen_at DESC"
        )?;
        let list = stmt.query_map([], |row| {
            Ok(KnownHost {
                address: row.get(0)?,
                port: row.get(1)?,
                key_type: row.get(2)?,
                fingerprint: row.get(3)?,
                first_seen_at: row.get(4)?,
                last_seen_at: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(list)
    }

    // Vault metadata: salt & verification token to confirm correct master password
    pub fn get_vault_meta(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM vault_meta WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_vault_meta(&self, key: &str, value: &[u8]) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO vault_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Hard-wipe all credentials and vault metadata (used for "Reset Vault").
    pub fn reset_vault(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute_batch(
            "DELETE FROM credentials;
             DELETE FROM vault_meta;
             UPDATE hosts SET credential_id = NULL;",
        )?;
        Ok(())
    }

    /// Build a full snapshot of every table for export. Credential fields stay
    /// as their AES-256-GCM ciphertext/nonce — nothing here is plaintext.
    pub fn export_backup_bundle(&self, app_version: &str) -> Result<BackupBundle> {
        let vault_salt = self.get_vault_meta("salt")?;
        let vault_verifier_ciphertext = self.get_vault_meta("verifier_ciphertext")?;
        let vault_verifier_nonce = self.get_vault_meta("verifier_nonce")?;

        Ok(BackupBundle {
            format_version: 1,
            app_version: app_version.to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            vault_salt,
            vault_verifier_ciphertext,
            vault_verifier_nonce,
            folders: self.list_folders()?,
            credentials: self.list_credentials()?,
            hosts: self.list_hosts()?,
            port_forwards: self.list_port_forwards()?,
            snippets: self.list_snippets()?,
            known_hosts: self.list_known_hosts()?,
            tombstones: self.list_tombstones()?,
            workspace_presets: self.list_workspace_presets()?,
            ai_providers: self.list_ai_providers()?,
        })
    }

    /// Restore a backup bundle. When `replace_all` is true, every table this
    /// bundle covers is wiped first so the import produces an exact copy;
    /// otherwise rows are merged/upserted by their existing primary keys.
    ///
    /// The whole import (wipe, vault metadata, every row) runs in a single
    /// SQLite transaction: if any step fails, the database is rolled back to
    /// exactly what it was before the call. Callers that want an on-disk
    /// safety snapshot for a successful-but-unwanted Replace All must write it
    /// *before* calling this (see `commands::backup_import`).
    pub fn import_backup_bundle(&self, bundle: &BackupBundle, replace_all: bool) -> Result<ImportSummary> {
        // Hold the (reentrant) lock for the whole import so no other thread's
        // writes interleave with the transaction; the helpers called below
        // re-lock on this same thread and share the same connection.
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        // Any `?` error drops `tx`, which rolls everything back.
        let summary = self.import_backup_bundle_inner(bundle, replace_all)?;
        tx.commit()?;
        Ok(summary)
    }

    fn import_backup_bundle_inner(&self, bundle: &BackupBundle, replace_all: bool) -> Result<ImportSummary> {
        {
            let conn = self.conn.lock();
            if replace_all {
                conn.execute_batch(
                    "DELETE FROM tombstones;
                     DELETE FROM known_hosts;
                     DELETE FROM snippets;
                     DELETE FROM workspace_presets;
                     DELETE FROM ai_providers;
                     DELETE FROM port_forwards;
                     DELETE FROM hosts;
                     DELETE FROM credentials;
                     DELETE FROM folders;",
                )?;
            }
        }

        let mut vault_meta_restored = false;
        if let (Some(salt), Some(ct), Some(nonce)) = (
            &bundle.vault_salt,
            &bundle.vault_verifier_ciphertext,
            &bundle.vault_verifier_nonce,
        ) {
            if replace_all {
                // replace_all: always restore vault metadata so credentials encrypted
                // with the backup's master password are actually usable after import.
                self.set_vault_meta("salt", salt)?;
                self.set_vault_meta("verifier_ciphertext", ct)?;
                self.set_vault_meta("verifier_nonce", nonce)?;
                vault_meta_restored = true;
            } else if self.get_vault_meta("salt")?.is_none() {
                // Merge into an uninitialized vault: safe to adopt the backup's meta.
                self.set_vault_meta("salt", salt)?;
                self.set_vault_meta("verifier_ciphertext", ct)?;
                self.set_vault_meta("verifier_nonce", nonce)?;
                vault_meta_restored = true;
            }
            // Merge into an already-initialized vault: keep existing vault_meta so
            // credentials already in the vault remain readable.
        }

        // Process incoming tombstones during merge or replace
        for ts in &bundle.tombstones {
            self.save_tombstone(ts)?;
            if !replace_all {
                match ts.entity_type.as_str() {
                    "host" => {
                        if let Ok(Some(local)) = self.get_host(&ts.entity_id) {
                            if local.updated_at <= ts.deleted_at {
                                let conn = self.conn.lock();
                                let _ = conn.execute("UPDATE hosts SET jump_host_id = NULL WHERE jump_host_id = ?1", params![&ts.entity_id]);
                                let _ = conn.execute("DELETE FROM hosts WHERE id = ?1", params![&ts.entity_id]);
                            }
                        }
                    }
                    "folder" => {
                        if let Ok(Some(local)) = self.get_folder(&ts.entity_id) {
                            let local_time = if !local.updated_at.is_empty() { &local.updated_at } else { &local.created_at };
                            if local_time <= &ts.deleted_at {
                                let conn = self.conn.lock();
                                let _ = conn.execute("UPDATE hosts SET folder_id = NULL WHERE folder_id = ?1", params![&ts.entity_id]);
                                let _ = conn.execute("UPDATE folders SET parent_id = NULL WHERE parent_id = ?1", params![&ts.entity_id]);
                                let _ = conn.execute("DELETE FROM folders WHERE id = ?1", params![&ts.entity_id]);
                            }
                        } else {
                            let conn = self.conn.lock();
                            let _ = conn.execute("UPDATE hosts SET folder_id = NULL WHERE folder_id = ?1", params![&ts.entity_id]);
                            let _ = conn.execute("UPDATE folders SET parent_id = NULL WHERE parent_id = ?1", params![&ts.entity_id]);
                        }
                    }
                    "credential" => {
                        let conn = self.conn.lock();
                        let _ = conn.execute("DELETE FROM credentials WHERE id = ?1", params![&ts.entity_id]);
                    }
                    "snippet" => {
                        if let Ok(Some(local)) = self.get_snippet(&ts.entity_id) {
                            if local.updated_at <= ts.deleted_at {
                                let conn = self.conn.lock();
                                let _ = conn.execute("DELETE FROM snippets WHERE id = ?1", params![&ts.entity_id]);
                            }
                        }
                    }
                    "workspace_preset" => {
                        if let Ok(Some(local)) = self.get_workspace_preset(&ts.entity_id) {
                            if local.updated_at <= ts.deleted_at {
                                let conn = self.conn.lock();
                                let _ = conn.execute("DELETE FROM workspace_presets WHERE id = ?1", params![&ts.entity_id]);
                            }
                        }
                    }
                    "ai_provider" => {
                        if let Ok(Some(local)) = self.get_ai_provider(&ts.entity_id) {
                            if local.updated_at <= ts.deleted_at {
                                let conn = self.conn.lock();
                                let _ = conn.execute("DELETE FROM ai_providers WHERE id = ?1", params![&ts.entity_id]);
                            }
                        }
                    }
                    "port_forward" => {
                        let conn = self.conn.lock();
                        let _ = conn.execute("DELETE FROM port_forwards WHERE id = ?1", params![&ts.entity_id]);
                    }
                    _ => {}
                }
            }
        }

        for folder in &bundle.folders {
            if !replace_all {
                let incoming_time = if !folder.updated_at.is_empty() { &folder.updated_at } else { &folder.created_at };
                if let Ok(Some(del_at)) = self.is_tombstoned("folder", &folder.id) {
                    if incoming_time <= &del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("folder", &folder.id);
                    }
                }
                if let Ok(Some(local)) = self.get_folder(&folder.id) {
                    let local_time = if !local.updated_at.is_empty() { &local.updated_at } else { &local.created_at };
                    if local_time > incoming_time {
                        continue;
                    }
                }
            }
            self.save_folder(folder)?;
        }
        for cred in &bundle.credentials {
            if !replace_all {
                let cred_time = if !cred.updated_at.is_empty() { &cred.updated_at } else { &cred.created_at };
                if let Ok(Some(del_at)) = self.is_tombstoned("credential", &cred.id) {
                    if cred_time <= &del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("credential", &cred.id);
                    }
                }
                if let Ok(Some(local)) = self.get_credential(&cred.id) {
                    let local_time = if !local.updated_at.is_empty() { &local.updated_at } else { &local.created_at };
                    if local_time > cred_time {
                        continue;
                    }
                }
            }
            self.save_credential(cred)?;
        }
        for host in &bundle.hosts {
            if !replace_all {
                if let Ok(Some(del_at)) = self.is_tombstoned("host", &host.id) {
                    if host.updated_at <= del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("host", &host.id);
                    }
                }
                if let Ok(Some(local)) = self.get_host(&host.id) {
                    if local.updated_at > host.updated_at {
                        continue;
                    }
                }
            }
            // A host may point at a folder or credential that is neither in
            // the bundle nor locally (hand-edited backup, skipped tombstoned
            // credential, ...). With foreign_keys=ON that would fail the
            // insert and abort the whole import, so drop the dangling link.
            let mut host = host.clone();
            if let Some(ref fid) = host.folder_id {
                if self.get_folder(fid)?.is_none() {
                    host.folder_id = None;
                }
            }
            if let Some(ref cid) = host.credential_id {
                if self.get_credential(cid)?.is_none() {
                    host.credential_id = None;
                }
            }
            self.save_host(&host)?;
        }
        for rule in &bundle.port_forwards {
            if !replace_all {
                if let Ok(Some(del_at)) = self.is_tombstoned("port_forward", &rule.id) {
                    if rule.created_at <= del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("port_forward", &rule.id);
                    }
                }
            }
            // A rule is meaningless without its host (and the FK would abort
            // the import), so skip rules whose host didn't make it in.
            if self.get_host(&rule.host_id)?.is_none() {
                continue;
            }
            self.save_port_forward(rule)?;
        }
        for snippet in &bundle.snippets {
            if !replace_all {
                if let Ok(Some(del_at)) = self.is_tombstoned("snippet", &snippet.id) {
                    if snippet.updated_at <= del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("snippet", &snippet.id);
                    }
                }
                if let Ok(Some(local)) = self.get_snippet(&snippet.id) {
                    if local.updated_at > snippet.updated_at {
                        continue;
                    }
                }
            }
            self.save_snippet(snippet)?;
        }

        let mut workspace_presets_imported: usize = 0;
        for preset in &bundle.workspace_presets {
            // Bundles come from files and the sync server, so they may carry a
            // layout this version can't render or launch: skip those presets
            // rather than store unusable rows.
            if !WorkspacePreset::is_known_layout(&preset.layout) {
                continue;
            }
            if !replace_all {
                if let Ok(Some(del_at)) = self.is_tombstoned("workspace_preset", &preset.id) {
                    if preset.updated_at <= del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("workspace_preset", &preset.id);
                    }
                }
                if let Ok(Some(local)) = self.get_workspace_preset(&preset.id) {
                    if local.updated_at > preset.updated_at {
                        continue;
                    }
                }
            }
            self.save_workspace_preset(preset)?;
            workspace_presets_imported += 1;
        }

        let mut ai_providers_imported: usize = 0;
        for provider in &bundle.ai_providers {
            if !replace_all {
                if let Ok(Some(del_at)) = self.is_tombstoned("ai_provider", &provider.id) {
                    if provider.updated_at <= del_at {
                        continue;
                    } else {
                        let _ = self.remove_tombstone("ai_provider", &provider.id);
                    }
                }
                if let Ok(Some(local)) = self.get_ai_provider(&provider.id) {
                    if local.updated_at > provider.updated_at {
                        continue;
                    }
                }
            }
            let mut provider = provider.clone();
            // The referenced API-key credential may have been skipped (tombstoned /
            // newer local copy missing) — with foreign_keys=ON a dangling id would
            // fail the insert and abort the whole import, so drop the link instead.
            if let Some(ref cid) = provider.credential_id {
                if !matches!(self.get_credential(cid), Ok(Some(_))) {
                    provider.credential_id = None;
                }
            }
            // During a merge, don't let an imported "active" flag steal activation
            // from the provider the user currently has selected locally.
            if !replace_all && provider.is_active {
                if let Ok(Some(local_active)) = self.get_active_ai_provider() {
                    if local_active.is_active && local_active.id != provider.id {
                        provider.is_active = false;
                    }
                }
            }
            if let Err(e) = self.save_ai_provider(&provider) {
                eprintln!("Skipping AI provider {} during import: {e}", provider.id);
                continue;
            }
            ai_providers_imported += 1;
        }

        // Post-import cleanup: ensure referential consistency if any parent entity was deleted
        {
            let conn = self.conn.lock();
            let _ = conn.execute(
                "UPDATE hosts SET folder_id = NULL WHERE folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM folders)",
                [],
            );
            let _ = conn.execute(
                "UPDATE hosts SET jump_host_id = NULL WHERE jump_host_id IS NOT NULL AND jump_host_id NOT IN (SELECT id FROM hosts)",
                [],
            );
            let _ = conn.execute(
                "UPDATE folders SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM folders)",
                [],
            );
        }

        // TOFU / MITM protection: during a merge, never overwrite an existing
        // trusted fingerprint with a different one from the backup — that would
        // silently defeat host-key verification for servers the user has already
        // connected to. Only import new entries or entries whose fingerprint
        // already matches what we trust.
        let mut known_hosts_imported: usize = 0;
        let mut known_hosts_conflicts: usize = 0;
        for kh in &bundle.known_hosts {
            if replace_all {
                // Table was wiped above; safe to insert verbatim.
                self.save_known_host(kh)?;
                known_hosts_imported += 1;
            } else {
                let existing = self.get_known_host(&kh.address, kh.port)?;
                match existing {
                    None => {
                        self.save_known_host(kh)?;
                        known_hosts_imported += 1;
                    }
                    Some(ref trusted) if trusted.fingerprint == kh.fingerprint => {
                        // Same fingerprint — just refresh last_seen_at.
                        self.save_known_host(kh)?;
                        known_hosts_imported += 1;
                    }
                    Some(_) => {
                        // Fingerprint mismatch: skip this entry to protect the user
                        // from a tampered backup poisoning their TOFU trust store.
                        known_hosts_conflicts += 1;
                    }
                }
            }
        }

        Ok(ImportSummary {
            folders: bundle.folders.len(),
            credentials: bundle.credentials.len(),
            hosts: bundle.hosts.len(),
            port_forwards: bundle.port_forwards.len(),
            snippets: bundle.snippets.len(),
            known_hosts: known_hosts_imported,
            known_hosts_conflicts,
            workspace_presets: workspace_presets_imported,
            ai_providers: ai_providers_imported,
            vault_meta_restored,
            safety_snapshot_path: None, // filled in by the command layer
        })
    }
}

fn get_database_path() -> PathBuf {
    let base_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("termimus");
    base_dir.join("termimus.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let db = Database { conn: ReentrantMutex::new(conn) };
        db.init_tables().unwrap();
        db
    }

    const T0: &str = "2026-01-01T00:00:00+00:00";
    const T1: &str = "2026-02-01T00:00:00+00:00";

    fn folder(id: &str) -> Folder {
        Folder { id: id.into(), name: id.into(), parent_id: None, created_at: T0.into(), updated_at: T0.into() }
    }

    fn credential(id: &str) -> Credential {
        Credential {
            id: id.into(),
            kind: "password".into(),
            ciphertext: vec![1, 2, 3],
            nonce: vec![4, 5, 6],
            passphrase_ciphertext: None,
            passphrase_nonce: None,
            name: id.into(),
            key_type: String::new(),
            public_key: String::new(),
            fingerprint: String::new(),
            username: None,
            created_at: T0.into(),
            updated_at: T0.into(),
        }
    }

    fn host(id: &str, folder_id: Option<&str>, credential_id: Option<&str>) -> Host {
        Host {
            id: id.into(),
            folder_id: folder_id.map(Into::into),
            label: id.into(),
            address: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth_method: "password".into(),
            credential_id: credential_id.map(Into::into),
            tags: vec![],
            last_connected_at: None,
            os_icon: None,
            jump_host_id: None,
            created_at: T0.into(),
            updated_at: T1.into(),
        }
    }

    fn port_forward(id: &str, host_id: &str) -> PortForwardRule {
        PortForwardRule {
            id: id.into(),
            host_id: host_id.into(),
            label: id.into(),
            forward_type: "local".into(),
            local_address: "127.0.0.1".into(),
            local_port: 8080,
            remote_address: "127.0.0.1".into(),
            remote_port: 80,
            created_at: T0.into(),
        }
    }

    fn snippet(id: &str) -> Snippet {
        Snippet { id: id.into(), title: id.into(), command: "ls".into(), tags: vec![], created_at: T0.into(), updated_at: T0.into() }
    }

    fn bundle() -> BackupBundle {
        BackupBundle {
            format_version: 1,
            app_version: "test".into(),
            exported_at: T0.into(),
            vault_salt: None,
            vault_verifier_ciphertext: None,
            vault_verifier_nonce: None,
            folders: vec![],
            credentials: vec![],
            hosts: vec![],
            port_forwards: vec![],
            snippets: vec![],
            known_hosts: vec![],
            tombstones: vec![],
            workspace_presets: vec![],
            ai_providers: vec![],
        }
    }

    /// DB with one folder, credential, host and vault salt "old-salt".
    fn seeded_db() -> Database {
        let db = test_db();
        db.save_folder(&folder("f-old")).unwrap();
        db.save_credential(&credential("c-old")).unwrap();
        db.save_host(&host("h-old", Some("f-old"), Some("c-old"))).unwrap();
        db.set_vault_meta("salt", b"old-salt").unwrap();
        db.set_vault_meta("verifier_ciphertext", b"old-ct").unwrap();
        db.set_vault_meta("verifier_nonce", b"old-nonce").unwrap();
        db
    }

    #[test]
    fn failed_replace_all_rolls_back_everything() {
        let db = seeded_db();
        // Make the import fail late: after the wipe, the vault-meta swap and
        // the host inserts have already happened inside the transaction.
        db.conn
            .lock()
            .execute_batch(
                "CREATE TEMP TRIGGER fail_snippet BEFORE INSERT ON snippets
                 BEGIN SELECT RAISE(ABORT, 'boom'); END;",
            )
            .unwrap();

        let mut b = bundle();
        b.vault_salt = Some(b"new-salt".to_vec());
        b.vault_verifier_ciphertext = Some(b"new-ct".to_vec());
        b.vault_verifier_nonce = Some(b"new-nonce".to_vec());
        b.hosts = vec![host("h-new", None, None)];
        b.snippets = vec![snippet("s-new")];

        assert!(db.import_backup_bundle(&b, true).is_err());

        let hosts = db.list_hosts().unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].id, "h-old");
        assert_eq!(db.list_folders().unwrap().len(), 1);
        assert_eq!(db.list_credentials().unwrap().len(), 1);
        assert_eq!(db.get_vault_meta("salt").unwrap().as_deref(), Some(&b"old-salt"[..]));
        assert_eq!(db.get_vault_meta("verifier_ciphertext").unwrap().as_deref(), Some(&b"old-ct"[..]));
    }

    #[test]
    fn replace_all_drops_dangling_references_instead_of_failing() {
        // The exact reproduction from issue #59: a host pointing at a
        // nonexistent folder must not abort the import.
        let db = seeded_db();
        let mut b = bundle();
        b.hosts = vec![host("h-new", Some("missing-folder"), Some("missing-cred"))];
        b.port_forwards = vec![port_forward("pf-ok", "h-new"), port_forward("pf-orphan", "missing-host")];

        db.import_backup_bundle(&b, true).unwrap();

        let hosts = db.list_hosts().unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].id, "h-new");
        assert_eq!(hosts[0].folder_id, None);
        assert_eq!(hosts[0].credential_id, None);
        let rules = db.list_port_forwards().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "pf-ok");
    }

    #[test]
    fn merge_with_tombstoned_credential_still_imports_host() {
        let db = test_db();
        let mut b = bundle();
        // The credential was deleted after its last update, so the merge
        // skips it — but a host in the same bundle still references it.
        b.tombstones = vec![Tombstone { entity_type: "credential".into(), entity_id: "c1".into(), deleted_at: T1.into() }];
        b.credentials = vec![credential("c1")];
        b.hosts = vec![host("h1", None, Some("c1"))];

        db.import_backup_bundle(&b, false).unwrap();

        assert!(db.get_credential("c1").unwrap().is_none());
        let h = db.get_host("h1").unwrap().unwrap();
        assert_eq!(h.credential_id, None);
    }

    #[test]
    fn successful_replace_all_commits() {
        let db = seeded_db();
        let mut b = bundle();
        b.folders = vec![folder("f-new")];
        b.credentials = vec![credential("c-new")];
        b.hosts = vec![host("h-new", Some("f-new"), Some("c-new"))];
        b.snippets = vec![snippet("s-new")];

        db.import_backup_bundle(&b, true).unwrap();

        let hosts = db.list_hosts().unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].folder_id.as_deref(), Some("f-new"));
        assert_eq!(hosts[0].credential_id.as_deref(), Some("c-new"));
        assert_eq!(db.list_snippets().unwrap().len(), 1);
    }
}
