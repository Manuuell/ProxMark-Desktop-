// Resaltado por tipo de línea para la salida de pm3.

export function lineClass(line: string): string {
  const t = line.trim()
  if (/^── \[IA\]/.test(t)) return 'l-ai'
  if (/^── \[Firmware\]/.test(t)) return 'l-fw'
  if (/key found|found valid key|found keys have been dumped|all done|flasheado con éxito/i.test(t)) {
    return 'l-key'
  }
  if (/\[!!\]|\[!\]|auth error|too big|invalid option|^ERROR\b|error:/i.test(t)) {
    return 'l-error'
  }
  if (/^\s*\[\+\]/.test(line)) return 'l-success'
  if (/^\s*\[=\]/.test(line)) return 'l-section'
  if (/^\s*\[\?\]/.test(line)) return 'l-question'
  if (/^\[usb\|script\]|^\[#\]|^pm3 -->|^\[x\]|^\[\\|^\[\/|^\[\|/.test(t)) {
    return 'l-muted'
  }
  return 'l-plain'
}
