// oxlint-disable-next-line no-unused-vars -- component-parser.test.ts가 이 alias import 엣지(tsconfig ~/* → app/*) 검출을 검증하는 fixture 데이터. 실제 렌더링에는 미사용
import About from '~/routes/about'

export default function Index() {
  return <h1>Home</h1>
}
