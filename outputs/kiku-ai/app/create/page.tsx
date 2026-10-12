import {redirect} from 'next/navigation';

/** The single-form creator became Generate; old links land there. */
export default function Create(){redirect('/generate');}
