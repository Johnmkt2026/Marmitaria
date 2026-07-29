# Deploy no Cloudflare Workers

## Requisitos

- Node.js e npm instalados.
- Dependências instaladas com `npm install`.
- Um Worker Cloudflare existente chamado `marmitaria23`.
- As variáveis de ambiente configuradas no painel do Cloudflare, sem incluí-las no repositório.

## Variáveis necessárias

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Use os valores do ambiente de produção no painel do Cloudflare. O arquivo `.env.local` é apenas local e não deve ser enviado ao repositório. A configuração atual não utiliza `SUPABASE_SECRET_KEY`.

## Comandos locais

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
npx @opennextjs/cloudflare build
npx @opennextjs/cloudflare deploy --dry-run
```

Para testar o pacote OpenNext localmente:

```bash
npm run preview
```

## Configuração no Cloudflare

Configure o projeto Git com estes comandos:

```text
Build command: npx @opennextjs/cloudflare build
Deploy command: npx @opennextjs/cloudflare deploy
```

Não use apenas `npx wrangler deploy`: ele pressupõe que `.open-next/worker.js` já exista e falha quando o pacote OpenNext ainda não foi compilado.

## Processo de deploy

1. Configure as variáveis necessárias no painel Cloudflare.
2. Confirme que o Worker é `marmitaria23`.
3. Faça o build OpenNext pelo comando de build configurado.
4. Publique pelo comando de deploy configurado.
5. Antes de uma publicação manual, execute o dry-run local.

## Solução de erros conhecidos

### "Could not find compiled Open Next config"

Execute `npx @opennextjs/cloudflare build` antes do deploy. Esse comando gera `.open-next/worker.js` e a configuração compilada que o deploy consome.

### Service binding referencia um Worker inexistente

Em `wrangler.jsonc`, `name` e `services[0].service` devem ser `marmitaria23`. O binding `WORKER_SELF_REFERENCE` é uma autorreferência e precisa apontar para o mesmo Worker.

### Aviso de compatibilidade no Windows

O OpenNext recomenda WSL ou Linux para maior previsibilidade. Valide o build no ambiente do CI do Cloudflare antes de publicar.
