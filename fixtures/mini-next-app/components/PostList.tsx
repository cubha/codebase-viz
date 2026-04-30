'use client'

import { createClient } from '../lib/supabase.js'

export default function PostList() {
  const supabase = createClient()
  supabase.from('posts').select('*')
  return <ul></ul>
}
