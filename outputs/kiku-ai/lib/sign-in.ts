/** Sent on window when a sign-in popup opens, so the session can watch for its result. */
export const SIGN_IN_STARTED='kiku-sign-in-started';
/** Start OAuth from a user click. Embedded Spaces use a popup; standalone pages redirect. */
export function startSignIn(next=window.location.pathname):boolean{
 const login=new URL('/auth/login',window.location.origin);
 if(next!=='/')login.searchParams.set('next',next);
 if(window.self===window.top){window.location.assign(login.href);return false;}
 login.searchParams.set('popup','1');
 const popup=window.open(login.href,'kiku-sign-in','width=520,height=730,menubar=no,toolbar=no');
 if(popup){popup.focus();window.dispatchEvent(new Event(SIGN_IN_STARTED));return true;}
 window.open(login.href,'_blank','noopener');
 return false;
}
