import { ReportsAnalytics } from '@/components/admin/reports-analytics';
import { getAdminReportResult } from '@/lib/admin-reports';
export const dynamic='force-dynamic';
export default async function RelatoriosPage(){return <ReportsAnalytics initial={await getAdminReportResult()}/>;}
