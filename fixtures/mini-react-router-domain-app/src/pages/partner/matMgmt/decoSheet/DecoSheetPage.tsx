import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export default function DecoSheetPage() {
  const { data } = useQuery({
    queryKey: ['DecoSheetPage'],
    queryFn: () => axios.get('/api/partner/mat-mgmt/deco'),
  })
  return <div>DecoSheetPage {data ? '✓' : ''}</div>
}
