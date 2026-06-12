import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export default function OrdSpecPrintPage() {
  const { data } = useQuery({
    queryKey: ['OrdSpecPrintPage'],
    queryFn: () => axios.get('/api/partner/ord-prod-plan/spec'),
  })
  return <div>OrdSpecPrintPage {data ? '✓' : ''}</div>
}
