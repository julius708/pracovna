export function usagePage(path: string) {
 const routes: Record<string,string> = {'/':'home','/guru':'guru','/feedback':'feedback','/heslo':'password','/admin/users':'users','/admin/settings':'settings','/admin/feedback':'feedback_admin','/admin/activity':'activity','/byty':'apartments','/znalost':'knowledge','/tim':'team','/audit':'audit','/nastavenia':'settings','/historia':'history','/historia/balenie':'packing_history','/stav':'status'};
 if (routes[path]) return routes[path];
 if (/^\/byty\/[^/]+$/.test(path)) return 'apartment_detail';
 return null;
}
