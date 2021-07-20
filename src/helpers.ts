export interface Logger {
  // Ordered from least-severe to most-severe.
  debug: (message?: string) => void
  info: (message?: string) => void
  warn: (message?: string) => void
  error: (message?: string) => void
}
