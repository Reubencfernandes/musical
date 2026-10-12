import {getCACertificates,setDefaultCACertificates} from 'node:tls';

// Include certificates trusted by the host OS without disabling verification.
// This also covers Gradio's HTTPS calls on Windows development machines.
if (typeof setDefaultCACertificates==='function') {
 setDefaultCACertificates([...new Set([...getCACertificates('default'),...getCACertificates('system')])]);
}
