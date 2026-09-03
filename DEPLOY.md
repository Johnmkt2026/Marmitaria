# Produção: Supabase e Cloudflare Workers

## Requisitos

- Node.js 22 ou superior e npm.
- Supabase CLI autenticada para aplicar migrations no projeto remoto.
- Projeto Supabase de produção.
- Conta Cloudflare com Workers habilitado.
- Worker chamado `marmitaria23`, igual a `name` e `services[0].service` em `wrangler.jsonc`.

## Variáveis usadas pela aplicação

Somente estas variáveis são necessárias:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

A aplicação usa a sessão do usuário e RLS. Não configure nem exponha uma chave `service_role` no Worker. As variáveis `NEXT_PUBLIC_*` participam do build do Next.js; disponibilize os valores de produção no ambiente de build do Cloudflare.

## 1. Preparar o Supabase de produção

1. Crie um projeto Supabase e guarde a URL e a chave `anon`/publishable.
2. Vincule o repositório ao projeto:

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   ```

3. Revise e aplique as migrations:

   ```bash
   npx supabase db push --dry-run
   npx supabase db push
   ```

O arquivo `supabase/seed.sql` contém apenas dados e credenciais locais de desenvolvimento e não deve ser executado em produção.

## 2. Criar o primeiro administrador

1. No painel Supabase, crie o usuário em **Authentication → Users** com e-mail corporativo e senha forte.
2. Copie o UUID desse usuário.
3. No SQL Editor, execute substituindo o UUID:

   ```sql
   insert into public.admin_users(id) values ('UUID_DO_USUARIO');
   ```

4. Entre em `/login` e confirme o acesso. Não reutilize `admin@marmitaria.local` nem a senha do seed.

## 3. Validar localmente

```bash
npm ci
npm run test:local
npx @opennextjs/cloudflare build
npx @opennextjs/cloudflare deploy --dry-run
```

O Supabase local precisa estar iniciado e o Docker disponível para `npm run test:local`.

## 4. Configurar e publicar no Cloudflare

Configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente de build. Em integração Git, use:

```text
Build command: npx @opennextjs/cloudflare build
Deploy command: npx @opennextjs/cloudflare deploy
```

Para publicação manual:

```bash
npm ci
npx @opennextjs/cloudflare build
npx @opennextjs/cloudflare deploy
```

Não execute apenas `npx wrangler deploy`: o Worker depende dos artefatos gerados em `.open-next`.

## 5. Homologar depois do deploy

1. Abra `/cardapio` e confirme nome, produtos, adicionais, disponibilidade e taxa.
2. Crie pedidos de entrega e retirada; confira taxa e total.
3. Entre em `/login` como administrador e valide Dashboard, pedidos, clientes, cardápio, configurações, relatórios e WhatsApp.
4. Altere um status e confirme `order_status_history`.
5. Feche o restaurante, confirme que `create_order` rejeita novos pedidos e reabra a operação.
6. Verifique logs do Worker e do Supabase sem registrar senhas, tokens ou dados pessoais completos.

## Rollback

- Aplicação: publique novamente o último commit estável.
- Banco: migrations são incrementais. Não edite migrations já aplicadas; crie uma nova migration corretiva e teste primeiro em um projeto de homologação.

## Observações

- Use WSL ou Linux para maior previsibilidade no build OpenNext.
- `.env.local`, `.open-next`, `.wrangler` e arquivos de build estão ignorados pelo Git.
- Rotacione imediatamente qualquer chave que seja exposta fora dos ambientes autorizados.
