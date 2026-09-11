# Mr. Brown CRM

CRM da confeitaria de cookies Mr. Brown. Site estático publicado no GitHub Pages, com dados e login no Supabase (Postgres, Auth, Realtime). Não há servidor próprio.

## O que o sistema faz

- **Contatos**: funil de vendas em Kanban ou Lista (novo, conversa, degustação, proposta, fechado, perdido).
- **Produtos**: catálogo de cookies (nome, categoria, selo, preço, descrição, ativo) com os 7 produtos do site pré-cadastrados.
- **Pedidos**: pedidos numerados por contato, com itens, data de entrega e status (orçamento, confirmado, produção, pronto, entregue, cancelado).
- **Usuários**: cadastro de quem pode acessar o sistema, com papel `admin` ou `vendedor`.
- Atualização em tempo real: quando uma pessoa altera algo, as demais veem na hora.

## Estrutura de pastas

```
mrbrown-crm/
├── index.html          UI (Contatos Kanban/Lista, Pedidos, Produtos, Usuários, Login)
├── config.js           SUPABASE_URL / SUPABASE_ANON_KEY (anon key é pública por design)
├── js/storage.js       camada de dados: modo "supabase" ou "local" (localStorage)
├── supabase/schema.sql tabelas, RLS, trigger de cadastro restrito, seed de usuários
├── docs/ARQUITETURA.md contrato da camada de dados, campos, regras de acesso
└── README.md           este arquivo
```

Detalhes técnicos (contrato do `MrBrownStorage`, nomes de campos, RLS) estão em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Passo a passo de publicação

URL prevista do sistema: `https://henriqueizzo.github.io/mrbrown-crm/` (repositório `henriqueizzo/mrbrown-crm`).

### a) Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com), entre na sua conta e clique em **New project**.
2. Escolha um nome (ex.: `mrbrown-crm`), a região **South America (São Paulo)** e defina a senha do banco.
3. **Guarde a senha do banco** em local seguro (ela não é exibida de novo).
4. Aguarde o projeto ficar pronto (1 a 2 minutos).

### b) Criar as tabelas

1. No painel do projeto, abra **SQL Editor** → **New query**.
2. Copie todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql), cole no editor e clique em **Run**.
3. Deve terminar sem erros. Isso cria as tabelas, as regras de segurança (RLS), o trigger que restringe o cadastro e os usuários iniciais.

### c) Configurar as chaves no `config.js`

1. No Supabase, vá em **Project Settings** → **API**.
2. Copie o **Project URL** e a chave **anon public**.
3. Abra `config.js` e substitua os placeholders:

```js
window.SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

A chave `anon` é pública por design: a segurança fica nas regras RLS do banco.

### d) Ajustar a autenticação

1. **Authentication** → **Providers** → **Email**: opcionalmente desmarque **Confirm email** para que o login funcione na hora, sem precisar confirmar por e-mail.
2. **Authentication** → **URL Configuration**:
   - **Site URL**: `https://henriqueizzo.github.io/mrbrown-crm/`
   - **Redirect URLs**: adicione `https://henriqueizzo.github.io/mrbrown-crm/`

### e) Cadastrar as pessoas

1. Entre no CRM com o usuário admin inicial (veja "Como funciona o acesso").
2. Na aba **Usuários**, cadastre o nome, o e-mail e o papel de cada pessoa.
3. Cada pessoa abre o CRM, clica em **Primeiro acesso** na tela de login, informa o e-mail cadastrado e cria a própria senha.

### f) Publicar no GitHub Pages

No repositório `henriqueizzo/mrbrown-crm`, com o GitHub Pages ativado na branch `main` (**Settings** → **Pages** → **Deploy from a branch** → `main` / `/ (root)`):

```bash
git add .
git commit -m "Publicação"
git push
```

Em cerca de 1 minuto o site fica disponível em `https://henriqueizzo.github.io/mrbrown-crm/`. O arquivo `.nojekyll` garante que o GitHub Pages sirva os arquivos exatamente como estão.

## Como funciona o acesso

- Só e-mails cadastrados na aba **Usuários** (e marcados como ativos) conseguem criar senha e entrar. Um trigger no banco recusa qualquer tentativa de cadastro com e-mail desconhecido.
- O primeiro admin (`henriqueia1923@gmail.com`) já vem cadastrado pelo `schema.sql`; basta usar **Primeiro acesso** para criar a senha.
- Papéis:
  - **admin**: tudo o que o vendedor faz, mais cadastrar, editar e excluir usuários.
  - **vendedor**: cria e edita contatos, produtos e pedidos.
- Esqueceu a senha? Use **Esqueci a senha** na tela de login; o Supabase envia o e-mail de redefinição.
- Para bloquear alguém, desmarque **ativo** na aba Usuários.

## Rodar localmente

Basta abrir `index.html` no navegador. Se o `config.js` ainda estiver com os placeholders, o sistema entra em **modo local**: os dados ficam no `localStorage` do navegador, sem login e sem sincronização. É útil para testar a interface antes de configurar o Supabase.

## Backup

- No CRM, o botão **Salvar backup** baixa um arquivo JSON com todos os contatos, produtos, pedidos e usuários.
- O Supabase faz backup diário do banco automaticamente, mesmo no plano gratuito (**Database** → **Backups**).
