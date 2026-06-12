import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export default function TrnStmtSchPage() {
  const { data } = useQuery({
    queryKey: ['TrnStmtSchPage'],
    queryFn: () => axios.get('/api/partner/perf/trans'),
  })
  return <div>TrnStmtSchPage {data ? '✓' : ''}</div>
}
