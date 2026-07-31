import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppSidebarComponent } from './app-sidebar';
import { AppHeaderComponent } from './app-header';
import { BackdropComponent } from './backdrop';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AppSidebarComponent, AppHeaderComponent, BackdropComponent],
  template: `
    <div class="min-h-screen bg-fondo text-texto">
      <app-sidebar />
      <app-backdrop />
      <div class="lg:pl-64">
        <app-header />
        <main class="p-4">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AppShellComponent {}
