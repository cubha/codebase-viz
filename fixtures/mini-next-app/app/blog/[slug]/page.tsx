export default function BlogPostPage({ params }: { params: { slug: string } }) {
  return <article><h1>{params.slug}</h1></article>
}
