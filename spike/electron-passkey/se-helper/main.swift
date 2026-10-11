// Secure Enclave spike helper. Commands (JSON on stdout):
//   status | create | wrap <b64> | unwrap <b64> [reason] | delete
// The P-256 key lives in the Secure Enclave; using the private key needs Touch ID or the password.
import Foundation
import Security
import LocalAuthentication

let group = "9YDT4ML5X7.com.leosa.devseshspike.se"
let tag = "com.leosa.devseshspike.se-key".data(using: .utf8)!
let algo = SecKeyAlgorithm.eciesEncryptionCofactorX963SHA256AESGCM

func out(_ d: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: d)
    print(String(data: data, encoding: .utf8)!)
    exit((d["ok"] as? Bool) == true ? 0 : 1)
}
func fail(_ msg: String, _ status: OSStatus? = nil) -> Never {
    var m = msg
    if let s = status { m += " (OSStatus \(s): \((SecCopyErrorMessageString(s, nil) as String?) ?? "?"))" }
    out(["ok": false, "error": m])
}

func baseQuery() -> [String: Any] {
    return [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: tag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrAccessGroup as String: group,
        kSecUseDataProtectionKeychain as String: true,
    ]
}

func findKey(context: LAContext? = nil) -> SecKey? {
    var q = baseQuery()
    q[kSecReturnRef as String] = true
    if let c = context { q[kSecUseAuthenticationContext as String] = c }
    var item: CFTypeRef?
    let s = SecItemCopyMatching(q as CFDictionary, &item)
    if s == errSecItemNotFound { return nil }
    if s != errSecSuccess { fail("key lookup failed", s) }
    return (item as! SecKey)
}

func createKey() -> SecKey {
    var err: Unmanaged<CFError>?
    // userPresence = Touch ID, or the login password as a fallback. privateKeyUsage = key stays in the enclave.
    guard let access = SecAccessControlCreateWithFlags(
        nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &err)
    else { fail("access control: \(err!.takeRetainedValue())") }
    var attrs = baseQuery()
    attrs.removeValue(forKey: kSecClass as String)
    attrs[kSecAttrKeySizeInBits as String] = 256
    attrs[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    attrs[kSecPrivateKeyAttrs as String] = [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrAccessControl as String: access,
        kSecAttrAccessGroup as String: group,
    ] as [String: Any]
    guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &err)
    else { fail("create key: \(err!.takeRetainedValue())") }
    return key
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: se-helper status|create|wrap|unwrap|delete") }

switch args[1] {
case "status":
    out(["ok": true, "exists": findKey() != nil, "secureEnclaveToken": true])
case "create":
    if findKey() != nil { out(["ok": true, "created": false]) }
    let key = createKey()
    let pub = SecKeyCopyPublicKey(key)!
    var e: Unmanaged<CFError>?
    let pubData = SecKeyCopyExternalRepresentation(pub, &e)! as Data
    out(["ok": true, "created": true, "publicKey": pubData.base64EncodedString()])
case "wrap":
    guard args.count >= 3, let plain = Data(base64Encoded: args[2]) else { fail("wrap needs base64 data") }
    guard let key = findKey(), let pub = SecKeyCopyPublicKey(key) else { fail("no key; run create first") }
    guard SecKeyIsAlgorithmSupported(pub, .encrypt, algo) else { fail("algorithm not supported") }
    var e: Unmanaged<CFError>?
    // Encrypting only needs the public key, so this never prompts.
    guard let ct = SecKeyCreateEncryptedData(pub, algo, plain as CFData, &e) as Data?
    else { fail("encrypt: \(e!.takeRetainedValue())") }
    out(["ok": true, "wrapped": ct.base64EncodedString()])
case "unwrap":
    guard args.count >= 3, let ct = Data(base64Encoded: args[2]) else { fail("unwrap needs base64 data") }
    let ctx = LAContext()
    ctx.localizedReason = args.count >= 4 ? args[3] : "Unlock your devsesh master key"
    guard let key = findKey(context: ctx) else { fail("no key; run create first") }
    let t0 = Date()
    var e: Unmanaged<CFError>?
    // Decrypting needs the private key, so macOS asks for Touch ID here.
    guard let pt = SecKeyCreateDecryptedData(key, algo, ct as CFData, &e) as Data?
    else { fail("decrypt: \(e!.takeRetainedValue())") }
    out(["ok": true, "unwrapped": pt.base64EncodedString(), "ms": Int(Date().timeIntervalSince(t0) * 1000)])
case "selftest":
    // wrap 32 random bytes, then unwrap (this is the step that needs Touch ID) and compare.
    if findKey() == nil { _ = createKey() }
    var secret = Data(count: 32)
    _ = secret.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
    let key0 = findKey()!
    var e0: Unmanaged<CFError>?
    guard let ct0 = SecKeyCreateEncryptedData(SecKeyCopyPublicKey(key0)!, algo, secret as CFData, &e0) as Data?
    else { fail("encrypt: \(e0!.takeRetainedValue())") }
    let c = LAContext()
    c.localizedReason = "devsesh Secure Enclave spike: unlock the test secret"
    let key1 = findKey(context: c)!
    let t1 = Date()
    var e1: Unmanaged<CFError>?
    guard let pt1 = SecKeyCreateDecryptedData(key1, algo, ct0 as CFData, &e1) as Data?
    else { fail("decrypt: \(e1!.takeRetainedValue())") }
    out(["ok": true, "roundTripMatches": pt1 == secret, "unwrapMs": Int(Date().timeIntervalSince(t1) * 1000), "cipherBytes": ct0.count])
case "delete":
    let s = SecItemDelete(baseQuery() as CFDictionary)
    out(["ok": s == errSecSuccess || s == errSecItemNotFound, "status": Int(s)])
default:
    fail("unknown command")
}
