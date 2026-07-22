export function createClient() {
  return {
    from: (_table: string) => ({
      select: (_columns?: string) => Promise.resolve({ data: [], error: null }),
    }),
  }
}
