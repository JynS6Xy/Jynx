/**
 * Jynx Web Cryptography Engine
 * Implements Password-Authenticated Key Exchange (PAKE) derivation
 * with AES-256-GCM symmetric encryption using standard Web Crypto API.
 */
class JynxCrypto {
  constructor() {
    this.crypto = window.crypto;
    this.subtle = window.crypto.subtle;
  }

  /**
   * Generates a random cryptographic salt (16 bytes)
   */
  generateSalt() {
    return this.crypto.getRandomValues(new Uint8Array(16));
  }

  /**
   * Generates a random Initialization Vector (12 bytes for AES-GCM)
   */
  generateIV() {
    return this.crypto.getRandomValues(new Uint8Array(12));
  }

  /**
   * Derives a 256-bit AES-GCM Key from a code phrase and salt using PBKDF2
   * @param {string} password - The Jynx code phrase (e.g. "7492-velvet-falcon")
   * @param {Uint8Array} salt - 16-byte salt
   * @param {number} iterations - Number of PBKDF2 iterations (100,000 standard)
   */
  async deriveKey(password, salt, iterations = 100000) {
    const encoder = new TextEncoder();
    const rawKeyMaterial = encoder.encode(password.trim().toLowerCase());

    const baseKey = await this.subtle.importKey(
      "raw",
      rawKeyMaterial,
      { name: "PBKDF2" },
      false,
      ["deriveKey", "deriveBits"]
    );

    const derivedKey = await this.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    return derivedKey;
  }

  /**
   * Encrypts a binary payload (ArrayBuffer or Uint8Array) using AES-256-GCM
   * @param {ArrayBuffer} data 
   * @param {string} password 
   */
  async encrypt(data, password) {
    const salt = this.generateSalt();
    const iv = this.generateIV();
    const key = await this.deriveKey(password, salt);

    const ciphertext = await this.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      data
    );

    // Format container: [Salt (16 bytes)] [IV (12 bytes)] [Ciphertext with GCM Auth Tag]
    const combined = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.byteLength);
    combined.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

    return combined;
  }

  /**
   * Decrypts an encrypted container using the provided password
   * @param {Uint8Array} encryptedContainer 
   * @param {string} password 
   */
  async decrypt(encryptedContainer, password) {
    if (encryptedContainer.byteLength < 28) {
      throw new Error("Invalid payload: Container too short to contain cryptographic headers.");
    }

    const salt = encryptedContainer.slice(0, 16);
    const iv = encryptedContainer.slice(16, 28);
    const ciphertext = encryptedContainer.slice(28);

    const key = await this.deriveKey(password, salt);

    const decrypted = await this.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      ciphertext
    );

    return decrypted;
  }

  /**
   * Computes SHA-256 hex fingerprint of arbitrary data
   * @param {ArrayBuffer|Uint8Array} data 
   */
  async sha256(data) {
    const hashBuffer = await this.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Computes PAKE verification code snippet (first 6 characters of SHA-256 for verbal confirmation)
   */
  async getVerificationDigits(password) {
    const encoder = new TextEncoder();
    const hash = await this.sha256(encoder.encode(password.trim().toLowerCase()));
    return hash.slice(0, 6).toUpperCase();
  }
}

window.jynxCrypto = new JynxCrypto();
