# Temperando Sabores — regras permanentes

## Projeto

- Nome comercial: **Temperando Sabores**.
- Stack: Next.js 15, React 19, TypeScript, Tailwind CSS, Supabase/PostgreSQL, Supabase Auth, Supabase Storage e Cloudflare Workers/OpenNext.
- Supabase de produção: project ref `wbnbwepowmgqtrczvenr`, região `sa-east-1`.
- Cloudflare Worker: `marmitaria23`.
- URL atual: `https://marmitaria23.temperandosabores23.workers.dev`.
- Rota comercial: `https://marmitaria23.temperandosabores23.workers.dev/pedir`.
- Futuro domínio: `https://temperandosabores.com.br/pedir`.

## Regra operacional

- Durante desenvolvimento, homologação e deploy, `restaurant_settings.is_open` deve permanecer `false`.
- Abertura para testar pedidos precisa ser explícita, temporária e revertida imediatamente após o teste.
- Nunca finalize uma tarefa com a produção aberta sem solicitação explícita do usuário.

## Arquitetura do catálogo

`products.product_type` aceita `meal` e `beverage`.

Refeições (`meal`):

- `products.name` é a identificação interna, por exemplo `Prato do dia 1`.
- `products.public_name` é `Prato do dia`.
- Usam `small_price_cents` e `large_price_cents`.
- Dependem de `product_daily_availability`.
- Podem ter opções e adicionais.
- Usam automaticamente a categoria técnica única `Pratos do dia`.

Bebidas (`beverage`):

- O nome público acompanha o nome do produto.
- Usam `price_cents`.
- `small_price_cents` e `large_price_cents` são `null`.
- Não aceitam tamanho nem opções/adicionais de refeição.
- Ficam públicas enquanto `active = true`.
- Usam automaticamente a categoria técnica única `Bebidas`.

Categorias são detalhes técnicos. O operador não escolhe categoria ao cadastrar pratos ou bebidas.

## Preços e pedidos

- Armazene e calcule todos os valores financeiros em centavos.
- O PostgreSQL é autoridade para preço, tamanho, adicionais, taxa de entrega, subtotal e total.
- Nunca confie em preço, taxa ou total enviado pelo navegador.
- `public.create_order` é a autoridade transacional para criar pedidos.
- Refeição exige tamanho `small` ou `large`; bebida não aceita tamanho.
- Retirada sempre tem taxa de entrega zero.
- Entrega usa exclusivamente a taxa de `restaurant_settings`.
- Pedidos preservam snapshots históricos de nomes, preços, tamanhos e adicionais.
- Alterações posteriores no catálogo não podem modificar pedidos históricos.
- O cliente vê `public_name`; o administrativo preserva o nome interno.

## Segurança

Preserve em toda mudança:

- RLS e `public.is_admin()`;
- `requireAdminClient` e Supabase Auth;
- validação Zod nas Server Actions;
- controle de concorrência por `updated_at`;
- `SECURITY DEFINER` com `search_path` seguro e objetos qualificados;
- `GRANT`/`REVOKE` mínimos;
- políticas do Supabase Storage.

Nunca use `service_role` dentro da aplicação pública. Nunca versione senhas, tokens, chaves ou arquivos de ambiente de produção.

## Imagens

- Bucket: `product-images`.
- Leitura pública; upload, atualização e exclusão somente por administrador.
- Fluxo de upload: navegador → Supabase Storage. Evite enviar imagens pelo Cloudflare Worker.
- Formatos permitidos: JPEG, PNG e WebP. Limite: 5 MB.
- Ao substituir ou remover uma imagem, remova o objeto anterior.

## Data comercial

- Use sempre `America/Sao_Paulo`.
- Cardápio diário, relatórios e demais regras por data devem compartilhar a mesma data comercial.

## Administrativo

Rotas: `/admin`, `/admin/pedidos`, `/admin/clientes`, `/admin/cardapio`, `/admin/configuracoes`, `/admin/relatorios` e `/admin/whatsapp`.

- Identidade visual: Temperando Sabores.
- Painel mobile-first.
- Cardápio administrativo: `Hoje`, `Pratos` e `Bebidas`.
- Não reintroduza seleção de categoria nem campo de ordem de produto para o operador.
- A ordenação continua interna.

## Público

- Rotas principais: `/`, `/pedir`, `/cardapio` e `/login`.
- `/pedir` é a rota comercial.
- Nunca exponha identificações internas como `Prato do dia 1` ou `Prato do dia 2` ao cliente; exiba `Prato do dia`.

## Cloudflare e build de produção

- Evite Server Actions pesadas. Já ocorreu `CPU exceeded` com `revalidatePath` redundante.
- Prefira chamadas simples, atualização no cliente, `router.refresh` quando adequado e Storage direto.
- Deploy de produção exige autorização explícita no pedido atual.
- Não faça deploy quando o usuário pedir apenas implementação, revisão ou checkpoint.
- Antes do build OpenNext, disponibilize `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` de produção no ambiente do processo.
- Variáveis `NEXT_PUBLIC_*` são incorporadas ao bundle; secrets somente em runtime não corrigem valores já compilados.
- Antes do deploy, audite o bundle contra endpoints `127.0.0.1`, o e-mail administrativo local e a senha local definida no seed.
- O bundle de produção deve apontar para `wbnbwepowmgqtrczvenr`.
- Não persista valores de produção em `.env.local` ou em arquivos versionados.

## Ambiente local

- O Supabase local usa Docker Desktop.
- No Windows deste projeto, os serviços locais usam a faixa `54420–54427` por conflito com Hyper-V/WinNAT.
- `.env.local` é exclusivamente local e não deve ser versionado.
- O seed e suas credenciais são somente para desenvolvimento local.

## Testes obrigatórios

Para mudanças relevantes, execute:

```text
npm run test:local
npm run lint
npm run build
npx supabase db lint
git diff --check
```

- Para alterações pequenas, execute ao menos os testes diretamente relacionados.
- Antes de checkpoint ou deploy, execute a suíte completa quando aplicável.
- Nunca faça commit de funcionalidade com teste obrigatório falhando.
- `npm run test:local` depende do Docker e executa reset, testes SQL, teste de WhatsApp, db lint, lint, build e `git diff --check`.

## Migrations e seed

- Toda mudança de schema deve ser uma migration incremental versionada.
- Nunca edite migration já aplicada em produção para representar uma mudança nova.
- Migrations não devem inserir dados fictícios de produção.
- `supabase/seed.sql` é somente para desenvolvimento local e deve continuar reproduzível após `npx supabase db reset`.

## Produção

Antes de escrever em produção:

- confirme o project ref correto;
- confirme que a loja está fechada;
- entenda e limite exatamente os registros que serão alterados.

Dados de homologação devem ser identificáveis e removidos ao final. Limpe pedidos, histórico, itens, adicionais, clientes, endereços, produtos, disponibilidades, imagens e objetos Storage criados exclusivamente para testes. Preserve o administrador real, `restaurant_settings` real e categorias técnicas permanentes.

Não revele valores de variáveis, senhas, tokens ou chaves em comandos exibidos, logs ou relatórios.

## Git

- Branch principal: `main`; remoto de push: `origin/main`.
- Antes de alterar: `git status`.
- Antes de commit: `git diff`, `git diff --check` e `git status`.
- Remova arquivos `.tmp-*` usados exclusivamente em homologação.
- Nunca inclua credenciais.
- O commit deve descrever a funcionalidade ou correção.
- Após push, confirme `main` sincronizada com `origin/main` e working tree limpa.

## Forma de trabalho

Ao receber uma tarefa:

1. leia este `AGENTS.md`;
2. audite somente os arquivos relevantes;
3. reproduza o problema quando aplicável;
4. implemente a menor alteração coerente;
5. teste localmente;
6. reporte o resultado.

Não reaudite o projeto inteiro sem necessidade. Em mudanças pequenas, implemente, teste e pare antes do deploy quando ele não estiver autorizado. Ações destrutivas ou substituição de infraestrutura existente exigem confirmação quando não estiverem claramente autorizadas.

## Estado de referência

- Último checkpoint ao criar este arquivo: `57bd2f1 fix: simplifica cadastro de pratos`.
- Produção: Temperando Sabores, fechada, sem dados de homologação, Worker `marmitaria23`.
