import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../views/Home.vue') },
    { path: '/about', component: () => import('../views/About.vue') },
    { path: '/users', component: () => import('../views/Users.vue') },
    { path: '/users/:id', component: () => import('../views/UserDetail.vue') },
  ],
})

export default router
