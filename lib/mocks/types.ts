export type OrderStatus = 'Novo' | 'Confirmado' | 'Preparando' | 'Pronto' | 'Saiu para entrega' | 'Entregue' | 'Cancelado';
export type Product = { id:string; name:string; description:string; price:number; category:string; image:string; available:boolean; featured:boolean; extras:{id:string;name:string;price:number}[] };
export type Order = { id:string; time:string; customer:string; phone:string; items:{name:string;quantity:number;price:number}[]; notes:string; address:string; payment:string; change:string; total:number; status:OrderStatus };
export type Customer = { id:string; name:string; phone:string; orders:number; spent:number; lastOrder:string; favorite:string; class:'Novo'|'Frequente'|'VIP'|'Inativo'; addresses:string[]; notes:string; firstOrder:string; payment:string };
