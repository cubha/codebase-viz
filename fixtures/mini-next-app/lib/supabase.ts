export function createClient() {
  return {
    from: (table: string) => ({
      select: (columns?: string) => Promise.resolve({ data: [], error: null }),
    }),
  }
}
