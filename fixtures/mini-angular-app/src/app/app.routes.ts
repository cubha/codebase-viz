import { Routes } from '@angular/router'
import { HomeComponent } from './home.component'
import { AboutComponent } from './about.component'
import { UsersComponent } from './users.component'

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'about', component: AboutComponent },
  { path: 'users', component: UsersComponent },
  { path: 'users/:id', loadChildren: () => import('./user-detail/user-detail.module').then(m => m.UserDetailModule) },
]
