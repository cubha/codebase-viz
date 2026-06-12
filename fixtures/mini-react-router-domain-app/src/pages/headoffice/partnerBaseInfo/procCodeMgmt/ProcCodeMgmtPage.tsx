import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export default function ProcCodeMgmtPage() {
  const { data } = useQuery({
    queryKey: ['ProcCodeMgmtPage'],
    queryFn: () => axios.get('/api/head-office/proc-code'),
  })
  return <div>ProcCodeMgmtPage {data ? '✓' : ''}</div>
}
