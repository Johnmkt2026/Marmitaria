'use server';
import { z } from 'zod';
import { getAdminReportResult } from '@/lib/admin-reports';
import type { ReportResult } from '@/lib/admin-report-types';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Data inválida.').refine(value=>{const parsed=new Date(`${value}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value},'Data inválida.');
const schema=z.object({start:date,end:date}).superRefine((v,ctx)=>{const start=Date.parse(`${v.start}T00:00:00Z`),end=Date.parse(`${v.end}T00:00:00Z`);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)ctx.addIssue({code:'custom',message:'Intervalo inválido.'});else if((end-start)/86400000>365)ctx.addIssue({code:'custom',message:'O intervalo máximo é de 366 dias.'});});
export async function loadReports(input:unknown):Promise<ReportResult>{const parsed=schema.safeParse(input);if(!parsed.success)return{error:parsed.error.issues[0]?.message??'Período inválido.'};return getAdminReportResult(parsed.data.start,parsed.data.end);}
