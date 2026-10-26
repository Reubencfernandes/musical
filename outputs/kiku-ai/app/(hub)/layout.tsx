import AppShell from '@/components/shell/AppShell';

/** The sidebar, sign-in dialog and player survive navigation between hub pages. */
export default function HubLayout({children}:{children:React.ReactNode}){
 return <AppShell>{children}</AppShell>;
}
