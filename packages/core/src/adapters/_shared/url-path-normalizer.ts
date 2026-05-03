// Converts framework-specific dynamic segment notation to unified :param format.
// Policy: [slug]→:slug, [...slug]→:slug*, [[...slug]]→:slug?, {slug}→:slug
export function normalizeSegment(segment: string): string {
  // Optional catch-all: [[...slug]] → :slug?
  if (segment.startsWith('[[...') && segment.endsWith(']]')) {
    return ':' + segment.slice(5, -2) + '?'
  }
  // Catch-all: [...slug] → :slug*
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return ':' + segment.slice(4, -1) + '*'
  }
  // Dynamic: [slug] → :slug
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return ':' + segment.slice(1, -1)
  }
  // Path param (Django/FastAPI/Spring): {id} → :id
  if (segment.startsWith('{') && segment.endsWith('}')) {
    return ':' + segment.slice(1, -1)
  }
  return segment
}

export function normalizeUrlPath(rawPath: string): string {
  if (rawPath === '' || rawPath === '/') return '/'
  const segments = rawPath.split('/')
  return segments.map(s => normalizeSegment(s)).join('/')
}
