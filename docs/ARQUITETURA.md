# Mr. Brown CRM — arquitetura online

Site estático (GitHub Pages) + Supabase (Postgres, Auth, Realtime). Sem servidor próprio.

```
mrbrown-crm/
├── index.html          UI (Contatos Kanban/Lista, Pedidos, Produtos, Usuários, Login)
├── config.js           SUPABASE_URL / SUPABASE_ANON_KEY (anon key é pública por design)
├── js/storage.js       camada de dados: modo "supabase" ou "local" (localStorage)
├── supabase/schema.sql tabelas, RLS, trigger de cadastro restrito, seed de usuários
├── docs/ARQUITETURA.md este arquivo
└── README.md           como configurar e publicar
```

## Contrato da camada de dados (`window.MrBrownStorage`)

Todos os métodos são `async` e rejeitam com `Error` cuja `message` já está em português, pronta para exibir em toast.

```js
MrBrownStorage.modo            // "supabase" | "local"  (definido após init())
await MrBrownStorage.init()    // lê config.js; se URL/KEY forem placeholders → modo "local"
                               // retorna { modo, usuario }  (usuario = null se não logado ou modo local)

// ---- Autenticação (só no modo supabase; no modo local, login() resolve usuario fictício admin) ----
await MrBrownStorage.login(email, senha)          // → usuario
await MrBrownStorage.logout()
await MrBrownStorage.primeiroAcesso(email, senha) // cria a senha de um e-mail pré-cadastrado em `usuarios`
                                                  // (signUp; o banco recusa e-mail não cadastrado)
await MrBrownStorage.esqueciSenha(email)          // envia e-mail de redefinição
MrBrownStorage.onAuth(cb)                         // cb(usuario|null) quando a sessão muda

// `usuario` = { id, nome, email, papel: "admin"|"vendedor", ativo: true }
//   id = usuarios.id (uuid). No modo local: { id:"local", nome:"Uso local", email:"", papel:"admin", ativo:true }

// ---- Dados ----
await MrBrownStorage.carregarTudo()   // → { contatos, produtos, pedidos, usuarios }
await MrBrownStorage.salvarContato(c) // upsert; c = { id, nome, empresa, data:"AAAA-MM-DD", status, objetivo }
await MrBrownStorage.excluirContato(id)            // pedidos do contato caem em cascata
await MrBrownStorage.salvarProduto(p) // upsert; p = { id, nome, categoria, selo, preco:number|null, descricao, ativo:boolean, do_site:boolean }
await MrBrownStorage.excluirProduto(id)
await MrBrownStorage.salvarPedido(p)  // upsert; p = { id, numero, contato_id, data, entrega:""|"AAAA-MM-DD", status, obs,
                                      //          itens:[{ produto_id, qtd:number, preco:number }] }  → retorna p com numero preenchido
await MrBrownStorage.excluirPedido(id)
await MrBrownStorage.salvarUsuario(u) // upsert; u = { id, nome, email, papel, ativo }  (só admin)
await MrBrownStorage.excluirUsuario(id)
MrBrownStorage.onChange(cb)           // realtime: cb() quando outra pessoa alterar algo → o app chama carregarTudo()
```

IDs: strings. No Supabase são `uuid` gerados pelo cliente com `crypto.randomUUID()`; os 7 produtos do site usam ids fixos
`site-tradicional`, `site-nutella`, `site-ovomaltine`, `site-chocolatudo`, `site-limao`, `site-pistache`, `site-mini`
(coluna `id text`, não uuid, para permitir isso). Contatos e pedidos: `id text` também, por simplicidade.

Números de pedido: sequência `numero serial` no banco (o cliente manda `numero: null` ao criar).

## Nomes de campos (snake_case em todo lugar, inclusive no app)

- contatos: id, nome, empresa, data, status, objetivo, criado_em, atualizado_em
- produtos: id, nome, categoria, selo, preco, descricao, ativo, do_site
- pedidos: id, numero, contato_id, data, entrega, status, obs, criado_em
- pedido_itens: id, pedido_id, produto_id, qtd, preco
- usuarios: id, auth_id (uuid de auth.users, pode ser null até o primeiro acesso), nome, email, papel, ativo, criado_em

## Usuários iniciais (seed)

| nome                      | email                     | papel |
|---------------------------|---------------------------|-------|
| Henrique Izzo             | henriqueia1923@gmail.com  | admin |
| Daniela Guastella Izzo    | (preencher na aba Usuários) | admin |
| Guilherme Guastella Izzo  | (preencher na aba Usuários) | vendedor |

Regra de acesso: só e-mails cadastrados em `usuarios` (e `ativo = true`) conseguem criar senha e entrar.
Trigger `before insert on auth.users` recusa e-mails que não estejam em `usuarios`. Ao criar o auth user,
`usuarios.auth_id` é preenchido por trigger `after insert`.

RLS: qualquer usuário autenticado e ativo lê/escreve contatos, produtos, pedidos, pedido_itens.
`usuarios`: todos leem; só `papel = 'admin'` insere/atualiza/exclui.

## Status

- Contatos: novo, conversa, degustacao, proposta, fechado, perdido
- Pedidos: orcamento, confirmado, producao, pronto, entregue, cancelado
