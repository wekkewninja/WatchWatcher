import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { AuthStateService } from './core/auth-state.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the WatchWatcher brand', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-lockup')?.textContent).toContain('WatchWatcher');
  });

  it('navigates to login after signing out', async () => {
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    const router = TestBed.inject(Router);
    vi.spyOn(auth, 'logout').mockResolvedValue();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await fixture.componentInstance.signOut();

    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
