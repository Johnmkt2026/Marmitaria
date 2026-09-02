import 'server-only';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import type { AdminReport, ReportResult } from '@/lib/admin-report-types';

export async function getAdminReport(start?:string,end?:string):Promise<AdminReport>{
  const db=await requireAdminClient();
  let first=start,last=end;
  if(!first||!last){const {data,error}=await db.rpc('menu_date');if(error||typeof data!=='string')throw new Error('Data indisponível');first=data;last=data;}
  const {data,error}=await db.rpc('get_admin_reports',{p_start_date:first,p_end_date:last});
  if(error||!data)throw new Error(error?.message??'Falha ao carregar relatório');
  return data as AdminReport;
}
export async function getAdminReportResult(start?:string,end?:string):Promise<ReportResult>{
  try{return{data:await getAdminReport(start,end)}}catch(error){return error instanceof AdminAccessError?{error:error.message,unauthorized:true}:{error:'Não foi possível carregar o relatório.'}}
}
