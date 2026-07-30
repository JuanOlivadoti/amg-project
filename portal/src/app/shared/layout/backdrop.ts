import { Component, inject } from '@angular/core';
import { SidebarService } from '../services/sidebar';

@Component({
  selector: 'app-backdrop',
  template: `
    @if (sidebar.mobileAbierto()) {
      <div class="fixed inset-0 z-40 bg-velo opacity-50 lg:hidden" (click)="sidebar.cerrarMobile()"></div>
    }
  `,
})
export class BackdropComponent {
  readonly sidebar = inject(SidebarService);
}
