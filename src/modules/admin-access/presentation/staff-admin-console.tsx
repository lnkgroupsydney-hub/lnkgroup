"use client";

import { OperationsConsole } from "@/modules/operations/client";
import { CustomersConsole } from "@/modules/customers/client";
import { SessionSecurity } from "./session-security";
import { StaffAdminBoundary, useStaffAdmin } from "./staff-admin-boundary";

function StandaloneWorkspace() {
  const { onAccessLost } = useStaffAdmin();
  return <>
    <nav className="staff-workspace-nav" aria-label="Administrator workspace">
      <a href="#operations-content">Operations</a>
      <a href="#customers-heading">Customers</a>
      <a href="#staff-session-security-heading">Session security</a>
    </nav>
    <OperationsConsole onSignedOut={onAccessLost} />
    <div className="operations-page staff-customers-page"><div className="operations-shell"><CustomersConsole onSignedOut={onAccessLost} /></div></div>
    <div className="operations-page staff-security-page"><div className="operations-shell"><SessionSecurity onAccessLost={onAccessLost} /></div></div>
  </>;
}

export function StaffAdminConsole() {
  return <StaffAdminBoundary><StandaloneWorkspace /></StaffAdminBoundary>;
}
