import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export default function UserMgmtPage() {
  const { data } = useQuery({
    queryKey: ['UserMgmtPage'],
    queryFn: () => axios.get('/api/agency/users'),
  })
  return <div>UserMgmtPage {data ? '✓' : ''}</div>
}
