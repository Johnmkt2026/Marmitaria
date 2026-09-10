'use client';

import { useState, type FormEvent } from 'react';
import { loadAdminSettings, updateSettings } from '@/app/admin/configuracoes/actions';
import type { AdminSettings, AdminSettingsResult } from '@/lib/admin-settings-types';
import { Badge, Button, Card } from '@/components/ui';

const feeInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function SettingsAdmin({ initial }: { initial: AdminSettingsResult }) {
  const [settings, setSettings] = useState<AdminSettings | null>(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  async function reload() {
    const result = await loadAdminSettings();
    if (result.data) { setSettings(result.data); setError(null); }
    else setError(result.error);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(null); setNotice('');
    try {
      const result = await updateSettings({
        id: settings.id,
        name: String(form.get('name') ?? ''),
        isOpen: form.get('isOpen') === 'on',
        deliveryFee: String(form.get('deliveryFee') ?? ''),
        deliveryMinutesMin: Number(form.get('deliveryMinutesMin')),
        deliveryMinutesMax: Number(form.get('deliveryMinutesMax')),
        updatedAt: settings.updated_at,
      });
      if (result.data) { setSettings(result.data); setNotice(result.message); }
      else { setError(result.error); if (result.conflict) await reload(); }
    } catch { setError('A conexão foi interrompida. Recarregue antes de tentar novamente.'); }
    finally { setSaving(false); }
  }
  if (!settings) return <Card><p role="alert" className="text-red-700">{error ?? 'Configurações indisponíveis.'}</p><Button onClick={() => void reload()} className="mt-3">Tentar novamente</Button></Card>;
  const field = 'mt-1 w-full rounded-xl border bg-white p-3';
  return <><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">Configurações</h1><p className="mt-1 text-stone-600">Dados operacionais usados pelo cardápio e pelos pedidos.</p></div><Badge tone={settings.is_open ? 'green' : 'red'}>● {settings.is_open ? 'Aberto' : 'Fechado'}</Badge></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p role="status" className="mt-3 text-sm text-green-700">{saving ? 'Salvando...' : notice}</p>
    <Card className="mt-5 max-w-3xl"><form key={settings.updated_at} onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">Nome da operação<input name="name" defaultValue={settings.name} minLength={2} maxLength={120} required className={field}/></label>
      <label className="flex items-center gap-3 rounded-xl border p-4 sm:col-span-2"><input name="isOpen" type="checkbox" defaultChecked={settings.is_open} className="h-5 w-5 accent-brand-600"/><span><b>Loja aberta</b><br/><small className="text-stone-500">Quando fechada, novos pedidos são bloqueados na interface e no banco.</small></span></label>
      <label className="text-sm">Taxa de entrega (R$)<input name="deliveryFee" inputMode="decimal" defaultValue={feeInput(settings.delivery_fee_cents)} required className={field}/></label>
      <div className="hidden sm:block"/>
      <label className="text-sm">Prazo mínimo (min)<input name="deliveryMinutesMin" type="number" min="0" max="32767" defaultValue={settings.delivery_minutes_min ?? 0} required className={field}/></label>
      <label className="text-sm">Prazo máximo (min)<input name="deliveryMinutesMax" type="number" min="0" max="32767" defaultValue={settings.delivery_minutes_max ?? 0} required className={field}/></label>
      <div className="flex flex-wrap gap-3 sm:col-span-2"><Button disabled={saving} type="submit">{saving ? 'Salvando...' : 'Salvar configurações'}</Button><button type="button" disabled={saving} onClick={() => void reload()} className="rounded-xl border px-4 py-2 font-semibold">Recarregar</button></div>
    </form></Card></>;
}
