//! SSH key pair generation and public key derivation helpers.
//!
//! These are pure, stateless helpers used by the host form: generating a
//! fresh key pair for a new host, or deriving the public key from a private
//! key the user pasted/imported so it can be copied onto the remote server's
//! `~/.ssh/authorized_keys`.

use russh::keys::decode_secret_key;
use russh::keys::ssh_key::{Algorithm, EcdsaCurve, LineEnding, PrivateKey, PublicKey};

/// Returns true if the provided text looks like an OpenSSH public key line.
pub fn is_public_key_text(text: &str) -> bool {
    let t = text.trim();
    t.starts_with("ssh-") || t.starts_with("ecdsa-") || t.starts_with("sk-")
}

/// Supported key generation algorithms, exposed to the frontend as simple strings.
pub fn parse_algorithm(algo: &str) -> Result<Algorithm, String> {
    match algo {
        "ed25519" => Ok(Algorithm::Ed25519),
        "rsa-3072" | "rsa-4096" | "rsa" => Ok(Algorithm::Rsa { hash: None }),
        "ecdsa-p256" => Ok(Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 }),
        "ecdsa-p384" => Ok(Algorithm::Ecdsa { curve: EcdsaCurve::NistP384 }),
        "ecdsa-p521" => Ok(Algorithm::Ecdsa { curve: EcdsaCurve::NistP521 }),
        other => Err(format!("Unsupported key algorithm: {other}")),
    }
}

/// Generated key pair, returned to the frontend for review before saving.
pub struct GeneratedKeyPair {
    pub private_key_pem: String,
    pub public_key_openssh: String,
}

/// Generates a brand new SSH key pair. RSA generation uses 4096 bits (3072
/// is accepted as an alias since russh-keys/ssh-key only expose one RSA
/// size via `Algorithm::Rsa` at generation time — the resulting key is a
/// standard 4096-bit RSA key, which is a safe default).
pub fn generate_keypair(algo: &str, comment: &str) -> Result<GeneratedKeyPair, String> {
    let algorithm = parse_algorithm(algo)?;
    // Thread-local CSPRNG (ChaCha12, periodically reseeded from the OS).
    let mut rng = rand_10::rng();

    let mut key = PrivateKey::random(&mut rng, algorithm)
        .map_err(|e| format!("Key generation failed: {e}"))?;

    if !comment.trim().is_empty() {
        key.set_comment(comment.trim());
    }

    let private_key_pem = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| format!("Failed to encode private key: {e}"))?
        .to_string();

    let public_key_openssh = key
        .public_key()
        .to_openssh()
        .map_err(|e| format!("Failed to encode public key: {e}"))?;

    Ok(GeneratedKeyPair { private_key_pem, public_key_openssh })
}

/// Normalizes an OpenSSH public key string by collapsing whitespace/newlines into single spaces.
pub fn normalize_public_key_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Derives or normalizes an OpenSSH public key line.
///
/// Accepts:
/// 1. An OpenSSH public key line (e.g. `ssh-rsa AAAAB3...` or `ssh-ed25519 AAA...`),
///    which is parsed, validated, and normalized.
/// 2. An OpenSSH or PEM private key, which is decrypted with `passphrase` if encrypted,
///    and has its public key extracted.
pub fn derive_public_key(pem: &str, passphrase: Option<&str>) -> Result<String, String> {
    let trimmed = pem.trim();
    if is_public_key_text(trimmed) {
        let normalized = normalize_public_key_text(trimmed);
        let pubkey = PublicKey::from_openssh(&normalized)
            .map_err(|e| format!("Invalid public key: {e}"))?;
        return pubkey
            .to_openssh()
            .map_err(|e| format!("Failed to encode public key: {e}"));
    }

    let key_pair = decode_secret_key(trimmed, passphrase)
        .map_err(|e| format!("Invalid private key: {e}"))?;
    key_pair
        .public_key()
        .to_openssh()
        .map_err(|e| format!("Failed to encode public key: {e}"))
}

pub struct KeyDetails {
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub is_public_key_only: bool,
}

/// Inspects a key (private key PEM OR OpenSSH public key string) and extracts
/// its algorithm badge, OpenSSH public key, and SHA256 fingerprint.
pub fn inspect_key(pem: &str, passphrase: Option<&str>) -> Result<KeyDetails, String> {
    let trimmed = pem.trim();
    if is_public_key_text(trimmed) {
        let normalized = normalize_public_key_text(trimmed);
        let pubkey = PublicKey::from_openssh(&normalized)
            .map_err(|e| format!("Invalid public key: {e}"))?;
        let public_key = pubkey
            .to_openssh()
            .map_err(|e| format!("Failed to encode public key: {e}"))?;
        let fingerprint = format!("{}", pubkey.fingerprint(russh::keys::ssh_key::HashAlg::Sha256));
        let algorithm = match pubkey.algorithm() {
            Algorithm::Ed25519 => "ED25519".to_string(),
            Algorithm::Rsa { .. } => "RSA".to_string(),
            Algorithm::Ecdsa { .. } => "ECDSA".to_string(),
            other => other.to_string(),
        };
        return Ok(KeyDetails {
            algorithm,
            public_key,
            fingerprint,
            is_public_key_only: true,
        });
    }

    let key_pair = decode_secret_key(trimmed, passphrase)
        .map_err(|e| format!("Invalid private key: {e}"))?;
    let pubkey = key_pair.public_key();
    let public_key = pubkey
        .to_openssh()
        .map_err(|e| format!("Failed to encode public key: {e}"))?;
    let fingerprint = format!("{}", pubkey.fingerprint(russh::keys::ssh_key::HashAlg::Sha256));
    let algorithm = match pubkey.algorithm() {
        Algorithm::Ed25519 => "ED25519".to_string(),
        Algorithm::Rsa { .. } => "RSA".to_string(),
        Algorithm::Ecdsa { .. } => "ECDSA".to_string(),
        other => other.to_string(),
    };
    Ok(KeyDetails {
        algorithm,
        public_key,
        fingerprint,
        is_public_key_only: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_ed25519_and_derives_matching_public_key() {
        let pair = generate_keypair("ed25519", "test@termimus").expect("keygen failed");
        assert!(pair.private_key_pem.contains("BEGIN OPENSSH PRIVATE KEY"));
        assert!(pair.public_key_openssh.starts_with("ssh-ed25519 "));

        let derived = derive_public_key(&pair.private_key_pem, None).expect("derive failed");
        assert_eq!(derived, pair.public_key_openssh);
    }

    #[test]
    fn generates_ecdsa_p256() {
        let pair = generate_keypair("ecdsa-p256", "").expect("keygen failed");
        assert!(pair.public_key_openssh.starts_with("ecdsa-sha2-nistp256 "));
    }

    #[test]
    fn rejects_unsupported_algorithm() {
        assert!(generate_keypair("dsa-legacy", "").is_err());
    }

    #[test]
    fn derive_public_key_fails_on_garbage_input() {
        assert!(derive_public_key("not a real key", None).is_err());
    }
}
