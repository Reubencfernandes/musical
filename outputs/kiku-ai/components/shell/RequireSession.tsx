'use client';
import SignIn from '@/components/SignIn';
import {useSession,type User} from './session';

/** This gate is presentation only; every private API still authorizes its requests on the server. */
export default function RequireSession({children}:{children:(user:User)=>React.ReactNode}){
 const {user}=useSession();
 return user?children(user):<div className="hub-gate"><SignIn title={<>Your idea.<br/>A whole song.</>}
  blurb="Write songs from a sentence, reshape your own recordings, and turn music into sheet music."/></div>;
}
