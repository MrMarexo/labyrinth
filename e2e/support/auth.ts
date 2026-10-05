export const PASSWORD = "correct-horse-battery";

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}
