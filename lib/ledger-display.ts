export function formatLedgerCodeForDisplay(code: string) {
  return code.replaceAll("云雾", "yw").replace(/\byunwu\b/gi, "yw")
}
