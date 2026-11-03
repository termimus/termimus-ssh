//! Redacts credentials, private keys and tokens from text before it is sent to
//! an AI provider (terminal buffers, provider error bodies).
//!
//! Rules are applied in a fixed order: whole private-key blocks first (also
//! when the BEGIN or END marker was cut off by the buffer window), then
//! well-known token formats, then context-based rules (URL userinfo,
//! `Authorization` headers, CLI password flags, `KEY=value` assignments).
//! Context rules leave values that an earlier rule already redacted alone.

use regex::{Captures, Regex};
use std::sync::LazyLock;

const PK_BEGIN: &str = r"-----BEGIN[ A-Z0-9_-]*PRIVATE KEY(?: BLOCK)?-----";
const PK_END: &str = r"-----END[ A-Z0-9_-]*PRIVATE KEY(?: BLOCK)?-----";

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid sanitizer regex")
}

/// Complete BEGIN … END block.
static RE_PRIVATE_KEY: LazyLock<Regex> =
    LazyLock::new(|| re(&format!(r"(?s){PK_BEGIN}.*?{PK_END}")));

/// END marker whose BEGIN scrolled out of the window: redact from the start.
static RE_PRIVATE_KEY_ORPHAN_END: LazyLock<Regex> =
    LazyLock::new(|| re(&format!(r"(?s)\A.*{PK_END}")));

/// BEGIN marker whose END is not in the window yet: redact to the end.
static RE_PRIVATE_KEY_ORPHAN_BEGIN: LazyLock<Regex> =
    LazyLock::new(|| re(&format!(r"(?s){PK_BEGIN}.*\z")));

static RE_JWT: LazyLock<Regex> = LazyLock::new(|| {
    re(r"\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*")
});

static RE_AWS_KEY: LazyLock<Regex> =
    LazyLock::new(|| re(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b"));

static RE_GIT_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?:gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{16,}"));

/// OpenAI / Anthropic (`sk-`, `sk-ant-`, `sk-proj-`…), Slack, Stripe-style and
/// Google API keys.
static RE_API_KEY: LazyLock<Regex> = LazyLock::new(|| {
    re(concat!(
        r"\bsk-[A-Za-z0-9_-]{20,}",
        r"|\bxox[abprs]-[A-Za-z0-9-]{10,}",
        r"|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}",
        r"|\bAIza[0-9A-Za-z_-]{35}",
    ))
});

/// `scheme://user:password@host` — keeps scheme and user.
static RE_URL_USERINFO: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?P<pre>\b[A-Za-z][A-Za-z0-9+.-]*://[^\s:/@]*:)(?P<v>[^\s@/]+)@")
});

/// `Authorization: <scheme> <credentials>` (Bearer, Basic, Token, …).
static RE_AUTH_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    re(r#"(?i)(?P<pre>\b(?:proxy-)?authorization["']?[ \t]*[:=][ \t]*["']?(?:(?:bearer|basic|token|digest|negotiate|apikey)[ \t]+)?)(?P<v>[^\s"']+)"#)
});

/// Bare `Bearer <token>` outside an Authorization header.
static RE_BEARER: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)(?P<pre>\bbearer[ \t]+)(?P<v>[A-Za-z0-9._~+/=-]{8,})"));

/// `--password X`, `--token X`, … (the `=` form is covered by assignments).
static RE_CLI_FLAG: LazyLock<Regex> = LazyLock::new(|| {
    re(r#"(?i)(?P<pre>(?:^|\s)--(?:password|passwd|pass|token|secret|api-key|apikey|auth-token)[ \t]+)(?P<v>"[^"\n]*"|'[^'\n]*'|[^\s"']+)"#)
});

/// `mysql -pSECRET` (no space: with a space `-p` prompts), `sshpass -p X`.
static RE_MYSQL_P: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?P<pre>\b(?:mysql|mysqldump|mysqladmin|mariadb|mariadb-dump)\b[^\n|;&]*?\s-p)(?P<v>[^\s]+)")
});
static RE_SSHPASS: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?P<pre>\bsshpass\s+-p[ \t]*)(?P<v>[^\s]+)"));

/// `KEY=value`, `key: value`, `"key": "value"` where the key name looks like
/// a secret. No minimum value length: `password=abc` is still a password.
static RE_ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| {
    re(concat!(
        r#"(?i)(?P<k>["']?(?:"#,
        r"[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|credential)[A-Za-z0-9_.-]*",
        r"|[A-Za-z0-9.-]*[A-Za-z0-9][_-]key",
        r"|[A-Za-z0-9.-]*[A-Za-z0-9][_-]pwd",
        r"|\bpass",
        r#")["']?)"#,
        r"(?P<s>[ \t]*[:=][ \t]*)",
        r#"(?P<v>"[^"\n]*"|'[^'\n]*'|[^\s"',;&{}\[\]]+|\[REDACTED[A-Z_]*\])"#,
    ))
});

fn already_redacted(v: &str) -> bool {
    v.trim_matches(|c| c == '"' || c == '\'').starts_with("[REDACTED")
}

/// Redacts capture group `v`, keeping group `pre` (and any surrounding quotes).
fn redact_value(caps: &Captures, label: &str) -> String {
    let (Some(whole), Some(v)) = (caps.get(0), caps.name("v")) else {
        return caps[0].to_string();
    };
    if already_redacted(v.as_str()) {
        return whole.as_str().to_string();
    }
    let pre = &whole.as_str()[..v.start() - whole.start()];
    let tail = &whole.as_str()[v.end() - whole.start()..];
    format!("{pre}{}{tail}", quote_like(v.as_str(), label))
}

fn quote_like(v: &str, label: &str) -> String {
    match v.chars().next() {
        Some(q @ ('"' | '\'')) if v.len() >= 2 && v.ends_with(q) => format!("{q}{label}{q}"),
        _ => label.to_string(),
    }
}

/// Redacts sensitive credentials, private keys, and tokens from terminal text before sending to LLM.
pub fn sanitize_terminal_buffer(raw: &str) -> String {
    let mut s = RE_PRIVATE_KEY.replace_all(raw, "[REDACTED_PRIVATE_KEY]").into_owned();
    s = RE_PRIVATE_KEY_ORPHAN_END.replace_all(&s, "[REDACTED_PRIVATE_KEY]").into_owned();
    s = RE_PRIVATE_KEY_ORPHAN_BEGIN.replace_all(&s, "[REDACTED_PRIVATE_KEY]").into_owned();

    s = RE_JWT.replace_all(&s, "[REDACTED_JWT]").into_owned();
    s = RE_AWS_KEY.replace_all(&s, "[REDACTED_AWS_KEY]").into_owned();
    s = RE_GIT_TOKEN.replace_all(&s, "[REDACTED_TOKEN]").into_owned();
    s = RE_API_KEY.replace_all(&s, "[REDACTED_API_KEY]").into_owned();

    s = RE_URL_USERINFO
        .replace_all(&s, |c: &Captures| redact_value(c, "[REDACTED]"))
        .into_owned();
    s = RE_AUTH_HEADER
        .replace_all(&s, |c: &Captures| redact_value(c, "[REDACTED]"))
        .into_owned();
    s = RE_BEARER
        .replace_all(&s, |c: &Captures| {
            // Opaque tokens practically always contain a digit; this keeps
            // prose like "bearer authentication" intact.
            if c["v"].bytes().any(|b| b.is_ascii_digit()) {
                redact_value(c, "[REDACTED]")
            } else {
                c[0].to_string()
            }
        })
        .into_owned();
    for rule in [&*RE_CLI_FLAG, &*RE_MYSQL_P, &*RE_SSHPASS] {
        s = rule
            .replace_all(&s, |c: &Captures| redact_value(c, "[REDACTED]"))
            .into_owned();
    }
    s = RE_ASSIGNMENT
        .replace_all(&s, |c: &Captures| {
            let v = &c["v"];
            if already_redacted(v) {
                return c[0].to_string();
            }
            format!("{}{}{}", &c["k"], &c["s"], quote_like(v, "[REDACTED]"))
        })
        .into_owned();

    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(input: &str) -> String {
        sanitize_terminal_buffer(input)
    }

    #[test]
    fn test_sanitizer() {
        let input = "export GITHUB_TOKEN=ghp_abcdef1234567890abcdef\nexport PASS=supersecretpassword123";
        let output = clean(input);
        assert!(!output.contains("ghp_abcdef1234567890abcdef"));
        assert!(!output.contains("supersecretpassword123"));
        assert!(output.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitizer_bare_tokens() {
        let input = "origin https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/x/y.git\nglpat-abcdefghij0123456789";
        let output = clean(input);
        assert!(!output.contains("ghp_abcdefghijklmnopqrstuvwxyz0123"));
        assert!(!output.contains("glpat-abcdefghij0123456789"));
        assert_eq!(output.matches("[REDACTED_TOKEN]").count(), 2);
    }

    #[test]
    fn env_style_secrets() {
        let out = clean(
            "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n\
             export DB_PASSWORD=hunter2\nSLACK_TOKEN=abc123\nSTRIPE_KEY=zz9\n\
             MY_CLIENT_SECRET='s p a c e'",
        );
        for secret in ["wJalrXUtnFEMI", "hunter2", "abc123", "zz9", "s p a c e"] {
            assert!(!out.contains(secret), "{secret} leaked: {out}");
        }
        assert!(out.contains("AWS_SECRET_ACCESS_KEY=[REDACTED]"));
        assert!(out.contains("export DB_PASSWORD=[REDACTED]"));
        assert!(out.contains("MY_CLIENT_SECRET='[REDACTED]'"));
    }

    #[test]
    fn aws_access_key_ids() {
        let out = clean("AKIAIOSFODNN7EXAMPLE and ASIAY34FZKBOKMUTVV7A");
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!out.contains("ASIAY34FZKBOKMUTVV7A"));
        assert_eq!(out.matches("[REDACTED_AWS_KEY]").count(), 2);
    }

    #[test]
    fn json_and_yaml_keys() {
        let out = clean(
            r#"{"password": "p@ss w0rd", "secret":"x", "token": "abc", "api_key": "k1", "user": "bob"}
password: x
db:
  passwd: 'q'"#,
        );
        for secret in ["p@ss w0rd", "\"x\"", "\"abc\"", "\"k1\"", "password: x", "'q'"] {
            assert!(!out.contains(secret), "{secret} leaked: {out}");
        }
        assert!(out.contains(r#""password": "[REDACTED]""#));
        assert!(out.contains(r#""user": "bob""#));
        assert!(out.contains("password: [REDACTED]"));
    }

    #[test]
    fn short_keyword_values_are_redacted() {
        let out = clean("password=abc pass=1");
        assert_eq!(out, "password=[REDACTED] pass=[REDACTED]");
    }

    #[test]
    fn complete_private_key_block() {
        let out = clean("before\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\nNzaC1\n-----END OPENSSH PRIVATE KEY-----\nafter");
        assert_eq!(out, "before\n[REDACTED_PRIVATE_KEY]\nafter");
    }

    #[test]
    fn private_key_missing_end() {
        let out = clean("$ cat id_rsa\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nmore");
        assert_eq!(out, "$ cat id_rsa\n[REDACTED_PRIVATE_KEY]");
    }

    #[test]
    fn private_key_missing_begin() {
        let out = clean("MIIEpAIBAAKCAQEA\nzzzz\n-----END PRIVATE KEY-----\n$ ls");
        assert_eq!(out, "[REDACTED_PRIVATE_KEY]\n$ ls");
    }

    #[test]
    fn pgp_private_key_block() {
        let out = clean("-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----\nok");
        assert_eq!(out, "[REDACTED_PRIVATE_KEY]\nok");
        let cut = clean("-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBF");
        assert_eq!(cut, "[REDACTED_PRIVATE_KEY]");
    }

    #[test]
    fn authorization_headers() {
        let out = clean(
            "curl -H 'Authorization: Bearer abcdef0123456789opaque' x\n\
             Authorization: Basic dXNlcjpwYXNz\nAuthorization: Token t0k",
        );
        assert!(!out.contains("abcdef0123456789opaque"));
        assert!(!out.contains("dXNlcjpwYXNz"));
        assert!(!out.contains("t0k"));
        assert!(out.contains("Authorization: Bearer [REDACTED]"));
        assert!(out.contains("Authorization: Basic [REDACTED]"));
    }

    #[test]
    fn bare_bearer_and_jwt() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let out = clean(&format!("token is {jwt}\nbearer 9f8e7d6c5b4a"));
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(out.contains("[REDACTED_JWT]"));
        assert!(!out.contains("9f8e7d6c5b4a"));
        // Plain prose is left alone.
        assert_eq!(clean("uses bearer authentication"), "uses bearer authentication");
    }

    #[test]
    fn url_userinfo() {
        let out = clean("psql postgres://admin:s3cr3t@db.internal:5432/app");
        assert_eq!(out, "psql postgres://admin:[REDACTED]@db.internal:5432/app");
        let out = clean("redis://:hunter2@cache:6379");
        assert_eq!(out, "redis://:[REDACTED]@cache:6379");
        // No userinfo: untouched.
        assert_eq!(clean("https://example.com:8443/a@b"), "https://example.com:8443/a@b");
    }

    #[test]
    fn cli_password_flags() {
        let out = clean("mysql -u root -pS3cret db\nmysql -u root -p db\npg --password hunter2\nx --password=abc\nsshpass -p pw ssh h");
        assert!(!out.contains("S3cret"));
        assert!(out.contains("mysql -u root -p[REDACTED] db"));
        assert!(out.contains("mysql -u root -p db"));
        assert!(out.contains("--password [REDACTED]"));
        assert!(out.contains("--password=[REDACTED]"));
        assert!(out.contains("sshpass -p [REDACTED] ssh"));
    }

    #[test]
    fn vendor_api_keys() {
        let keys = [
            "sk-abcdefghijklmnopqrstuvwx0123",
            "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
            "sk-proj-abcdefghijklmnopqrstuvwxyz0123",
            "xoxb-1234567890-abcdefghij",
            "sk_live_abcdefghij0123",
            "rk_live_abcdefghij0123",
            "pk_live_abcdefghij0123",
        ];
        let out = clean(&keys.join("\n"));
        for k in keys {
            assert!(!out.contains(k), "{k} leaked: {out}");
        }
        assert_eq!(out.matches("[REDACTED_API_KEY]").count(), keys.len());
    }

    #[test]
    fn ordinary_text_untouched() {
        let text = "$ ls -la /etc/ssl/private\ntotal 8\ndrwx------ 2 root root 4096 key.pem\n\
                    PWD=/home/deploy\nkeyboard layout: us\nbypass=1\ntask-runner disk-by-uuid\n\
                    [sudo] password for deploy:\nauthor: Jane";
        assert_eq!(clean(text), text);
    }
}
