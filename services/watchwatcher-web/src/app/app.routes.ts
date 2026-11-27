import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
	{ path: 'login', loadComponent: () => import('./pages/login.page').then((page) => page.LoginPage) },
	{ path: 'create-account', loadComponent: () => import('./pages/create-account.page').then((page) => page.CreateAccountPage) },
	{ path: 'account', loadComponent: () => import('./pages/account.page').then((page) => page.AccountPage), canActivate: [authGuard] },
	{ path: '', loadComponent: () => import('./pages/study-desk.page').then((page) => page.StudyDeskPage), canActivate: [authGuard] },
	{ path: 'examiner', loadComponent: () => import('./pages/examiner.page').then((page) => page.ExaminerPage) },
	{ path: 'exam', loadComponent: () => import('./pages/assessment-exam.page').then((page) => page.AssessmentExamPage), canActivate: [authGuard] },
	{ path: 'syllabus', loadComponent: () => import('./pages/syllabus.page').then((page) => page.SyllabusPage), canActivate: [authGuard] },
	{ path: 'learn/:contentId', loadComponent: () => import('./pages/learning-detail.page').then((page) => page.LearningDetailPage), canActivate: [authGuard] },
	{ path: 'colregs/:ruleId', loadComponent: () => import('./pages/colregs-rule.page').then((page) => page.ColregsRulePage) },
	{ path: 'colregs', loadComponent: () => import('./pages/colregs.page').then((page) => page.ColregsPage) },
	{ path: '**', redirectTo: '' },
];
