const SECRET_PATTERNS = [
  /(^|\/)\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
  /secret/i,
  /credential/i,
]

export function isSecretPath(path: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(path))
}
