export const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
export const cents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
