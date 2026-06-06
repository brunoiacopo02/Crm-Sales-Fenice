// scripts/verifyCompanySelection.ts
// Verifica la logica di risoluzione azienda attiva in isolamento.
function resolveActive(allowed: string[], fallback: string, cookieVal?: string): string {
  if (cookieVal && allowed.includes(cookieVal)) return cookieVal
  if (allowed.includes(fallback)) return fallback
  return allowed[0]
}

const cases: Array<[string, string, () => boolean]> = [
  ["cookie valido vince", "serenamente", () => resolveActive(["fenice","serenamente"], "fenice", "serenamente") === "serenamente"],
  ["cookie non consentito ignorato", "fenice", () => resolveActive(["fenice"], "fenice", "serenamente") === "fenice"],
  ["nessun cookie usa fallback", "fenice", () => resolveActive(["fenice","serenamente"], "fenice") === "fenice"],
  ["fallback fuori lista usa primo", "serenamente", () => resolveActive(["serenamente"], "fenice") === "serenamente"],
]
let ok = true
for (const [name, , fn] of cases) {
  const pass = fn()
  if (!pass) ok = false
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}`)
}
process.exit(ok ? 0 : 1)
