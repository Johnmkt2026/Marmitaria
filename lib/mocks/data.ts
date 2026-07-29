import type { Customer, Order, Product } from './types';

export const restaurant = { name:'Marmitaria23', status:'Aberto', hours:'Hoje, 11h às 14h30', estimate:'35–50 min', deliveryFee:6 };
export const products: Product[] = [
  {id:'p1',name:'Frango grelhado',description:'Arroz, feijão, farofa e salada fresca.',price:24.9,category:'Marmitas',image:'🍗',available:true,featured:true,extras:[{id:'e1',name:'Ovo frito',price:2},{id:'e2',name:'Farofa extra',price:3}]},
  {id:'p2',name:'Carne de panela',description:'Cozimento lento com legumes da estação.',price:29.9,category:'Marmitas',image:'🥘',available:true,featured:true,extras:[{id:'e3',name:'Purê extra',price:4}]},
  {id:'p3',name:'Vegetariana colorida',description:'Grãos, legumes assados e molho de ervas.',price:25.9,category:'Marmitas',image:'🥗',available:true,featured:false,extras:[{id:'e4',name:'Queijo coalho',price:4}]},
  {id:'p4',name:'Feijoada da casa',description:'Porção completa para matar a saudade.',price:32.9,category:'Especiais',image:'🫘',available:false,featured:true,extras:[]},
  {id:'p5',name:'Suco natural',description:'Laranja, limão ou maracujá.',price:7,category:'Bebidas',image:'🧃',available:true,featured:false,extras:[]},
];
export const orders: Order[] = [
  {id:'#1024',time:'12:08',customer:'Ana Paula',phone:'(11) 99999-0101',items:[{name:'Frango grelhado',quantity:2,price:24.9}],notes:'Sem cebola, por favor.',address:'Rua das Flores, 120 — Apto 32',payment:'Pix',change:'—',total:55.8,status:'Preparando'},
  {id:'#1023',time:'11:54',customer:'Bruno Lima',phone:'(11) 98888-7654',items:[{name:'Carne de panela',quantity:1,price:29.9},{name:'Suco natural',quantity:1,price:7}],notes:'',address:'Retirada no balcão',payment:'Cartão',change:'—',total:36.9,status:'Novo'},
  {id:'#1022',time:'11:32',customer:'Carla Souza',phone:'(11) 97777-4422',items:[{name:'Vegetariana colorida',quantity:1,price:25.9}],notes:'Interfone 12.',address:'Av. Central, 80',payment:'Dinheiro',change:'R$ 50,00',total:31.9,status:'Saiu para entrega'},
  {id:'#1021',time:'11:10',customer:'Diego Alves',phone:'(11) 96666-8899',items:[{name:'Feijoada da casa',quantity:1,price:32.9}],notes:'',address:'Rua da Praça, 55',payment:'Pix',change:'—',total:38.9,status:'Entregue'},
];
export const customers: Customer[] = [
  {id:'c1',name:'Ana Paula',phone:'(11) 99999-0101',orders:18,spent:642.7,lastOrder:'Hoje, 12:08',favorite:'Frango grelhado',class:'VIP',addresses:['Rua das Flores, 120 — Apto 32'],notes:'Prefere sem cebola.',firstOrder:'12 jan 2026',payment:'Pix'},
  {id:'c2',name:'Bruno Lima',phone:'(11) 98888-7654',orders:6,spent:198.4,lastOrder:'Hoje, 11:54',favorite:'Carne de panela',class:'Frequente',addresses:['Retirada no balcão'],notes:'',firstOrder:'03 mai 2026',payment:'Cartão'},
  {id:'c3',name:'Carla Souza',phone:'(11) 97777-4422',orders:2,spent:64.8,lastOrder:'Hoje, 11:32',favorite:'Vegetariana colorida',class:'Novo',addresses:['Av. Central, 80'],notes:'Chamar no interfone 12.',firstOrder:'18 jul 2026',payment:'Dinheiro'},
  {id:'c4',name:'Eduardo Nunes',phone:'(11) 95555-1234',orders:12,spent:402.9,lastOrder:'12 jun 2026',favorite:'Feijoada da casa',class:'Inativo',addresses:['Rua do Sol, 44'],notes:'',firstOrder:'21 fev 2026',payment:'Pix'},
];
export const metrics = { orders:24,revenue:812.4,ticket:33.85,newCustomers:4,recurring:15,inProgress:3 };
