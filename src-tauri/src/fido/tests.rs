use super::*;
use russh::keys::ssh_key::public;
use signature::Signer;

const RP: &str = "ssh:termimus-test";
const CHALLENGE: &[u8] = b"synthetic SSH authentication request";
const COUNTER: u32 = 0x0102_0304;

fn authenticator_message(flags: u8) -> Vec<u8> {
    let mut signed = Sha256::digest(RP).to_vec();
    signed.push(flags);
    signed.extend_from_slice(&COUNTER.to_be_bytes());
    signed.extend_from_slice(&Sha256::digest(CHALLENGE));
    signed
}

fn assert_wire_signature(key: &PublicKey, signature: &[u8]) {
    let wire = encode_assertion(
        key,
        USER_PRESENCE | USER_VERIFICATION,
        CHALLENGE,
        Assertion {
            signature: signature.to_vec(),
            flags: USER_PRESENCE | USER_VERIFICATION,
            counter: COUNTER,
        },
    )
    .unwrap();
    assert_eq!(&wire[wire.len() - 5..], &[5, 1, 2, 3, 4]);
    let signature = Signature::try_from(wire.as_slice()).unwrap();
    Verifier::verify(key, CHALLENGE, &signature).unwrap();
    assert!(Verifier::verify(key, b"wrong session", &signature).is_err());
}

#[test]
fn encodes_valid_ed25519_sk_and_enforces_flags_and_counter() {
    let software = PrivateKey::random(&mut rand_10::rng(), Algorithm::Ed25519).unwrap();
    let public = public::SkEd25519::new(*software.public_key().key_data().ed25519().unwrap(), RP);
    let key = PublicKey::new(public.into(), "test");
    let signature: Signature = software.try_sign(&authenticator_message(5)).unwrap();
    assert_wire_signature(&key, signature.as_bytes());
    for (flags, counter) in [(USER_PRESENCE, COUNTER), (5, COUNTER + 1)] {
        assert!(encode_assertion(
            &key,
            5,
            CHALLENGE,
            Assertion {
                signature: signature.as_bytes().to_vec(),
                flags,
                counter,
            }
        )
        .is_err());
    }
}

#[test]
fn converts_ecdsa_der_into_verified_openssh_mpints() {
    let software = p256::ecdsa::SigningKey::from_slice(&[6; 32]).unwrap();
    let point = software.verifying_key().to_sec1_point(false);
    let key = PublicKey::new(public::SkEcdsaSha2NistP256::new(point, RP).into(), "");
    let signature: p256::ecdsa::Signature = software.try_sign(&authenticator_message(5)).unwrap();
    assert_wire_signature(&key, signature.to_der().as_bytes());
    assert!(encode_assertion(
        &key,
        5,
        CHALLENGE,
        Assertion {
            signature: vec![0; 64],
            flags: 5,
            counter: COUNTER,
        }
    )
    .is_err());
}
