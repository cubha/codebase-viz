import { pgTable, integer, text, boolean } from 'drizzle-orm/pg-core'

export const usersTable = pgTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
})

export const postsTable = pgTable('posts', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  authorId: integer('author_id').notNull(),
})
